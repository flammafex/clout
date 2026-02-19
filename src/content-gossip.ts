/**
 * ContentGossip: P2P content propagation with trust-based filtering
 *
 * The key inversion (Phase 3):
 * - Scarcity: NullifierGossip says "Reject if seen" (prevents double-spend)
 * - Clout: ContentGossip says "Accept if trusted" (spreads content)
 *
 * The "Dark" Logic:
 * - In Scarcity: Forward nullifier if valid and new
 * - In Clout: Forward post ONLY if from your Web of Trust
 */

import { Crypto } from './crypto.js';
import { buildPostSignatureMessage, hashPostAttestationPayload } from './post-canonical.js';
import { buildCanonicalPlaintextTrust, getPlaintextTrustTimestamp, verifyCanonicalPlaintextTrustSignal } from './trust/plaintext-signal.js';
import { GossipMessageSigner } from './gossip/message-signer.js';
import { PeerRateLimiter } from './gossip/rate-limiter.js';
import { TrustGraphCache } from './gossip/trust-graph-cache.js';
import type { WitnessClient, FreebirdClient } from './types.js';
import type {
  ContentGossipMessage,
  SignedContentGossipMessage,
  PostPackage,
  TrustSignal,
  EncryptedTrustSignal,
  CloutProfile,
  SlidePackage
} from './clout-types.js';

export interface ContentGossipConfig {
  readonly witness: WitnessClient;
  readonly freebird: FreebirdClient;
  readonly trustGraph: Set<string>; // Agent's trust graph
  readonly maxPosts?: number;
  readonly pruneInterval?: number;
  readonly maxPostAge?: number;
  readonly maxHops?: number; // Maximum graph distance to accept

  /**
   * Maximum allowed clock skew in milliseconds (default: 60000 = 60 seconds)
   *
   * Posts/slides with timestamps more than this amount in the future are rejected.
   * Set higher for networks with poor time synchronization.
   */
  readonly maxClockSkew?: number;

  /**
   * Signing key for gossip message authentication
   * If provided, all outgoing messages will be signed and
   * incoming messages will be verified before processing.
   */
  readonly signingKey?: {
    readonly publicKey: Uint8Array;
    readonly privateKey: Uint8Array;
  };

  /**
   * Whether to require signatures on incoming messages (default: false)
   * When true, unsigned messages are rejected.
   * When false, unsigned messages are accepted (backward compatibility).
   */
  readonly requireSignatures?: boolean;

  /**
   * Encryption keys for decrypting trust signals addressed to us
   *
   * When provided, the gossip node will attempt to decrypt incoming
   * encrypted trust signals to see if we are the trustee.
   *
   * These should be X25519 keys (for ECDH key agreement).
   */
  readonly encryptionKey?: {
    readonly publicKey: Uint8Array;
    readonly privateKey: Uint8Array;
  };

  /**
   * Our public key (hex string) for identity
   * Used to determine if encrypted trust signals are addressed to us
   */
  readonly ourPublicKey?: string;

  /**
   * Optional callback to persist trust graph edges
   * Called when new trust signals are received and validated
   */
  readonly onTrustEdge?: (truster: string, trustee: string) => void;

  /**
   * Optional initial trust graph from persistence
   * Map of truster -> Set of trustees
   */
  readonly persistedTrustGraph?: Map<string, Set<string>>;

  /**
   * Rate limiting configuration
   */
  readonly rateLimit?: {
    /** Maximum messages per peer per window (default: 100) */
    readonly maxMessagesPerWindow?: number;
    /** Time window in milliseconds (default: 60000 = 1 minute) */
    readonly windowMs?: number;
    /** Ban duration in milliseconds when limit exceeded (default: 300000 = 5 minutes) */
    readonly banDurationMs?: number;
  };

  /**
   * Replay protection configuration
   */
  readonly replayProtection?: {
    /** How long signed messages are valid (default: 300000 = 5 minutes) */
    readonly messageExpiryMs?: number;
    /** How long to keep seen message IDs for deduplication (default: 600000 = 10 minutes) */
    readonly seenMessagesTtlMs?: number;
  };
}


export interface PeerConnection {
  readonly id: string;
  readonly publicKey?: string; // Peer's identity
  send(data: ContentGossipMessage): Promise<void>;
  isConnected(): boolean;
  setMessageHandler?(handler: (data: ContentGossipMessage) => void): void;
  disconnect?(): void;
}

interface PostRecord {
  post: PostPackage;
  firstSeen: number;
  hopDistance: number; // Graph distance from us
}

interface TrustRecord {
  signal: TrustSignal;
  firstSeen: number;
}

interface EncryptedTrustRecord {
  signal: EncryptedTrustSignal;
  firstSeen: number;
  /** If we decrypted it (we are the trustee), store the revealed trustee */
  decryptedTrustee?: string;
}

interface SlideRecord {
  slide: SlidePackage;
  firstSeen: number;
}

interface PeerStateRecord {
  publicKey: string;
  version: number;
  lastSync: number;
}

/**
 * ContentGossip - Trust-based content propagation
 *
 * This is the inverse of NullifierGossip:
 * - NullifierGossip: "I've seen this spend, reject it"
 * - ContentGossip: "I trust this author, propagate it"
 */
export class ContentGossip {
  private readonly seenPosts = new Map<string, PostRecord>();
  private readonly seenTrustSignals = new Map<string, TrustRecord>();
  private readonly seenEncryptedTrustSignals = new Map<string, EncryptedTrustRecord>();
  private readonly seenSlides = new Map<string, SlideRecord>();
  private readonly latestDecryptedEncryptedTrustEdgeTimestamps = new Map<string, number>();
  private readonly peerStates = new Map<string, PeerStateRecord>();
  private readonly peerConnections: PeerConnection[] = [];
  private readonly witness: WitnessClient;
  private readonly freebird: FreebirdClient;
  private readonly trustGraph: Set<string>;
  private readonly maxPosts: number;
  private readonly pruneInterval: number;
  private readonly maxPostAge: number;
  private readonly maxClockSkew: number;

  // Extracted modules
  private readonly messageSigner: GossipMessageSigner;
  private readonly rateLimiter: PeerRateLimiter;
  private readonly trustGraphCache: TrustGraphCache;

  private receiveHandler?: (data: ContentGossipMessage) => Promise<void>;
  private pruneTimer?: NodeJS.Timeout;
  private stateSyncHandler?: (publicKey: string, stateBinary: Uint8Array) => Promise<void>;
  private stateRequestHandler?: (publicKey: string) => Promise<Uint8Array | null>;

  // Encryption keys for decrypting trust signals addressed to us
  private readonly encryptionKey?: {
    readonly publicKey: Uint8Array;
    readonly privateKey: Uint8Array;
  };
  private readonly ourPublicKey?: string;

  constructor(config: ContentGossipConfig) {
    this.witness = config.witness;
    this.freebird = config.freebird;
    this.trustGraph = config.trustGraph;
    this.maxPosts = config.maxPosts ?? 100_000;
    this.pruneInterval = config.pruneInterval ?? 3600_000; // 1 hour
    this.maxPostAge = config.maxPostAge ?? (30 * 24 * 3600 * 1000); // 30 days
    this.maxClockSkew = config.maxClockSkew ?? 60_000; // 60 seconds default
    this.encryptionKey = config.encryptionKey;
    this.ourPublicKey = config.ourPublicKey;

    // Initialize extracted modules
    this.messageSigner = new GossipMessageSigner({
      signingKey: config.signingKey,
      requireSignatures: config.requireSignatures,
      messageExpiryMs: config.replayProtection?.messageExpiryMs,
      seenMessagesTtlMs: config.replayProtection?.seenMessagesTtlMs
    });

    this.rateLimiter = new PeerRateLimiter({
      maxMessagesPerWindow: config.rateLimit?.maxMessagesPerWindow,
      windowMs: config.rateLimit?.windowMs,
      banDurationMs: config.rateLimit?.banDurationMs
    });

    this.trustGraphCache = new TrustGraphCache({
      trustGraph: config.trustGraph,
      maxHops: config.maxHops,
      onTrustEdge: config.onTrustEdge,
      persistedTrustGraph: config.persistedTrustGraph
    });

    this.startPruning();
  }

  /**
   * Publish a post to the gossip network
   *
   * In Scarcity: publish() broadcasts a nullifier to detect double-spends
   * In Clout: publish() broadcasts content to propagate posts
   */
  async publish(message: ContentGossipMessage): Promise<void> {
    if (message.type === 'post' && message.post) {
      const key = message.post.id;

      // Check if already published
      if (this.seenPosts.has(key)) {
        console.log(`[ContentGossip] Post ${key.slice(0, 8)} already published`);
        return;
      }

      // Add to local feed (hop distance 0 - it's our own post)
      this.seenPosts.set(key, {
        post: message.post,
        firstSeen: Date.now(),
        hopDistance: 0
      });

      // Broadcast to all peers
      await this.broadcast(message);

      // Notify local handler
      if (this.receiveHandler) {
        await this.receiveHandler(message);
      }
    } else if (message.type === 'trust' && message.trustSignal) {
      const key = `${message.trustSignal.truster}:${message.trustSignal.trustee}`;
      const incomingTimestamp = getPlaintextTrustTimestamp(message.trustSignal);
      const existing = this.seenTrustSignals.get(key);

      if (existing && getPlaintextTrustTimestamp(existing.signal) >= incomingTimestamp) {
        console.log(`[ContentGossip] Trust signal ${key} already published`);
        return;
      }

      this.seenTrustSignals.set(key, {
        signal: message.trustSignal,
        firstSeen: Date.now()
      });
      this.rebuildTrustGraphCacheFromSeenSignals();

      await this.broadcast(message);

      if (this.receiveHandler) {
        await this.receiveHandler(message);
      }
    } else if (message.type === 'trust-encrypted' && message.encryptedTrustSignal) {
      // Encrypted trust signals use commitment as key (trustee is hidden)
      const key = `${message.encryptedTrustSignal.truster}:${message.encryptedTrustSignal.trusteeCommitment}`;

      if (this.seenEncryptedTrustSignals.has(key)) {
        console.log(`[ContentGossip] Encrypted trust signal ${key.slice(0, 16)} already published`);
        return;
      }

      this.seenEncryptedTrustSignals.set(key, {
        signal: message.encryptedTrustSignal,
        firstSeen: Date.now()
      });

      await this.broadcast(message);

      if (this.receiveHandler) {
        await this.receiveHandler(message);
      }
    } else if (message.type === 'slide' && message.slide) {
      const key = message.slide.id;

      // Check if already published
      if (this.seenSlides.has(key)) {
        console.log(`[ContentGossip] Slide ${key.slice(0, 8)} already published`);
        return;
      }

      // Add to local slides
      this.seenSlides.set(key, {
        slide: message.slide,
        firstSeen: Date.now()
      });

      // Broadcast to all peers
      await this.broadcast(message);

      // Notify local handler
      if (this.receiveHandler) {
        await this.receiveHandler(message);
      }
    }
  }

  private rebuildTrustGraphCacheFromSeenSignals(): void {
    const activeSignals = new Map<string, { truster: string; trustee: string }>();
    for (const [key, record] of this.seenTrustSignals.entries()) {
      const canonical = buildCanonicalPlaintextTrust({
        truster: record.signal.truster,
        trustee: record.signal.trustee,
        timestamp: getPlaintextTrustTimestamp(record.signal),
        weight: record.signal.weight,
        revoked: record.signal.revoked
      });
      if (!canonical || canonical.isRevocation) {
        continue;
      }
      activeSignals.set(key, {
        truster: record.signal.truster,
        trustee: record.signal.trustee
      });
    }
    this.trustGraphCache.rebuildFromSignals(activeSignals);
  }

  /**
   * Receive content from peer - THE KEY INVERSION
   *
   * In Scarcity: onReceive() rejects if nullifier is seen (double-spend)
   * In Clout: onReceive() accepts ONLY if author is trusted
   *
   * The "Shadowban" Effect:
   * - If author is not in your trust graph, the post vanishes from YOUR reality
   * - It never enters your feed, never gets propagated by you
   * - This creates subjective, uncensorable feeds
   *
   * Security: Messages are verified for sender authenticity if signed.
   * When requireSignatures=true, unsigned messages are rejected.
   */
  async onReceive(data: ContentGossipMessage | SignedContentGossipMessage, peerId?: string): Promise<void> {
    // Rate limit check - protect against flooding
    if (peerId && !this.rateLimiter.checkLimit(peerId)) {
      return;
    }

    // Verify signature and unwrap message
    const message = this.messageSigner.verify(data);
    if (!message) {
      // Invalid signature or unsigned when signatures required
      return;
    }

    if (message.type === 'post' && message.post) {
      await this.handlePostMessage(message.post, peerId);
    } else if (message.type === 'trust' && message.trustSignal) {
      await this.handleTrustMessage(message.trustSignal, peerId);
    } else if (message.type === 'trust-encrypted' && message.encryptedTrustSignal) {
      await this.handleEncryptedTrustMessage(message.encryptedTrustSignal, peerId);
    } else if (message.type === 'slide' && message.slide) {
      await this.handleSlideMessage(message.slide, peerId);
    } else if (message.type === 'state-sync' && message.stateSync) {
      await this.handleStateSyncMessage(message.stateSync, peerId);
    } else if (message.type === 'state-request' && message.stateRequest) {
      await this.handleStateRequestMessage(message.stateRequest, peerId);
    }
  }

  /**
   * Handle incoming post message
   */
  private async handlePostMessage(post: PostPackage, peerId?: string): Promise<void> {
    const key = post.id;
    const existing = this.seenPosts.get(key);

    // Skip if already seen
    if (existing) {
      return;
    }

    // LAYER 1: TIMESTAMP VALIDATION
    const now = Date.now();
    const age = now - post.proof.timestamp;

    if (age > this.maxPostAge) {
      console.log(`[ContentGossip] Rejecting old post (${age}ms old)`);
      return;
    }

    if (post.proof.timestamp > now + this.maxClockSkew) {
      console.log(`[ContentGossip] Rejecting future post (clock skew > ${this.maxClockSkew}ms)`);
      return;
    }

    // LAYER 2: TRUST GRAPH FILTERING - THE KEY LOGIC
    const hopDistance = this.trustGraphCache.calculateHopDistance(post.author);

    if (hopDistance > this.trustGraphCache.maxHopsLimit) {
      // THE "SHADOWBAN" - Post from untrusted source vanishes
      console.log(
        `[ContentGossip] Dropping post from ${post.author.slice(0, 8)} ` +
        `(hop distance ${hopDistance} > max ${this.trustGraphCache.maxHopsLimit})`
      );
      return;
    }

    // LAYER 3: WITNESS PROOF VERIFICATION
    const proofValid = await this.witness.verify(post.proof);
    if (!proofValid) {
      console.warn('[ContentGossip] Invalid witness proof, ignoring');
      return;
    }

    // LAYER 3.5: WITNESS PROOF BINDING
    // Ensure the timestamp proof is bound to the exact canonical post payload.
    const expectedProofHash = hashPostAttestationPayload(post);
    if (post.proof.hash !== expectedProofHash) {
      console.warn('[ContentGossip] Post proof hash mismatch, ignoring');
      return;
    }

    // LAYER 4: CONTENT HASH VERIFICATION
    const contentHash = Crypto.hashString(post.content);
    if (contentHash !== post.id) {
      console.warn('[ContentGossip] Content hash mismatch, ignoring');
      return;
    }

    // LAYER 5: AUTHOR SIGNATURE VERIFICATION
    let signatureValid = false;
    try {
      const authorKeyBytes = Crypto.fromHex(post.author);

      if (typeof post.signatureTimestamp === 'number') {
        const signatureMessage = buildPostSignatureMessage({
          content: post.content,
          author: post.author,
          timestamp: post.signatureTimestamp,
          replyTo: post.replyTo,
          mediaCid: post.media?.cid,
          link: post.link,
          nsfw: post.nsfw,
          contentWarning: post.contentWarning
        });
        const signatureBytes = new TextEncoder().encode(signatureMessage);
        signatureValid = Crypto.verify(signatureBytes, post.signature, authorKeyBytes);
      } else {
        // Legacy fallback for older posts that signed raw content only.
        const legacyBytes = new TextEncoder().encode(post.content);
        signatureValid = Crypto.verify(legacyBytes, post.signature, authorKeyBytes);
      }
    } catch {
      signatureValid = false;
    }

    if (!signatureValid) {
      console.warn('[ContentGossip] Invalid post signature, ignoring');
      return;
    }

    // LAYER 6: OPTIONAL AUTHORSHIP PROOF
    if (post.authorshipProof) {
      const authorshipValid = await this.freebird.verifyToken(post.authorshipProof);
      if (!authorshipValid) {
        console.warn('[ContentGossip] Invalid authorship proof, ignoring');
        return;
      }
    }

    // POST IS TRUSTED - Add to feed and propagate
    console.log(
      `[ContentGossip] ✅ Accepted post from ${post.author.slice(0, 8)} ` +
      `(hop distance ${hopDistance})`
    );

    this.seenPosts.set(key, {
      post,
      firstSeen: Date.now(),
      hopDistance
    });

    // Propagate to peers (epidemic broadcast)
    await this.broadcast({ type: 'post', post, timestamp: Date.now() }, true);

    // Notify local handler
    if (this.receiveHandler) {
      await this.receiveHandler({ type: 'post', post, timestamp: Date.now() });
    }
  }

  /**
   * Handle incoming trust signal
   */
  private async handleTrustMessage(signal: TrustSignal, peerId?: string): Promise<void> {
    const key = `${signal.truster}:${signal.trustee}`;
    const incomingTimestamp = getPlaintextTrustTimestamp(signal);
    const existing = this.seenTrustSignals.get(key);

    if (existing && getPlaintextTrustTimestamp(existing.signal) >= incomingTimestamp) {
      return;
    }

    // Verify trust signal
    const proofValid = await this.witness.verify(signal.proof);
    if (!proofValid) {
      console.warn('[ContentGossip] Invalid trust signal proof');
      return;
    }

    if (!verifyCanonicalPlaintextTrustSignal(signal)) {
      console.warn('[ContentGossip] Invalid plaintext trust signal signature/hash');
      return;
    }

    // Add to trust signals
    this.seenTrustSignals.set(key, {
      signal,
      firstSeen: Date.now()
    });

    // Rebuild from latest active trust edges to handle updates and revocations safely.
    this.rebuildTrustGraphCacheFromSeenSignals();

    // Propagate
    await this.broadcast({ type: 'trust', trustSignal: signal, timestamp: Date.now() }, true);

    // Notify handler
    if (this.receiveHandler) {
      await this.receiveHandler({ type: 'trust', trustSignal: signal, timestamp: Date.now() });
    }
  }

  /**
   * Handle incoming encrypted trust signal
   *
   * Privacy-preserving trust signals where:
   * 1. Third parties can verify the truster's signature
   * 2. Only the trustee can decrypt to see who trusted them
   * 3. The social graph is hidden from observers
   *
   * ## Privacy vs Graph Completeness Tradeoff
   *
   * IMPORTANT: When encrypted trust signals propagate through the network,
   * nodes that aren't the trustee learn nothing about the edge. This means:
   *
   * - Hop distance calculations are incomplete for third parties
   * - A user may appear "unreachable" (999 hops) even if they're actually
   *   2-3 hops away through encrypted edges
   * - The social graph is effectively hidden from network observers
   *
   * This is an INTENTIONAL privacy design decision. The tradeoff is:
   * - Privacy: Third parties cannot map the social graph
   * - Completeness: Reputation/distance scores may be lower than reality
   *
   * For communities that prefer full graph transparency over privacy,
   * use plaintext TrustSignal messages instead of EncryptedTrustSignal.
   * The graph caches (hopDistanceCache, trustAdjacencyList) will then
   * contain all edges and provide accurate hop distance calculations.
   *
   * Note: We only update graph caches when WE are the trustee because
   * that's the only case where we can decrypt and verify the edge.
   */
  private async handleEncryptedTrustMessage(signal: EncryptedTrustSignal, peerId?: string): Promise<void> {
    // Key is truster + commitment (trustee is hidden)
    const key = `${signal.truster}:${signal.trusteeCommitment}`;

    if (this.seenEncryptedTrustSignals.has(key)) {
      return;
    }

    // Verify witness proof
    const proofValid = await this.witness.verify(signal.proof);
    if (!proofValid) {
      console.warn('[ContentGossip] Invalid encrypted trust signal proof');
      return;
    }

    if (signal.proof.hash !== signal.trusteeCommitment) {
      console.warn('[ContentGossip] Encrypted trust proof hash mismatch');
      return;
    }

    // Verify truster's signature (anyone can do this)
    const signatureValid = Crypto.verifyEncryptedTrustSignature(
      signal.trusteeCommitment,
      signal.truster,
      signal.signature,
      signal.weight ?? 1.0,
      signal.proof.timestamp
    );

    if (!signatureValid) {
      console.warn('[ContentGossip] Invalid encrypted trust signal signature');
      return;
    }

    // Try to decrypt if we have encryption keys (to see if we're the trustee)
    let decryptedTrustee: string | undefined;
    if (this.encryptionKey && this.ourPublicKey) {
      const decrypted = Crypto.decryptTrustSignal(
        signal.encryptedTrustee,
        signal.trusteeCommitment,
        signal.truster,
        signal.signature,
        signal.weight ?? 1.0,
        signal.proof.timestamp,
        this.encryptionKey.privateKey,
        this.encryptionKey.publicKey
      );

      if (decrypted && decrypted.trustee === this.ourPublicKey) {
        // We are the trustee! Someone trusts us.
        decryptedTrustee = decrypted.trustee;
        const edgeKey = `${signal.truster}:${decryptedTrustee}`;
        const signalTimestamp = signal.proof.timestamp;
        const latestTimestamp = this.latestDecryptedEncryptedTrustEdgeTimestamps.get(edgeKey);

        if (latestTimestamp !== undefined && latestTimestamp >= signalTimestamp) {
          console.log(
            `[ContentGossip] Ignoring stale encrypted trust update for ${signal.truster.slice(0, 8)} ` +
            `(ts=${signalTimestamp}, latest=${latestTimestamp})`
          );
        } else {
          const isRevocation = signal.revoked === true || (signal.weight ?? 1.0) === 0;
          if (isRevocation) {
            console.log(`[ContentGossip] 🔐 Decrypted revocation from ${signal.truster.slice(0, 8)}`);
            this.trustGraphCache.removeEdge(signal.truster, decryptedTrustee);
          } else {
            console.log(`[ContentGossip] 🔐 Decrypted trust signal: ${signal.truster.slice(0, 8)} trusts us!`);
            this.trustGraphCache.updateCaches(signal.truster, decryptedTrustee);
          }
          this.latestDecryptedEncryptedTrustEdgeTimestamps.set(edgeKey, signalTimestamp);
        }
      }
    }

    // Store the signal
    this.seenEncryptedTrustSignals.set(key, {
      signal,
      firstSeen: Date.now(),
      decryptedTrustee
    });

    console.log(`[ContentGossip] ✅ Accepted encrypted trust signal from ${signal.truster.slice(0, 8)}`);

    // Propagate (trustee remains hidden)
    await this.broadcast({
      type: 'trust-encrypted',
      encryptedTrustSignal: signal,
      timestamp: Date.now()
    }, true);

    // Notify handler
    if (this.receiveHandler) {
      await this.receiveHandler({
        type: 'trust-encrypted',
        encryptedTrustSignal: signal,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Handle incoming slide (encrypted DM)
   */
  private async handleSlideMessage(slide: SlidePackage, peerId?: string): Promise<void> {
    const key = slide.id;

    // Skip if already seen
    if (this.seenSlides.has(key)) {
      return;
    }

    // LAYER 1: TIMESTAMP VALIDATION
    const now = Date.now();
    const age = now - slide.proof.timestamp;

    if (age > this.maxPostAge) {
      console.log(`[ContentGossip] Rejecting old slide (${age}ms old)`);
      return;
    }

    if (slide.proof.timestamp > now + this.maxClockSkew) {
      console.log(`[ContentGossip] Rejecting future slide (clock skew > ${this.maxClockSkew}ms)`);
      return;
    }

    // LAYER 2: WITNESS PROOF VERIFICATION
    const proofValid = await this.witness.verify(slide.proof);
    if (!proofValid) {
      console.warn('[ContentGossip] Invalid slide witness proof');
      return;
    }

    // LAYER 3: HASH VERIFICATION
    const slideHash = Crypto.toHex(Crypto.hash(
      slide.sender,
      slide.recipient,
      slide.ephemeralPublicKey,
      slide.ciphertext
    ));
    if (slideHash !== slide.id) {
      console.warn('[ContentGossip] Slide hash mismatch');
      return;
    }

    // SLIDE IS VALID - Add to slides and propagate
    console.log(
      `[ContentGossip] ✅ Accepted slide from ${slide.sender.slice(0, 8)} ` +
      `to ${slide.recipient.slice(0, 8)}`
    );

    this.seenSlides.set(key, {
      slide,
      firstSeen: Date.now()
    });

    // Propagate to peers (epidemic broadcast)
    await this.broadcast({ type: 'slide', slide, timestamp: Date.now() }, true);

    // Notify local handler
    if (this.receiveHandler) {
      await this.receiveHandler({ type: 'slide', slide, timestamp: Date.now() });
    }
  }

  /**
   * Handle incoming state sync message
   */
  private async handleStateSyncMessage(
    stateSync: { publicKey: string; stateBinary: Uint8Array; version: number },
    peerId?: string
  ): Promise<void> {
    console.log(
      `[ContentGossip] 📦 Received state sync from ${stateSync.publicKey.slice(0, 8)} (v${stateSync.version})`
    );

    // Check if this is a trusted peer (within our trust graph)
    if (!this.trustGraph.has(stateSync.publicKey)) {
      if (!this.trustGraphCache.isWithinMaxHops(stateSync.publicKey)) {
        const hopDistance = this.trustGraphCache.calculateHopDistance(stateSync.publicKey);
        console.log(`[ContentGossip] Ignoring state from untrusted peer (${hopDistance} hops)`);
        return;
      }
    }

    // Check if we already have this version
    const existing = this.peerStates.get(stateSync.publicKey);
    if (existing && existing.version >= stateSync.version) {
      console.log(`[ContentGossip] Already have version ${existing.version}, ignoring v${stateSync.version}`);
      return;
    }

    // Update peer state record
    this.peerStates.set(stateSync.publicKey, {
      publicKey: stateSync.publicKey,
      version: stateSync.version,
      lastSync: Date.now()
    });

    // Pass to handler (Clout will merge into its Chronicle)
    if (this.stateSyncHandler) {
      await this.stateSyncHandler(stateSync.publicKey, stateSync.stateBinary);
    }
  }

  /**
   * Handle incoming state request message
   */
  private async handleStateRequestMessage(
    stateRequest: { publicKey: string; currentVersion: number },
    peerId?: string
  ): Promise<void> {
    console.log(
      `[ContentGossip] 📨 State request from ${stateRequest.publicKey.slice(0, 8)} (has v${stateRequest.currentVersion})`
    );

    // Check if this is a trusted peer
    if (!this.trustGraph.has(stateRequest.publicKey)) {
      if (!this.trustGraphCache.isWithinMaxHops(stateRequest.publicKey)) {
        const hopDistance = this.trustGraphCache.calculateHopDistance(stateRequest.publicKey);
        console.log(`[ContentGossip] Ignoring request from untrusted peer (${hopDistance} hops)`);
        return;
      }
    }

    // Get our state from handler (Clout will export from its Chronicle)
    if (this.stateRequestHandler) {
      const stateBinary = await this.stateRequestHandler(stateRequest.publicKey);
      if (stateBinary) {
        // Send our state to the requesting peer
        await this.broadcast({
          type: 'state-sync',
          stateSync: {
            publicKey: stateRequest.publicKey,
            stateBinary,
            version: Date.now() // Simple version: timestamp
          },
          timestamp: Date.now()
        });
      }
    }
  }

  /**
   * Update local trust graph
   *
   * Allows dynamic trust graph updates.
   * OPTIMIZATION: Rebuilds hop distance cache for direct trust relationships.
   */
  updateTrustGraph(newTrustGraph: Set<string>): void {
    this.trustGraph.clear();
    for (const key of newTrustGraph) {
      this.trustGraph.add(key);
    }

    // Update the trust graph cache
    this.trustGraphCache.updateDirectTrustGraph(newTrustGraph);

    // Rebuild extended network cache from latest active trust signals
    this.rebuildTrustGraphCacheFromSeenSignals();
  }

  /**
   * Get all posts in feed (ordered by timestamp)
   */
  getFeed(): PostPackage[] {
    const posts = Array.from(this.seenPosts.values())
      .filter(record => record.hopDistance <= this.trustGraphCache.maxHopsLimit)
      .sort((a, b) => b.post.proof.timestamp - a.post.proof.timestamp)
      .map(record => record.post);

    return posts;
  }

  /**
   * Get posts by author
   */
  getPostsByAuthor(author: string): PostPackage[] {
    return Array.from(this.seenPosts.values())
      .filter(record => record.post.author === author)
      .sort((a, b) => b.post.proof.timestamp - a.post.proof.timestamp)
      .map(record => record.post);
  }

  /**
   * Get post by ID
   */
  getPost(id: string): PostPackage | undefined {
    return this.seenPosts.get(id)?.post;
  }

  /**
   * Get all slides (ordered by timestamp)
   */
  getSlides(): SlidePackage[] {
    return Array.from(this.seenSlides.values())
      .sort((a, b) => b.slide.proof.timestamp - a.slide.proof.timestamp)
      .map(record => record.slide);
  }

  /**
   * Register handler for received messages
   */
  setReceiveHandler(handler: (data: ContentGossipMessage) => Promise<void>): void {
    this.receiveHandler = handler;
  }

  /**
   * Subscribe to messages (alias for setReceiveHandler)
   */
  subscribe(handler: (data: ContentGossipMessage) => Promise<void>): void {
    this.setReceiveHandler(handler);
  }

  /**
   * Register handler for state sync messages
   * Handler receives: (publicKey, stateBinary) => Promise<void>
   */
  setStateSyncHandler(handler: (publicKey: string, stateBinary: Uint8Array) => Promise<void>): void {
    this.stateSyncHandler = handler;
  }

  /**
   * Register handler for state requests
   * Handler returns: Promise<Uint8Array | null> (state binary or null if unavailable)
   */
  setStateRequestHandler(handler: (publicKey: string) => Promise<Uint8Array | null>): void {
    this.stateRequestHandler = handler;
  }

  /**
   * Broadcast our state to all peers
   */
  async broadcastState(publicKey: string, stateBinary: Uint8Array): Promise<void> {
    console.log(`[ContentGossip] 📤 Broadcasting state for ${publicKey.slice(0, 8)}`);
    await this.broadcast({
      type: 'state-sync',
      stateSync: {
        publicKey,
        stateBinary,
        version: Date.now()
      },
      timestamp: Date.now()
    });
  }

  /**
   * Request state from all peers
   */
  async requestState(publicKey: string, currentVersion: number = 0): Promise<void> {
    console.log(`[ContentGossip] 📥 Requesting state for ${publicKey.slice(0, 8)}`);
    await this.broadcast({
      type: 'state-request',
      stateRequest: {
        publicKey,
        currentVersion
      },
      timestamp: Date.now()
    });
  }

  /**
   * Add peer connection
   */
  addPeer(peer: PeerConnection): void {
    if (peer.setMessageHandler) {
      // Handler accepts both signed and unsigned messages
      peer.setMessageHandler(async (data: ContentGossipMessage) => {
        // Cast to allow SignedContentGossipMessage - the type union is handled in onReceive
        await this.onReceive(data as ContentGossipMessage | SignedContentGossipMessage, peer.id);
      });
    }

    this.peerConnections.push(peer);
    console.log(`[ContentGossip] Added peer ${peer.id} (total: ${this.peerConnections.length})`);
  }

  /**
   * Remove peer connection
   */
  removePeer(peerId: string): void {
    const index = this.peerConnections.findIndex(p => p.id === peerId);
    if (index !== -1) {
      this.peerConnections.splice(index, 1);
    }
  }

  /**
   * Get current peer list
   */
  get peers(): PeerConnection[] {
    return [...this.peerConnections];
  }

  /**
   * Get gossip network statistics
   */
  getStats() {
    const rateLimiterStats = this.rateLimiter.getStats();

    return {
      postCount: this.seenPosts.size,
      trustSignalCount: this.seenTrustSignals.size,
      encryptedTrustSignalCount: this.seenEncryptedTrustSignals.size,
      slideCount: this.seenSlides.size,
      peerCount: this.peerConnections.length,
      activePeers: this.peerConnections.filter(p => p.isConnected()).length,
      trustGraphSize: this.trustGraph.size,
      rateLimitedPeers: rateLimiterStats.bannedPeers,
      trackedPeers: rateLimiterStats.trackedPeers,
      seenMessageIds: this.messageSigner.seenMessageCount
    };
  }

  /**
   * Check if a peer is currently rate-limited (banned)
   */
  isPeerBanned(peerId: string): boolean {
    return this.rateLimiter.isPeerBanned(peerId);
  }

  /**
   * Manually unban a peer (for administrative use)
   */
  unbanPeer(peerId: string): void {
    this.rateLimiter.unbanPeer(peerId);
  }

  /**
   * Broadcast message to all peers
   */
  private async broadcast(message: ContentGossipMessage, skipFailed = false): Promise<void> {
    // Sign the message if we have a signing key
    const outgoingMessage = this.messageSigner.sign(message);

    const promises = this.peerConnections
      .filter(peer => peer.isConnected())
      .map(async (peer) => {
        try {
          // Note: PeerConnection.send() accepts ContentGossipMessage,
          // but SignedContentGossipMessage is a superset, so this works.
          await peer.send(outgoingMessage as ContentGossipMessage);
        } catch (error) {
          if (!skipFailed) {
            throw error;
          }
          console.warn(`Failed to send to peer ${peer.id}:`, error);
        }
      });

    await Promise.all(promises);
  }

  /**
   * Prune old posts to prevent unbounded growth
   */
  private startPruning(): void {
    this.pruneTimer = setInterval(() => {
      const now = Date.now();
      const cutoff = now - this.maxPostAge;

      // Remove old posts
      for (const [key, record] of this.seenPosts.entries()) {
        if (record.firstSeen < cutoff) {
          this.seenPosts.delete(key);
        }
      }

      // Remove old slides
      for (const [key, record] of this.seenSlides.entries()) {
        if (record.firstSeen < cutoff) {
          this.seenSlides.delete(key);
        }
      }

      // Safety valve: enforce hard cap
      if (this.seenPosts.size > this.maxPosts) {
        console.warn(`[ContentGossip] Post count (${this.seenPosts.size}) exceeded limit. Forcing prune.`);

        const entries = Array.from(this.seenPosts.entries())
          .sort((a, b) => a[1].firstSeen - b[1].firstSeen);

        const toRemove = entries.slice(0, this.seenPosts.size - this.maxPosts);
        for (const [key] of toRemove) {
          this.seenPosts.delete(key);
        }
      }

      // Safety valve for slides
      if (this.seenSlides.size > this.maxPosts) {
        console.warn(`[ContentGossip] Slide count (${this.seenSlides.size}) exceeded limit. Forcing prune.`);

        const entries = Array.from(this.seenSlides.entries())
          .sort((a, b) => a[1].firstSeen - b[1].firstSeen);

        const toRemove = entries.slice(0, this.seenSlides.size - this.maxPosts);
        for (const [key] of toRemove) {
          this.seenSlides.delete(key);
        }
      }

      // Cleanup stale rate limit entries
      this.rateLimiter.cleanup();

      // Cleanup expired seen messages (replay protection)
      this.messageSigner.cleanupExpiredMessages();
    }, this.pruneInterval);
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
    }
  }
}
