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
import type { WitnessClient, FreebirdClient } from './types.js';
import type {
  ContentGossipMessage,
  PostPackage,
  TrustSignal,
  CloutProfile
} from './clout-types.js';

export interface ContentGossipConfig {
  readonly witness: WitnessClient;
  readonly freebird: FreebirdClient;
  readonly trustGraph: Set<string>; // Agent's trust graph
  readonly maxPosts?: number;
  readonly pruneInterval?: number;
  readonly maxPostAge?: number;
  readonly maxHops?: number; // Maximum graph distance to accept
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
  private readonly peerConnections: PeerConnection[] = [];
  private readonly witness: WitnessClient;
  private readonly freebird: FreebirdClient;
  private readonly trustGraph: Set<string>;
  private readonly maxPosts: number;
  private readonly pruneInterval: number;
  private readonly maxPostAge: number;
  private readonly maxHops: number;
  private receiveHandler?: (data: ContentGossipMessage) => Promise<void>;
  private pruneTimer?: NodeJS.Timeout;

  constructor(config: ContentGossipConfig) {
    this.witness = config.witness;
    this.freebird = config.freebird;
    this.trustGraph = config.trustGraph;
    this.maxPosts = config.maxPosts ?? 100_000;
    this.pruneInterval = config.pruneInterval ?? 3600_000; // 1 hour
    this.maxPostAge = config.maxPostAge ?? (30 * 24 * 3600 * 1000); // 30 days
    this.maxHops = config.maxHops ?? 3; // Up to 3 degrees of separation

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

      if (this.seenTrustSignals.has(key)) {
        console.log(`[ContentGossip] Trust signal ${key} already published`);
        return;
      }

      this.seenTrustSignals.set(key, {
        signal: message.trustSignal,
        firstSeen: Date.now()
      });

      await this.broadcast(message);

      if (this.receiveHandler) {
        await this.receiveHandler(message);
      }
    }
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
   */
  async onReceive(data: ContentGossipMessage, peerId?: string): Promise<void> {
    if (data.type === 'post' && data.post) {
      await this.handlePostMessage(data.post, peerId);
    } else if (data.type === 'trust' && data.trustSignal) {
      await this.handleTrustMessage(data.trustSignal, peerId);
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

    if (post.proof.timestamp > now + 5000) {
      console.log(`[ContentGossip] Rejecting future post`);
      return;
    }

    // LAYER 2: TRUST GRAPH FILTERING - THE KEY LOGIC
    const hopDistance = this.calculateHopDistance(post.author);

    if (hopDistance > this.maxHops) {
      // THE "SHADOWBAN" - Post from untrusted source vanishes
      console.log(
        `[ContentGossip] Dropping post from ${post.author.slice(0, 8)} ` +
        `(hop distance ${hopDistance} > max ${this.maxHops})`
      );
      return;
    }

    // LAYER 3: WITNESS PROOF VERIFICATION
    const proofValid = await this.witness.verify(post.proof);
    if (!proofValid) {
      console.warn('[ContentGossip] Invalid witness proof, ignoring');
      return;
    }

    // LAYER 4: CONTENT HASH VERIFICATION
    const contentHash = Crypto.hashString(post.content);
    if (contentHash !== post.id) {
      console.warn('[ContentGossip] Content hash mismatch, ignoring');
      return;
    }

    // LAYER 5: OPTIONAL AUTHORSHIP PROOF
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

    if (this.seenTrustSignals.has(key)) {
      return;
    }

    // Verify trust signal
    const proofValid = await this.witness.verify(signal.proof);
    if (!proofValid) {
      console.warn('[ContentGossip] Invalid trust signal proof');
      return;
    }

    // Add to trust signals
    this.seenTrustSignals.set(key, {
      signal,
      firstSeen: Date.now()
    });

    // Propagate
    await this.broadcast({ type: 'trust', trustSignal: signal, timestamp: Date.now() }, true);

    // Notify handler
    if (this.receiveHandler) {
      await this.receiveHandler({ type: 'trust', trustSignal: signal, timestamp: Date.now() });
    }
  }

  /**
   * Calculate hop distance in trust graph
   *
   * Returns:
   * - 0: Self
   * - 1: Direct follow
   * - 2: Friend of friend
   * - 999: Not trusted (beyond maxHops)
   */
  private calculateHopDistance(publicKey: string): number {
    // Distance 0: Self (handled elsewhere)
    // Distance 1: Direct follow
    if (this.trustGraph.has(publicKey)) {
      return 1;
    }

    // Distance 2+: Friend of friend (simplified BFS)
    // In production, we'd do full graph traversal with seen trust signals
    for (const [key, record] of this.seenTrustSignals.entries()) {
      const [truster, trustee] = key.split(':');

      // If we trust the truster, and they trust the target
      if (this.trustGraph.has(truster) && trustee === publicKey) {
        return 2;
      }
    }

    // Not reachable within maxHops
    return 999;
  }

  /**
   * Update local trust graph
   *
   * Allows dynamic trust graph updates.
   */
  updateTrustGraph(newTrustGraph: Set<string>): void {
    this.trustGraph.clear();
    for (const key of newTrustGraph) {
      this.trustGraph.add(key);
    }
  }

  /**
   * Get all posts in feed (ordered by timestamp)
   */
  getFeed(): PostPackage[] {
    const posts = Array.from(this.seenPosts.values())
      .filter(record => record.hopDistance <= this.maxHops)
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
   * Register handler for received messages
   */
  setReceiveHandler(handler: (data: ContentGossipMessage) => Promise<void>): void {
    this.receiveHandler = handler;
  }

  /**
   * Add peer connection
   */
  addPeer(peer: PeerConnection): void {
    if (peer.setMessageHandler) {
      peer.setMessageHandler(async (data: ContentGossipMessage) => {
        await this.onReceive(data, peer.id);
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
    return {
      postCount: this.seenPosts.size,
      trustSignalCount: this.seenTrustSignals.size,
      peerCount: this.peerConnections.length,
      activePeers: this.peerConnections.filter(p => p.isConnected()).length,
      trustGraphSize: this.trustGraph.size
    };
  }

  /**
   * Broadcast message to all peers
   */
  private async broadcast(message: ContentGossipMessage, skipFailed = false): Promise<void> {
    const promises = this.peerConnections
      .filter(peer => peer.isConnected())
      .map(async (peer) => {
        try {
          await peer.send(message);
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
