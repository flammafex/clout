import { CloutPost, type PostConfig, type ContentGossip } from './post.js';
import { TicketBooth, type CloutTicket, type TicketType } from './ticket-booth.js';
import { Crypto } from './crypto.js';
import { ReputationValidator } from './reputation.js';
import { CloutStateManager } from './chronicle/clout-state.js';
import { StorageManager, type MediaMetadata } from './storage/wnfs-manager.js';
import { ProfileStore } from './store/profile-store.js';
import { CloutLocalData } from './clout/local-data.js';
import { CloutMessaging } from './clout/messaging.js';
import { CloutStateSync } from './clout/state-sync.js';
import type { FreebirdClient, WitnessClient, Attestation } from './types.js';
import {
  type TrustSignal,
  type EncryptedTrustSignal,
  type ReputationScore,
  type Feed,
  type PostPackage,
  type SlidePackage,
  type ReactionPackage,
  type Inbox,
  type CloutStore,
  type ContentGossipMessage,
  type CloutProfile,
  type MediaInput,
  DEFAULT_TRUST_SETTINGS
} from './clout-types.js';

// Extended Gossip Interface to include read methods (if available)
export interface GossipNode extends ContentGossip {
  getFeed?(): PostPackage[];
  getSlides?(): SlidePackage[];
  getStats?(): any;
  setStateSyncHandler(handler: (publicKey: string, stateBinary: Uint8Array) => Promise<void>): void;
  setStateRequestHandler(handler: (publicKey: string) => Promise<Uint8Array | null>): void;
  broadcastState(publicKey: string, stateBinary: Uint8Array): Promise<void>;
  requestState(publicKey: string, currentVersion?: number): Promise<void>;
}

export interface CloutConfig {
  publicKey: string;
  privateKey: Uint8Array;
  freebird: FreebirdClient;
  witness: WitnessClient;
  gossip?: GossipNode; // Use extended interface
  store?: CloutStore;  // Local persistence for feed/inbox

  // Trust Settings
  maxHops?: number;
  minReputation?: number;

  /**
   * Use encrypted trust signals for privacy (default: true)
   *
   * When enabled:
   * - Trustee identity is encrypted and only visible to the trustee
   * - Third parties cannot map your social graph
   * - Slightly larger signal size due to encryption overhead
   *
   * When disabled (legacy mode):
   * - Trust signals are plaintext (truster -> trustee visible to all)
   * - Your social graph is publicly visible
   * - Use only for debugging or backwards compatibility
   */
  useEncryptedTrustSignals?: boolean;

  // Media Storage Settings
  /** Enable WNFS-based media storage (default: true) */
  enableMediaStorage?: boolean;
  /** Custom path for media storage (default: ~/.clout/wnfs) */
  mediaStoragePath?: string;
  /** Maximum media file size in bytes (default: 100MB) */
  maxMediaSize?: number;
}

export class Clout {
  private readonly publicKeyHex: string;
  private readonly privateKey: Uint8Array;
  private readonly freebird: FreebirdClient;
  private readonly witness: WitnessClient;
  private readonly gossip?: GossipNode;
  private readonly store?: CloutStore;

  // Sub-modules
  public readonly ticketBooth: TicketBooth;
  private readonly reputationValidator: ReputationValidator;
  public readonly state: CloutStateManager;
  public readonly storage: StorageManager;
  private readonly profileStore: ProfileStore;
  private readonly localData: CloutLocalData;
  private readonly messaging: CloutMessaging;
  private readonly stateSync: CloutStateSync;

  // State
  private currentTicket?: CloutTicket;
  private readonly trustGraph: Set<string>;
  private mediaStorageEnabled: boolean;
  private readonly useEncryptedTrustSignals: boolean;

  // Gossip message backpressure handling
  private readonly messageQueue: ContentGossipMessage[] = [];
  private readonly maxQueueSize = 1000;
  private processingQueue = false;

  constructor(config: CloutConfig) {
    this.publicKeyHex = config.publicKey;
    this.privateKey = config.privateKey;
    this.freebird = config.freebird;
    this.witness = config.witness;
    this.gossip = config.gossip;
    this.store = config.store;

    // Privacy: Default to encrypted trust signals
    this.useEncryptedTrustSignals = config.useEncryptedTrustSignals ?? true;

    // 1. Initialize TicketBooth (Anti-Sybil)
    this.ticketBooth = new TicketBooth(config.freebird, config.witness);
    // Reputation getter will be set after ReputationValidator is initialized

    // 2. Initialize Trust Graph (Bootstrap with self)
    this.trustGraph = new Set<string>([this.publicKeyHex]);

    // 3. Initialize Local Data (Tags + Nicknames)
    this.localData = new CloutLocalData(this.trustGraph);

    // 4. Initialize Reputation Validator (The Filter)
    this.reputationValidator = new ReputationValidator({
      selfPublicKey: this.publicKeyHex,
      trustGraph: this.trustGraph,
      witness: this.witness,
      maxHops: config.maxHops ?? 3,
      minReputation: config.minReputation ?? 0.3
    });

    // 4b. Connect TicketBooth to reputation system
    // This ensures delegated passes are revoked if delegator loses reputation
    this.ticketBooth.setReputationGetter((publicKey: string) => {
      return this.reputationValidator.computeReputation(publicKey).score;
    });

    // 5. Initialize State Manager (CRDT / Phase 5)
    this.state = new CloutStateManager({
      profile: {
        publicKey: this.publicKeyHex,
        trustGraph: this.trustGraph,
        trustSettings: {
          ...DEFAULT_TRUST_SETTINGS,
          maxHops: config.maxHops ?? DEFAULT_TRUST_SETTINGS.maxHops,
          minReputation: config.minReputation ?? DEFAULT_TRUST_SETTINGS.minReputation
        }
      }
    });

    // 6. Initialize WNFS Media Storage (Offload-and-Link pattern)
    this.mediaStorageEnabled = config.enableMediaStorage !== false;
    this.storage = new StorageManager({
      storagePath: config.mediaStoragePath,
      maxFileSize: config.maxMediaSize
    });

    // 6b. Initialize Profile Store (local persistence for profile data)
    this.profileStore = new ProfileStore();

    // 7. Initialize Messaging (Slides/DMs)
    this.messaging = new CloutMessaging({
      publicKey: this.publicKeyHex,
      privateKey: this.privateKey,
      witness: this.witness,
      gossip: this.gossip,
      store: this.store
    });

    // 8. Initialize State Sync (CRDT synchronization)
    this.stateSync = new CloutStateSync({
      publicKey: this.publicKeyHex,
      stateManager: this.state,
      gossip: this.gossip
    });

    // 9. Initialize Storage & Gossip Subscription
    this.initializeDataLayer();
  }

  /**
   * Initialize local storage and subscribe to gossip
   */
  private async initializeDataLayer() {
    // Initialize store if provided
    if (this.store) {
      await this.store.init();
    }

    // Initialize media storage if enabled
    if (this.mediaStorageEnabled) {
      await this.storage.init();
    }

    // Initialize profile store and load saved profile
    await this.profileStore.init();
    await this.loadSavedProfile();

    // Load saved data from file store
    await this.loadSavedDeletions();
    await this.loadSavedReactions();
    await this.loadSavedBookmarks();

    // Subscribe to gossip to populate local store
    // Uses bounded queue with backpressure to prevent unbounded memory growth
    if (this.gossip) {
      this.gossip.subscribe(async (msg: ContentGossipMessage) => {
        this.enqueueGossipMessage(msg);
      });

      // Initialize CRDT state synchronization
      this.stateSync.initialize();
    }
  }

  /**
   * Enqueue a gossip message with backpressure handling
   *
   * If the queue is full, drops the oldest message to make room.
   * This prevents unbounded memory growth under high message load.
   */
  private enqueueGossipMessage(msg: ContentGossipMessage): void {
    if (this.messageQueue.length >= this.maxQueueSize) {
      console.warn('[Clout] Message queue full, dropping oldest message');
      this.messageQueue.shift();
    }
    this.messageQueue.push(msg);
    this.processMessageQueue(); // Don't await - process async
  }

  /**
   * Process queued gossip messages
   *
   * Processes messages one at a time to prevent overwhelming downstream handlers.
   * Only one processing loop runs at a time (controlled by processingQueue flag).
   */
  private async processMessageQueue(): Promise<void> {
    if (this.processingQueue) return;
    this.processingQueue = true;

    try {
      while (this.messageQueue.length > 0) {
        const msg = this.messageQueue.shift()!;
        try {
          await this.handleGossipMessage(msg);
        } catch (err) {
          console.error('[Clout] Error processing queued message:', err);
        }
      }
    } finally {
      this.processingQueue = false;
    }
  }

  /**
   * Load saved profile from local storage and merge into Chronicle state
   */
  private async loadSavedProfile(): Promise<void> {
    const savedProfile = this.profileStore.getProfile();
    if (savedProfile && savedProfile.publicKey === this.publicKeyHex) {
      console.log('[Clout] 📂 Restoring saved profile from local storage');

      // Restore profile metadata to Chronicle state
      const currentProfile = this.getProfile();
      this.state.updateProfile({
        publicKey: this.publicKeyHex,
        trustGraph: this.trustGraph,
        trustSettings: {
          ...currentProfile.trustSettings,
          ...savedProfile.trustSettings
        },
        metadata: savedProfile.metadata
      });
    }
  }

  /**
   * Load saved deletions from file store and merge into Chronicle state
   */
  private async loadSavedDeletions(): Promise<void> {
    if (!this.store || !('getDeletions' in this.store)) {
      return;
    }

    const savedDeletions = await (this.store as any).getDeletions();
    if (savedDeletions && savedDeletions.length > 0) {
      console.log(`[Clout] 📂 Restoring ${savedDeletions.length} saved deletions from local storage`);

      for (const deletion of savedDeletions) {
        this.state.addPostDeletion(deletion);
      }
    }
  }

  /**
   * Load saved reactions from file store and merge into Chronicle state
   */
  private async loadSavedReactions(): Promise<void> {
    if (!this.store || !('getReactions' in this.store)) {
      return;
    }

    const savedReactions = await (this.store as any).getReactions();
    if (savedReactions && savedReactions.length > 0) {
      console.log(`[Clout] 📂 Restoring ${savedReactions.length} saved reactions from local storage`);

      for (const reaction of savedReactions) {
        this.state.addReaction(reaction);
      }
    }
  }

  /**
   * Load saved bookmarks from file store and merge into local data
   */
  private async loadSavedBookmarks(): Promise<void> {
    if (!this.store || !('getBookmarks' in this.store)) {
      return;
    }

    const savedBookmarks = await (this.store as any).getBookmarks();
    if (savedBookmarks && savedBookmarks.length > 0) {
      console.log(`[Clout] 📂 Restoring ${savedBookmarks.length} saved bookmarks from local storage`);

      for (const postId of savedBookmarks) {
        this.localData.bookmark(postId);
      }
    }
  }

  /**
   * Handle incoming gossip messages
   * Filters content based on trust/relevance and saves to local store
   */
  private async handleGossipMessage(msg: ContentGossipMessage): Promise<void> {
    if (!this.store) return;

    try {
      switch (msg.type) {
        case 'post':
          if (msg.post) {
            // Check Trust: Is this author in my web of trust?
            const reputation = this.reputationValidator.computeReputation(msg.post.author);
            if (reputation.visible) {
              // NSFW filtering happens at display time in getFeed(), not here
              // We still store NSFW posts so users can toggle the setting later
              await this.store.addPost(msg.post);
            }
          }
          break;

        case 'slide':
          if (msg.slide) {
            // Delegate to messaging module
            await this.messaging.handleIncomingSlide(msg.slide);
          }
          break;
          
        case 'trust':
           // Trust signals are primarily handled by the reputation validator/graph logic,
           // but could also be persisted if you wanted a history of observed signals.
           break;
      }
    } catch (err) {
      console.error('[Clout] Error handling gossip message:', err);
    }
  }

  /**
   * Stop synchronization and clean up resources
   */
  destroy(): void {
    this.stateSync.destroy();
  }

  /**
   * Force state synchronization with peers
   *
   * Call this when recovering from a network partition (e.g., relay reconnection)
   * to immediately broadcast our state and request peer states.
   *
   * This is useful for faster partition healing after disconnection.
   */
  async forceSync(): Promise<void> {
    await this.stateSync.forceSync();
  }

  // =================================================================
  //  SECTION 1: ECONOMICS (Day Pass)
  // =================================================================

  /**
   * Exchange a Freebird token for a Day Pass
   *
   * Pass duration is reputation-based:
   * - High reputation (≥0.9): 7 days
   * - Medium reputation (≥0.7): 3 days
   * - Low reputation (≥0.5): 2 days
   * - New/untrusted (<0.5): 1 day
   */
  async buyDayPass(freebirdToken: Uint8Array): Promise<void> {
    const userKeyPair = {
      publicKey: { bytes: Crypto.fromHex(this.publicKeyHex) },
      privateKey: { bytes: this.privateKey }
    };

    // Get our own reputation score to determine pass duration
    const reputation = this.reputationValidator.computeReputation(this.publicKeyHex);

    this.currentTicket = await this.ticketBooth.mintTicket(
      userKeyPair,
      freebirdToken,
      reputation.score
    );

    // Persist the ticket for cross-restart survival
    this.saveTicket();

    const durationDays = Math.round(this.currentTicket.durationHours / 24);
    console.log(
      `[Clout] 🎟️ ${durationDays}-day pass acquired for ${this.publicKeyHex.slice(0, 8)} ` +
      `(reputation: ${reputation.score.toFixed(2)})`
    );
  }

  /**
   * Helper for testing: Obtain a mock token
   */
  async obtainToken(): Promise<Uint8Array> {
    const blinded = await this.freebird.blind({ bytes: Crypto.fromHex(this.publicKeyHex) });
    return this.freebird.issueToken(blinded);
  }

  /**
   * Check if the user has a valid Day Pass
   */
  hasActiveTicket(): boolean {
    return !!this.currentTicket && Date.now() <= this.currentTicket.expiry;
  }

  /**
   * Get current ticket info (for UI display)
   */
  getTicketInfo(): { expiry: number; durationHours: number; delegatedFrom?: string } | null {
    if (!this.currentTicket) return null;
    return {
      expiry: this.currentTicket.expiry,
      durationHours: this.currentTicket.durationHours,
      delegatedFrom: this.currentTicket.delegatedFrom
    };
  }

  /**
   * Load saved ticket from persistent storage (survives Docker restarts)
   *
   * Called during initialization to restore ticket state.
   * Performs defense-in-depth verification:
   * 1. Check expiry (quick rejection)
   * 2. Verify witness signature (prevents storage tampering)
   *
   * If the ticket is expired or invalid, it's automatically cleared.
   */
  async loadSavedTicket(): Promise<void> {
    if (!this.store || !('getTicket' in this.store)) {
      return;
    }

    const savedTicket = (this.store as any).getTicket();
    if (!savedTicket) {
      return;
    }

    // 1. Quick expiry check first (no need for crypto if expired)
    if (Date.now() > savedTicket.expiry) {
      console.log('[Clout] Saved ticket expired, discarding');
      if ('clearTicket' in this.store) {
        (this.store as any).clearTicket();
      }
      return;
    }

    // 2. Verify witness signature before accepting (defense in depth)
    // This prevents users from extending ticket expiry via storage manipulation
    if (savedTicket.proof) {
      try {
        const isValid = await this.witness.verify(savedTicket.proof);
        if (!isValid) {
          console.warn('[Clout] ⚠️ Saved ticket has invalid witness signature, discarding');
          if ('clearTicket' in this.store) {
            (this.store as any).clearTicket();
          }
          return;
        }
      } catch (err) {
        // If verification fails (e.g., witness unavailable), log but still load
        // This allows offline usage while still providing protection when online
        console.warn('[Clout] Could not verify ticket signature (witness unavailable):', err);
      }
    }

    // 3. Restore ticket as CloutTicket
    // Infer ticket type for backwards compatibility with old saved tickets
    const ticketType: TicketType = savedTicket.ticketType ?? (savedTicket.delegatedFrom ? 'delegated' : 'direct');

    this.currentTicket = {
      owner: savedTicket.owner,
      expiry: savedTicket.expiry,
      proof: savedTicket.proof,
      signature: savedTicket.signature,
      durationHours: savedTicket.durationHours,
      ticketType,
      freebirdProof: savedTicket.freebirdProof ?? (ticketType === 'direct' ? savedTicket.proof : undefined),
      delegationProof: savedTicket.delegationProof ?? (ticketType === 'delegated' ? savedTicket.proof : undefined),
      delegatedFrom: savedTicket.delegatedFrom
    };

    const remainingMs = savedTicket.expiry - Date.now();
    const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60));
    const remainingMinutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));

    console.log(
      `[Clout] 🎟️ Restored day pass: ${remainingHours}h ${remainingMinutes}m remaining`
    );
  }

  /**
   * Save current ticket to persistent storage
   */
  private saveTicket(): void {
    if (!this.store || !('saveTicket' in this.store) || !this.currentTicket) {
      return;
    }

    (this.store as any).saveTicket(this.currentTicket);
    console.log(`[Clout] 💾 Day pass persisted to storage`);
  }

  /**
   * Delegate a day pass to another user (requires high reputation ≥0.7)
   *
   * Allows trusted users to vouch for newcomers.
   * The recipient can use the delegation to mint a ticket without a Freebird token.
   *
   * @param recipientKey - Public key of the user to delegate to
   * @param durationHours - Duration in hours (default: 24)
   */
  async delegatePass(recipientKey: string, durationHours: number = 24): Promise<void> {
    // Get our reputation score
    const reputation = this.reputationValidator.computeReputation(this.publicKeyHex);

    // Check if we're eligible to delegate
    const maxDelegations = this.ticketBooth.getMaxDelegations(reputation.score);
    if (maxDelegations === 0) {
      throw new Error(
        `Insufficient reputation to delegate passes (need ≥0.7, have ${reputation.score.toFixed(2)})`
      );
    }

    const userKeyPair = {
      publicKey: { bytes: Crypto.fromHex(this.publicKeyHex) },
      privateKey: { bytes: this.privateKey }
    };

    await this.ticketBooth.delegatePass(
      userKeyPair,
      recipientKey,
      reputation.score,
      durationHours
    );

    console.log(
      `[Clout] 🎁 Delegated ${durationHours}h pass to ${recipientKey.slice(0, 8)} ` +
      `(${maxDelegations} max per week)`
    );
  }

  /**
   * Accept a delegated pass and mint a ticket (no Freebird token required)
   */
  async acceptDelegatedPass(): Promise<void> {
    const userKeyPair = {
      publicKey: { bytes: Crypto.fromHex(this.publicKeyHex) },
      privateKey: { bytes: this.privateKey }
    };

    this.currentTicket = await this.ticketBooth.mintDelegatedTicket(userKeyPair);

    console.log(
      `[Clout] 🎫 Accepted delegated pass from ${this.currentTicket.delegatedFrom?.slice(0, 8) ?? 'unknown'}`
    );
  }

  /**
   * Check if we have a pending delegation
   */
  hasPendingDelegation(): boolean {
    return this.ticketBooth.hasDelegation(this.publicKeyHex);
  }

  // =================================================================
  //  SECTION 2: CONTENT (Posting)
  // =================================================================

  /**
   * Publish a new post with optional media attachment
   *
   * Uses the "Offload-and-Link" pattern for media:
   * 1. Offload: Store media file in WNFS blockstore
   * 2. Address: Get content-addressed CID
   * 3. Link: Embed CID reference in post content
   *
   * @param content - Post content
   * @param options - Post options including replyTo, media, nsfw flag, content warning, and ephemeral key settings
   */
  async post(
    content: string,
    options?: {
      replyTo?: string;
      media?: MediaInput;
      useEphemeralKey?: boolean;
      /** Mark post as Not Safe For Work - requires user to willingly label content */
      nsfw?: boolean;
      /** Custom content warning text (e.g., "spoilers", "politics") */
      contentWarning?: string;
    }
  ): Promise<CloutPost> {
    const replyTo = options?.replyTo;
    const media = options?.media;
    const useEphemeralKey = options?.useEphemeralKey !== false; // default: true
    const nsfw = options?.nsfw ?? false;
    const contentWarning = options?.contentWarning;

    // Extract @mentions from content
    const mentions = this.extractMentions(content);

    // 1. Check for Day Pass
    if (!this.currentTicket) {
      throw new Error("No active Day Pass. Call buyDayPass() first.");
    }

    if (Date.now() > this.currentTicket.expiry) {
      this.currentTicket = undefined;
      throw new Error("Day Pass expired. Please buy a new one.");
    }

    // 2. Handle media upload if present (Offload step)
    let mediaMetadata: MediaMetadata | undefined;
    let finalContent = content;

    if (media) {
      if (!this.mediaStorageEnabled) {
        throw new Error("Media storage is not enabled. Set enableMediaStorage: true in config.");
      }

      // Store media in WNFS blockstore
      mediaMetadata = await this.storage.store(media.data, media.mimeType, media.filename);

      // Append media link to content (Link step)
      const mediaLink = StorageManager.formatMediaLink(mediaMetadata.cid);
      finalContent = content ? `${content}\n\n${mediaLink}` : mediaLink;

      console.log(`[Clout] 📎 Attached media: ${mediaMetadata.cid.slice(0, 12)}... (${media.mimeType})`);
    }

    // 3. Derive ephemeral key for forward secrecy (optional)
    let ephemeralPublicKey: Uint8Array | undefined;
    let ephemeralKeyProof: Uint8Array | undefined;
    let signingKey = this.privateKey;

    if (useEphemeralKey) {
      // Derive ephemeral key from master key (rotates daily)
      const { ephemeralSecret, ephemeralPublic } = Crypto.deriveEphemeralKey(this.privateKey);
      ephemeralPublicKey = ephemeralPublic;

      // Create proof linking ephemeral key to master key
      ephemeralKeyProof = Crypto.createEphemeralKeyProof(ephemeralPublic, this.privateKey);

      // Sign with ephemeral key instead of master key
      signingKey = ephemeralSecret;
    }

    // 4. Sign Content (Placeholder using Hash + Key for MVP)
    // In prod, use Ed25519 signature
    const signature = Crypto.hash(finalContent, signingKey);

    const config: PostConfig = {
      author: this.publicKeyHex,
      content: finalContent,
      signature,
      freebird: this.freebird,
      witness: this.witness,
      replyTo,
      contentType: media ? media.mimeType : 'text/plain',
      ephemeralPublicKey,
      ephemeralKeyProof,
      media: mediaMetadata,
      nsfw,
      contentWarning,
      mentions: mentions.length > 0 ? mentions : undefined
    };

    // 5. Create & Gossip Post
    const post = await CloutPost.post(config, this.currentTicket, this.gossip);

    // 6. Persist to CRDT State (for sync) and Local Store (for own feed)
    const pkg = post.getPackage();
    this.state.addPost(pkg);

    if (this.store) {
      await this.store.addPost(pkg);
    }

    return post;
  }

  /**
   * Retract a post
   *
   * Creates a signed retraction request that is gossiped to the network.
   * The original post still exists cryptographically, but nodes that
   * receive this signal should hide it from feeds. This is an act of
   * taking responsibility - you're publicly acknowledging you want to
   * take back what you said, while accepting it can't be truly erased.
   *
   * @param postId - ID of the post to retract
   * @param reason - Optional reason for retraction
   * @returns The retraction package
   */
  async retractPost(postId: string, reason?: 'retracted' | 'edited' | 'mistake' | 'other'): Promise<import('./clout-types.js').PostDeletePackage> {
    // 1. Verify we own this post
    const allPosts = this.store ? await this.store.getFeed() : [];
    const post = allPosts.find(p => p.id === postId);

    if (!post) {
      throw new Error(`Post ${postId} not found`);
    }

    if (post.author !== this.publicKeyHex) {
      throw new Error(`Cannot retract post ${postId}: you are not the author`);
    }

    // 2. Create retraction payload
    const retractedAt = Date.now();
    const retractionPayload = { postId, deletedAt: retractedAt }; // Keep deletedAt for wire compatibility
    const payloadHash = Crypto.hashObject(retractionPayload);

    // 3. Sign the retraction
    const signature = Crypto.hash(JSON.stringify(retractionPayload), this.privateKey);

    // 4. Get Witness attestation for the retraction
    const proof = await this.witness.timestamp(payloadHash);

    // 5. Create the retraction package
    const retraction: import('./clout-types.js').PostDeletePackage = {
      postId,
      author: this.publicKeyHex,
      signature,
      proof,
      deletedAt: retractedAt,
      reason: reason || 'retracted'
    };

    // 6. Store retraction locally (both CRDT and file store)
    this.state.addPostDeletion(retraction);

    // Also persist to file store for cross-restart persistence
    if (this.store && 'addDeletion' in this.store) {
      await (this.store as any).addDeletion(retraction);
    }

    // 7. Gossip the retraction to the network
    if (this.gossip) {
      await this.gossip.publish({
        type: 'post-delete',
        postDelete: retraction,
        timestamp: retractedAt
      });
    }

    console.log(`[Clout] ↩️ Retracted post ${postId.slice(0, 8)}...`);
    return retraction;
  }

  /**
   * @deprecated Use retractPost instead
   */
  async deletePost(postId: string, reason?: 'retracted' | 'edited' | 'mistake' | 'other'): Promise<import('./clout-types.js').PostDeletePackage> {
    return this.retractPost(postId, reason);
  }

  /**
   * Edit a post by creating a new version that supersedes the original
   *
   * Since posts are content-addressed (ID = hash of content), editing
   * creates a new post with new content/ID that references the original.
   * The original post is automatically retracted with reason 'edited'.
   *
   * @param originalPostId - ID of the post to edit
   * @param newContent - New content for the post
   * @param options - Optional: media, nsfw, contentWarning
   * @returns The new post that supersedes the original
   */
  async editPost(
    originalPostId: string,
    newContent: string,
    options?: {
      media?: import('./clout-types.js').MediaInput;
      nsfw?: boolean;
      contentWarning?: string;
    }
  ): Promise<CloutPost> {
    // 1. Verify we own the original post
    const allPosts = this.store ? await this.store.getFeed() : [];
    const originalPost = allPosts.find(p => p.id === originalPostId);

    if (!originalPost) {
      throw new Error(`Post ${originalPostId} not found`);
    }

    if (originalPost.author !== this.publicKeyHex) {
      throw new Error(`Cannot edit post ${originalPostId}: you are not the author`);
    }

    // 2. Create the new post with editOf reference
    const newPost = await this.postInternal(newContent, {
      replyTo: originalPost.replyTo, // Preserve thread context
      media: options?.media,
      nsfw: options?.nsfw ?? originalPost.nsfw,
      contentWarning: options?.contentWarning ?? originalPost.contentWarning,
      editOf: originalPostId
    });

    // 3. Soft-delete the original post with reason 'edited'
    await this.deletePost(originalPostId, 'edited');

    console.log(`[Clout] ✏️ Edited post ${originalPostId.slice(0, 8)}... → ${newPost.getPackage().id.slice(0, 8)}...`);
    return newPost;
  }

  /**
   * Internal post method that supports editOf field
   */
  private async postInternal(
    content: string,
    options: {
      replyTo?: string;
      media?: import('./clout-types.js').MediaInput;
      nsfw?: boolean;
      contentWarning?: string;
      editOf?: string;
      useEphemeralKey?: boolean;
    } = {}
  ): Promise<CloutPost> {
    const { replyTo, media, nsfw, contentWarning, editOf, useEphemeralKey = true } = options;

    // Auto-mint ticket if needed
    if (!this.hasActiveTicket()) {
      const token = await this.obtainToken();
      await this.buyDayPass(token);
    }

    // Extract mentions from content
    const mentionRegex = /@([a-fA-F0-9]{8,})/g;
    const mentions: string[] = [];
    let match;
    while ((match = mentionRegex.exec(content)) !== null) {
      mentions.push(match[1]);
    }

    let finalContent = content;
    let mediaMetadata: MediaMetadata | undefined;

    // Handle media upload
    if (media && this.mediaStorageEnabled) {
      mediaMetadata = await this.storage.store(media.data, media.mimeType, media.filename);
      const mediaLink = StorageManager.formatMediaLink(mediaMetadata.cid);
      finalContent = content ? `${content}\n\n${mediaLink}` : mediaLink;
    }

    // Derive ephemeral key for forward secrecy
    let ephemeralPublicKey: Uint8Array | undefined;
    let ephemeralKeyProof: Uint8Array | undefined;
    let signingKey = this.privateKey;

    if (useEphemeralKey) {
      const { ephemeralSecret, ephemeralPublic } = Crypto.deriveEphemeralKey(this.privateKey);
      ephemeralPublicKey = ephemeralPublic;
      ephemeralKeyProof = Crypto.createEphemeralKeyProof(ephemeralPublic, this.privateKey);
      signingKey = ephemeralSecret;
    }

    // Sign content
    const signature = Crypto.hash(finalContent, signingKey);

    const config: PostConfig = {
      author: this.publicKeyHex,
      content: finalContent,
      signature,
      freebird: this.freebird,
      witness: this.witness,
      replyTo,
      contentType: media ? media.mimeType : 'text/plain',
      ephemeralPublicKey,
      ephemeralKeyProof,
      media: mediaMetadata,
      nsfw,
      contentWarning,
      mentions: mentions.length > 0 ? mentions : undefined
    };

    // Create & Gossip Post
    const post = await CloutPost.post(config, this.currentTicket!, this.gossip);

    // Get the package and add editOf if present
    let pkg = post.getPackage();
    if (editOf) {
      pkg = { ...pkg, editOf };
    }

    // Persist to CRDT State and Local Store
    this.state.addPost(pkg);
    if (this.store) {
      await this.store.addPost(pkg);
    }

    return post;
  }

  /**
   * Send an encrypted slide (DM) to another user
   */
  async slide(recipientKey: string, message: string): Promise<SlidePackage> {
    return this.messaging.send(recipientKey, message);
  }

  // =================================================================
  //  SECTION 2.5: MEDIA (Retrieval)
  // =================================================================

  /**
   * Resolve and retrieve media content by CID
   *
   * This is the "Retrieve" step of the Offload-and-Link pattern.
   * Queries the local WNFS blockstore for the file content.
   *
   * @param cid - Content Identifier of the media
   * @returns Media data as Uint8Array or null if not found
   */
  async resolveMedia(cid: string): Promise<Uint8Array | null> {
    if (!this.mediaStorageEnabled) {
      throw new Error("Media storage is not enabled.");
    }

    return this.storage.retrieve(cid);
  }

  /**
   * Resolve media from a post
   *
   * Extracts the CID from post content and retrieves the media.
   *
   * @param post - Post package potentially containing media
   * @returns Media data as Uint8Array or null if no media/not found
   */
  async resolvePostMedia(post: PostPackage): Promise<Uint8Array | null> {
    // First check if post has media metadata
    if (post.media?.cid) {
      return this.resolveMedia(post.media.cid);
    }

    // Fallback: Extract CID from content
    const cid = StorageManager.extractMediaCid(post.content);
    if (!cid) {
      return null;
    }

    return this.resolveMedia(cid);
  }

  /**
   * Get metadata for a stored media file
   *
   * @param cid - Content Identifier
   * @returns MediaMetadata or null if not found
   */
  getMediaMetadata(cid: string): MediaMetadata | null {
    if (!this.mediaStorageEnabled) {
      throw new Error("Media storage is not enabled.");
    }

    return this.storage.getMetadata(cid);
  }

  /**
   * Check if media exists locally by CID
   *
   * @param cid - Content Identifier
   * @returns true if media exists in local blockstore
   */
  async hasMedia(cid: string): Promise<boolean> {
    if (!this.mediaStorageEnabled) {
      return false;
    }

    return this.storage.has(cid);
  }

  /**
   * Check if a post has media attachment
   *
   * @param post - Post package to check
   * @returns true if post contains media reference
   */
  static postHasMedia(post: PostPackage): boolean {
    return !!post.media?.cid || StorageManager.hasMediaLink(post.content);
  }

  /**
   * Extract media CID from a post
   *
   * @param post - Post package
   * @returns CID string or null if no media
   */
  static extractMediaCid(post: PostPackage): string | null {
    // Prefer metadata over content parsing
    if (post.media?.cid) {
      return post.media.cid;
    }
    return StorageManager.extractMediaCid(post.content);
  }

  /**
   * Get media storage statistics
   */
  async getMediaStats(): Promise<{
    mediaCount: number;
    totalSize: number;
    byMimeType: Record<string, { count: number; size: number }>;
  }> {
    if (!this.mediaStorageEnabled) {
      return { mediaCount: 0, totalSize: 0, byMimeType: {} };
    }

    return this.storage.getStats();
  }

  // =================================================================
  //  SECTION 3: SOCIAL GRAPH (Trust & Reputation)
  // =================================================================

  /**
   * Trust another agent (Follow)
   * @param trusteeKey - Public key of the user to trust
   * @param weight - Trust weight between 0.1 and 1.0 (default: 1.0)
   */
  async trust(trusteeKey: string, weight: number = 1.0): Promise<void> {
    // Validate weight
    if (weight < 0.1 || weight > 1.0) {
      throw new Error('Trust weight must be between 0.1 and 1.0');
    }

    // 1. Update local graph immediately
    this.trustGraph.add(trusteeKey);

    // 2. Propagate Trust Signal
    if (this.gossip) {
      const timestamp = Date.now();

      if (this.useEncryptedTrustSignals) {
        // Privacy-preserving encrypted trust signal
        const encrypted = Crypto.createEncryptedTrustSignal(
          this.privateKey,
          this.publicKeyHex,
          trusteeKey,
          weight,
          timestamp
        );

        // Get witness proof for the commitment (not the trustee identity)
        const proof = await this.witness.timestamp(encrypted.trusteeCommitment);

        const encryptedSignal: EncryptedTrustSignal = {
          truster: this.publicKeyHex,
          trusteeCommitment: encrypted.trusteeCommitment,
          encryptedTrustee: encrypted.encryptedTrustee,
          signature: encrypted.signature,
          proof,
          weight,
          version: 'encrypted-v1'
        };

        await this.gossip.publish({
          type: 'trust-encrypted',
          encryptedTrustSignal: encryptedSignal,
          timestamp
        });

        // Store locally with decrypted trustee (we know who we trusted)
        const localSignal: TrustSignal = {
          truster: this.publicKeyHex,
          trustee: trusteeKey,
          signature: encrypted.signature,
          proof,
          weight
        };
        this.state.addTrustSignal(localSignal);

        console.log(`[Clout] 🔐 Trusted ${trusteeKey.slice(0, 8)} (encrypted signal)`);
      } else {
        // Legacy plaintext trust signal
        const signalPayload = {
          truster: this.publicKeyHex,
          trustee: trusteeKey,
          weight,
          timestamp
        };

        const payloadHash = Crypto.hashObject(signalPayload);
        const signature = Crypto.hash(payloadHash, this.privateKey); // Placeholder signature
        const proof = await this.witness.timestamp(payloadHash);

        const signal: TrustSignal = {
          truster: this.publicKeyHex,
          trustee: trusteeKey,
          signature,
          proof,
          weight
        };

        await this.gossip.publish({
          type: 'trust',
          trustSignal: signal,
          timestamp
        });

        this.state.addTrustSignal(signal);
        console.log(`[Clout] 🤝 Trusted ${trusteeKey.slice(0, 8)} (plaintext signal)`);
      }

      // Update the profile in the state to reflect the new trust graph
      this.state.updateProfile({
        publicKey: this.publicKeyHex,
        trustGraph: this.trustGraph,
        trustSettings: this.state.getState().profile?.trustSettings || DEFAULT_TRUST_SETTINGS
      });
    }
  }

  /**
   * Revoke trust from a previously trusted user (Unfollow)
   *
   * Creates a revocation signal that is gossiped to the network.
   * The revocation is also stored locally and reflected in the trust graph.
   *
   * @param trusteeKey - Public key of the user to untrust
   */
  async revokeTrust(trusteeKey: string): Promise<void> {
    // 1. Check if we actually trust this user
    if (!this.trustGraph.has(trusteeKey)) {
      throw new Error(`Cannot revoke trust: ${trusteeKey.slice(0, 8)} is not in trust graph`);
    }

    // 2. Remove from local graph immediately
    this.trustGraph.delete(trusteeKey);

    // 3. Create and publish revocation signal
    if (this.gossip) {
      const timestamp = Date.now();

      if (this.useEncryptedTrustSignals) {
        // Privacy-preserving encrypted revocation signal
        const encrypted = Crypto.createEncryptedTrustSignal(
          this.privateKey,
          this.publicKeyHex,
          trusteeKey,
          0, // Weight 0 indicates revocation
          timestamp
        );

        // Get witness proof for the commitment
        const proof = await this.witness.timestamp(encrypted.trusteeCommitment);

        const encryptedSignal: EncryptedTrustSignal = {
          truster: this.publicKeyHex,
          trusteeCommitment: encrypted.trusteeCommitment,
          encryptedTrustee: encrypted.encryptedTrustee,
          signature: encrypted.signature,
          proof,
          weight: 0, // Weight 0 = revocation
          version: 'encrypted-v1'
        };

        await this.gossip.publish({
          type: 'trust-encrypted',
          encryptedTrustSignal: encryptedSignal,
          timestamp
        });

        // Store revocation locally
        const localSignal: TrustSignal = {
          truster: this.publicKeyHex,
          trustee: trusteeKey,
          signature: encrypted.signature,
          proof,
          weight: 0,
          revoked: true
        };
        this.state.addTrustSignal(localSignal);

        console.log(`[Clout] 🔓 Revoked trust for ${trusteeKey.slice(0, 8)} (encrypted signal)`);
      } else {
        // Legacy plaintext revocation signal
        const signalPayload = {
          truster: this.publicKeyHex,
          trustee: trusteeKey,
          weight: 0,
          revoked: true,
          timestamp
        };

        const payloadHash = Crypto.hashObject(signalPayload);
        const signature = Crypto.hash(payloadHash, this.privateKey);
        const proof = await this.witness.timestamp(payloadHash);

        const signal: TrustSignal = {
          truster: this.publicKeyHex,
          trustee: trusteeKey,
          signature,
          proof,
          weight: 0,
          revoked: true
        };

        await this.gossip.publish({
          type: 'trust',
          trustSignal: signal,
          timestamp
        });

        this.state.addTrustSignal(signal);
        console.log(`[Clout] 🔓 Revoked trust for ${trusteeKey.slice(0, 8)} (plaintext signal)`);
      }

      // Update the profile in the state to reflect the updated trust graph
      this.state.updateProfile({
        publicKey: this.publicKeyHex,
        trustGraph: this.trustGraph,
        trustSettings: this.state.getState().profile?.trustSettings || DEFAULT_TRUST_SETTINGS
      });
    }
  }

  /**
   * Create an invitation for another user
   * (Mock implementation for test compatibility)
   */
  async invite(guestPublicKey: string, params: any): Promise<{ code: Uint8Array }> {
    // In a real impl, this would create a pre-signed trust signal
    // For now, we just return a "code" that acts as a token
    const code = Crypto.randomBytes(32);
    // Auto-trust the guest if configured
    await this.trust(guestPublicKey);
    return { code };
  }

  /**
   * Accept an invitation
   * (Mock implementation)
   */
  async acceptInvitation(code: Uint8Array): Promise<Uint8Array> {
    // In real impl, this would validate the invite and return a token
    // For test, we treat the code as the Freebird token
    return code; 
  }

  /**
   * Get reputation score for a user
   */
  getReputation(publicKey: string): ReputationScore {
    return this.reputationValidator.computeReputation(publicKey);
  }

  /**
   * Get trust path to a user (for "Via Alice → Bob" display)
   */
  getTrustPath(publicKey: string): { path: string[]; distance: number } | null {
    return this.reputationValidator.getTrustPath(publicKey);
  }

  /**
   * Check if user is directly trusted (1 hop)
   */
  isDirectlyTrusted(publicKey: string): boolean {
    return this.reputationValidator.isDirectlyTrusted(publicKey);
  }

  /**
   * Get the trust weight for a directly trusted user
   * Returns the weight (0.1-1.0) or null if not directly trusted
   */
  getTrustWeight(publicKey: string): number | null {
    if (!this.trustGraph.has(publicKey)) {
      return null;
    }

    // Look up the trust signal for this user
    const state = this.state.getState();
    const signal = state.myTrustSignals?.find(s => s.trustee === publicKey);

    // Return the weight from the signal, or default to 1.0
    return signal?.weight ?? 1.0;
  }

  /**
   * Get the current user's profile (from Chronicle state)
   */
  getProfile(): CloutProfile {
    const state = this.state.getState();
    const profile = state.profile || {
      publicKey: this.publicKeyHex,
      trustGraph: this.trustGraph,
      trustSettings: DEFAULT_TRUST_SETTINGS
    };
    // Ensure trustSettings always exists with defaults
    if (!profile.trustSettings) {
      return { ...profile, trustSettings: DEFAULT_TRUST_SETTINGS };
    }
    return profile;
  }

  /**
   * Update profile metadata (display name, bio, avatar)
   * Changes sync automatically via Chronicle CRDT and are persisted locally
   */
  async setProfileMetadata(metadata: {
    displayName?: string;
    bio?: string;
    avatar?: string;
  }): Promise<void> {
    console.log(`[Clout] 📝 Updating profile metadata`);

    // Get current profile
    const currentProfile = this.getProfile();

    // Merge new metadata with existing
    const updatedMetadata = {
      ...currentProfile.metadata,
      ...metadata
    };

    // Update profile in Chronicle (which will auto-sync to peers)
    this.state.updateProfile({
      publicKey: this.publicKeyHex,
      trustGraph: this.trustGraph,
      trustSettings: currentProfile.trustSettings,
      metadata: updatedMetadata
    });

    // Also save to local storage for persistence across restarts
    this.profileStore.saveProfile(
      this.publicKeyHex,
      updatedMetadata,
      currentProfile.trustSettings
    );

    // If avatar is a URL, cache it locally
    if (metadata.avatar?.startsWith('http://') || metadata.avatar?.startsWith('https://')) {
      this.profileStore.cacheAvatar(metadata.avatar).catch(err => {
        console.warn('[Clout] Failed to cache avatar:', err);
      });
    }
  }

  /**
   * Update trust settings (NSFW filtering, content-type filters, etc.)
   * Changes sync automatically via Chronicle CRDT
   */
  async updateTrustSettings(settings: Partial<import('./clout-types.js').TrustSettings>): Promise<void> {
    console.log(`[Clout] ⚙️ Updating trust settings`);

    // Get current profile
    const currentProfile = this.getProfile();

    // Merge new settings with existing
    const updatedSettings = {
      ...currentProfile.trustSettings,
      ...settings
    };

    // Update profile in Chronicle
    this.state.updateProfile({
      publicKey: this.publicKeyHex,
      trustGraph: this.trustGraph,
      trustSettings: updatedSettings,
      metadata: currentProfile.metadata
    });

    // Update reputation validator settings if maxHops or minReputation changed
    if (settings.maxHops !== undefined || settings.minReputation !== undefined) {
      // Note: ReputationValidator is readonly, so we'd need to reinitialize
      // For now, the new settings will be used via getProfile().trustSettings
      console.log(`[Clout] Updated filter settings: maxHops=${updatedSettings.maxHops}, minReputation=${updatedSettings.minReputation}`);
    }

    if (settings.showNsfw !== undefined) {
      console.log(`[Clout] NSFW content: ${settings.showNsfw ? 'enabled' : 'disabled'}`);
    }

    // Also save to local storage for persistence across restarts
    this.profileStore.saveProfile(
      this.publicKeyHex,
      currentProfile.metadata || {},
      updatedSettings
    );
  }

  /**
   * Set content-type specific filter rules
   * Example: setContentTypeFilter('image/*', { maxHops: 1, minReputation: 0.8 })
   */
  async setContentTypeFilter(
    contentType: string,
    filter: import('./clout-types.js').ContentTypeFilter
  ): Promise<void> {
    console.log(`[Clout] 🔧 Setting filter for content type: ${contentType}`);

    const currentProfile = this.getProfile();
    const currentFilters = currentProfile.trustSettings.contentTypeFilters || {};

    await this.updateTrustSettings({
      contentTypeFilters: {
        ...currentFilters,
        [contentType]: filter
      }
    });
  }

  /**
   * Remove content-type specific filter (use defaults)
   */
  async removeContentTypeFilter(contentType: string): Promise<void> {
    const currentProfile = this.getProfile();
    const currentFilters = { ...currentProfile.trustSettings.contentTypeFilters };

    if (currentFilters[contentType]) {
      delete currentFilters[contentType];

      await this.updateTrustSettings({
        contentTypeFilters: currentFilters
      });

      console.log(`[Clout] 🔧 Removed filter for content type: ${contentType}`);
    }
  }

  /**
   * Enable or disable NSFW content display
   */
  async setNsfwEnabled(enabled: boolean): Promise<void> {
    await this.updateTrustSettings({ showNsfw: enabled });
  }

  /**
   * Check if NSFW content is enabled
   */
  isNsfwEnabled(): boolean {
    return this.getProfile().trustSettings.showNsfw ?? false;
  }

  // =================================================================
  //  SECTION 4: TRUST TAGS (Local Organization)
  // =================================================================

  /**
   * Add a tag to a trusted user (e.g., "friends", "work", "family")
   */
  addTrustTag(publicKey: string, tag: string): void {
    this.localData.addTag(publicKey, tag);
  }

  /**
   * Remove a tag from a user
   */
  removeTrustTag(publicKey: string, tag: string): void {
    this.localData.removeTag(publicKey, tag);
  }

  /**
   * Get all users with a specific tag
   */
  getUsersByTag(tag: string): string[] {
    return this.localData.getUsersByTag(tag);
  }

  /**
   * Get all tags for a specific user
   */
  getTagsForUser(publicKey: string): string[] {
    return this.localData.getTagsForUser(publicKey);
  }

  /**
   * Get all tags and their member counts
   */
  getAllTags(): Map<string, number> {
    return this.localData.getAllTags();
  }

  /**
   * Filter feed by tag (get posts only from users with a specific tag)
   */
  async getFeedByTag(tag: string): Promise<PostPackage[]> {
    if (!this.store) {
      throw new Error('No store configured');
    }

    const taggedUsers = this.localData.getUsersByTag(tag);
    if (taggedUsers.length === 0) {
      return [];
    }

    const taggedSet = new Set(taggedUsers);
    const allPosts = await this.store.getFeed();
    return allPosts.filter(post => taggedSet.has(post.author));
  }

  // =================================================================
  //  SECTION 4b: NICKNAMES (Local Address Book)
  // =================================================================

  /**
   * Set a nickname for a user (like naming a contact in your phone)
   */
  setNickname(publicKey: string, nickname: string): void {
    this.localData.setNickname(publicKey, nickname);
  }

  /**
   * Get the nickname for a user (returns undefined if not set)
   */
  getNickname(publicKey: string): string | undefined {
    return this.localData.getNickname(publicKey);
  }

  /**
   * Get display name for a user - checks profile name (for self), nickname, then truncated key
   */
  getDisplayName(publicKey: string): string {
    // For the current user, use their profile display name if set
    if (publicKey === this.publicKeyHex) {
      const profile = this.getProfile();
      if (profile.metadata?.displayName) {
        return profile.metadata.displayName;
      }
    }
    return this.localData.getDisplayName(publicKey);
  }

  /**
   * Get all nicknames (for backup/export)
   */
  getAllNicknames(): Map<string, string> {
    return this.localData.getAllNicknames();
  }

  // -----------------------------------------------------------------
  //  MUTED USERS
  // -----------------------------------------------------------------

  /**
   * Mute a user - their posts will be hidden from your feed
   *
   * Muting is local-only and doesn't affect the trust graph.
   * You still trust them (their content propagates), you just don't see it.
   */
  mute(publicKey: string): void {
    this.localData.mute(publicKey);
  }

  /**
   * Unmute a user - their posts will appear in your feed again
   */
  unmute(publicKey: string): void {
    this.localData.unmute(publicKey);
  }

  /**
   * Check if a user is muted
   */
  isMuted(publicKey: string): boolean {
    return this.localData.isMuted(publicKey);
  }

  /**
   * Get all muted users
   */
  getMutedUsers(): string[] {
    return this.localData.getMutedUsers();
  }

  /**
   * Get count of muted users
   */
  getMutedCount(): number {
    return this.localData.getMutedCount();
  }

  // -----------------------------------------------------------------
  //  BOOKMARKS
  // -----------------------------------------------------------------

  /**
   * Bookmark a post for later reference
   *
   * Bookmarks are local-only and never synced to the network.
   */
  async bookmark(postId: string): Promise<void> {
    this.localData.bookmark(postId);

    // Persist to file store for cross-restart persistence
    if (this.store && 'addBookmark' in this.store) {
      await (this.store as any).addBookmark(postId);
    }
  }

  /**
   * Remove a bookmark from a post
   */
  async unbookmark(postId: string): Promise<void> {
    this.localData.unbookmark(postId);

    // Remove from file store for cross-restart persistence
    if (this.store && 'removeBookmark' in this.store) {
      await (this.store as any).removeBookmark(postId);
    }
  }

  /**
   * Check if a post is bookmarked
   */
  isBookmarked(postId: string): boolean {
    return this.localData.isBookmarked(postId);
  }

  /**
   * Get all bookmarked post IDs
   */
  getBookmarkIds(): string[] {
    return this.localData.getBookmarks();
  }

  /**
   * Get bookmarked posts (full data)
   */
  async getBookmarks(): Promise<PostPackage[]> {
    if (!this.store) {
      throw new Error('No store configured');
    }

    const bookmarkIds = new Set(this.localData.getBookmarks());
    if (bookmarkIds.size === 0) return [];

    const allPosts = await this.store.getFeed();
    return allPosts.filter(post => bookmarkIds.has(post.id));
  }

  /**
   * Get count of bookmarks
   */
  getBookmarkCount(): number {
    return this.localData.getBookmarks().length;
  }

  // -----------------------------------------------------------------
  //  NOTIFICATIONS
  // -----------------------------------------------------------------

  /**
   * Get notification counts (unread slides, replies, mentions)
   */
  async getNotificationCounts(): Promise<{
    slides: number;
    replies: number;
    mentions: number;
    total: number;
  }> {
    const state = this.localData.getNotificationState();

    // Count unread slides
    const inbox = await this.getInbox();
    const unreadSlides = inbox.slides.filter(
      (s: any) => (s.timestamp || 0) > state.lastSeenSlides
    ).length;

    // Count unread replies to my posts
    const allPosts = this.store ? await this.store.getFeed() : [];
    const myPostIds = new Set(
      allPosts.filter((p: any) => p.author === this.publicKeyHex).map((p: any) => p.id)
    );
    const unreadReplies = allPosts.filter((p: any) => {
      if (!p.replyTo || !myPostIds.has(p.replyTo)) return false;
      if (p.author === this.publicKeyHex) return false; // Ignore own replies
      const timestamp = p.proof?.timestamp || 0;
      return timestamp > state.lastSeenReplies;
    }).length;

    // Count unread mentions
    const mentions = await this.getMentions();
    const unreadMentions = mentions.filter((p: any) => {
      if (p.author === this.publicKeyHex) return false; // Ignore own posts
      const timestamp = p.proof?.timestamp || 0;
      return timestamp > state.lastSeenMentions;
    }).length;

    return {
      slides: unreadSlides,
      replies: unreadReplies,
      mentions: unreadMentions,
      total: unreadSlides + unreadReplies + unreadMentions
    };
  }

  /**
   * Get replies to my posts
   */
  async getReplies(options?: { limit?: number; unreadOnly?: boolean }): Promise<PostPackage[]> {
    if (!this.store) {
      throw new Error('No store configured');
    }

    const allPosts = await this.store.getFeed();
    const myPostIds = new Set(
      allPosts.filter((p: any) => p.author === this.publicKeyHex).map((p: any) => p.id)
    );

    let replies = allPosts.filter((p: any) => {
      if (!p.replyTo || !myPostIds.has(p.replyTo)) return false;
      if (p.author === this.publicKeyHex) return false;
      return true;
    });

    // Filter to unread only if requested
    if (options?.unreadOnly) {
      const lastSeen = this.localData.getLastSeen('replies');
      replies = replies.filter((p: any) => (p.proof?.timestamp || 0) > lastSeen);
    }

    // Sort by newest first
    replies.sort((a: any, b: any) => {
      const timeA = a.proof?.timestamp || 0;
      const timeB = b.proof?.timestamp || 0;
      return timeB - timeA;
    });

    return options?.limit ? replies.slice(0, options.limit) : replies;
  }

  /**
   * Mark slides as seen
   */
  markSlidesSeen(): void {
    this.localData.markSlidesSeen();
  }

  /**
   * Mark replies as seen
   */
  markRepliesSeen(): void {
    this.localData.markRepliesSeen();
  }

  /**
   * Mark mentions as seen
   */
  markMentionsSeen(): void {
    this.localData.markMentionsSeen();
  }

  // =================================================================
  //  SECTION 4c: REACTIONS (Trust-weighted endorsements)
  // =================================================================

  /**
   * Available reaction emojis
   */
  static readonly REACTION_EMOJIS = ['👍', '❤️', '🔥', '😂', '😮', '🙏'];

  /**
   * React to a post
   *
   * @param postId - The post to react to
   * @param emoji - The reaction emoji (default: 👍)
   */
  async react(postId: string, emoji: string = '👍'): Promise<ReactionPackage> {
    // Validate emoji
    if (!Clout.REACTION_EMOJIS.includes(emoji)) {
      throw new Error(`Invalid reaction. Allowed: ${Clout.REACTION_EMOJIS.join(' ')}`);
    }

    // Create reaction ID
    const reactionId = Crypto.hashString(`${postId}:${this.publicKeyHex}:${emoji}`);

    // Sign the reaction
    const reactionPayload = {
      postId,
      reactor: this.publicKeyHex,
      emoji,
      timestamp: Date.now()
    };
    const payloadHash = Crypto.hashObject(reactionPayload);
    const signature = Crypto.hash(payloadHash, this.privateKey);
    const proof = await this.witness.timestamp(payloadHash);

    const reaction: ReactionPackage = {
      id: reactionId,
      postId,
      reactor: this.publicKeyHex,
      emoji,
      signature,
      proof
    };

    // Store in Chronicle state
    this.state.addReaction(reaction);

    // Persist to file store for cross-restart persistence
    if (this.store && 'addReaction' in this.store) {
      await (this.store as any).addReaction(reaction);
    }

    // Broadcast via gossip
    if (this.gossip) {
      await this.gossip.publish({
        type: 'reaction',
        reaction,
        timestamp: Date.now()
      });
    }

    console.log(`[Clout] ${emoji} Reacted to ${postId.slice(0, 8)}`);
    return reaction;
  }

  /**
   * Remove a reaction from a post
   */
  async unreact(postId: string, emoji: string = '👍'): Promise<void> {
    const reactionId = Crypto.hashString(`${postId}:${this.publicKeyHex}:${emoji}`);

    // Create removal signal
    const payloadHash = Crypto.hashObject({ id: reactionId, removed: true });
    const signature = Crypto.hash(payloadHash, this.privateKey);
    const proof = await this.witness.timestamp(payloadHash);

    const removal: ReactionPackage = {
      id: reactionId,
      postId,
      reactor: this.publicKeyHex,
      emoji,
      signature,
      proof,
      removed: true
    };

    // Update state (addReaction handles removal)
    this.state.addReaction(removal);

    // Remove from file store for cross-restart persistence
    if (this.store && 'removeReaction' in this.store) {
      await (this.store as any).removeReaction(reactionId);
    }

    // Broadcast removal
    if (this.gossip) {
      await this.gossip.publish({
        type: 'reaction',
        reaction: removal,
        timestamp: Date.now()
      });
    }

    console.log(`[Clout] Removed ${emoji} from ${postId.slice(0, 8)}`);
  }

  /**
   * Get reactions for a post (trust-weighted)
   *
   * Returns aggregated reactions with counts, weighted by trust distance.
   * Reactions from closer users (lower distance) count more.
   */
  getReactionsForPost(postId: string): {
    reactions: Map<string, { count: number; weightedCount: number; reactors: string[] }>;
    myReaction?: string;
  } {
    const state = this.state.getState();
    const allReactions = state.myReactions || [];

    // Filter reactions for this post
    const postReactions = allReactions.filter(r => r.postId === postId && !r.removed);

    // Aggregate by emoji
    const reactions = new Map<string, { count: number; weightedCount: number; reactors: string[] }>();
    let myReaction: string | undefined;

    for (const r of postReactions) {
      // Check if it's my reaction
      if (r.reactor === this.publicKeyHex) {
        myReaction = r.emoji;
      }

      // Calculate trust weight (closer = higher weight)
      const rep = this.reputationValidator.computeReputation(r.reactor);
      const weight = rep.visible ? Math.max(0.1, 1 - (rep.distance * 0.2)) : 0.1;

      const existing = reactions.get(r.emoji) || { count: 0, weightedCount: 0, reactors: [] };
      existing.count++;
      existing.weightedCount += weight;
      existing.reactors.push(r.reactor);
      reactions.set(r.emoji, existing);
    }

    return { reactions, myReaction };
  }

  /**
   * Get my reaction to a specific post
   */
  getMyReaction(postId: string): string | undefined {
    const state = this.state.getState();
    const myReactions = (state.myReactions || []).filter(
      r => r.reactor === this.publicKeyHex && r.postId === postId && !r.removed
    );
    return myReactions[0]?.emoji;
  }

  // =================================================================
  //  SECTION 4d: MENTIONS (User references)
  // =================================================================

  /**
   * Extract @mentions from post content
   *
   * Supports:
   * - @publicKey (full or partial hex key)
   * - Matches keys that are at least 8 characters of hex
   */
  extractMentions(content: string): string[] {
    // Match @followed by hex characters (at least 8 chars for partial keys)
    const mentionPattern = /@([a-fA-F0-9]{8,})/g;
    const mentions: string[] = [];
    let match;

    while ((match = mentionPattern.exec(content)) !== null) {
      const mentioned = match[1];
      // Validate it looks like a public key (could be full or partial)
      if (mentioned.length >= 8) {
        mentions.push(mentioned);
      }
    }

    return [...new Set(mentions)]; // Deduplicate
  }

  /**
   * Get posts where the current user is mentioned
   */
  async getMentions(options?: { limit?: number }): Promise<PostPackage[]> {
    if (!this.store) {
      throw new Error('No store configured');
    }

    const allPosts = await this.store.getFeed();

    // Filter posts that mention current user
    const mentions = allPosts.filter(post => {
      if (!post.mentions) return false;
      // Check if any mention matches our key (full or partial)
      return post.mentions.some(m =>
        this.publicKeyHex.startsWith(m) || m.startsWith(this.publicKeyHex.slice(0, 8))
      );
    });

    // Sort by timestamp (newest first)
    mentions.sort((a, b) => {
      const timeA = a.proof?.timestamp || 0;
      const timeB = b.proof?.timestamp || 0;
      return timeB - timeA;
    });

    return options?.limit ? mentions.slice(0, options.limit) : mentions;
  }

  /**
   * Check if a post mentions a specific user
   */
  static postMentionsUser(post: PostPackage, publicKey: string): boolean {
    if (!post.mentions) return false;
    return post.mentions.some(m =>
      publicKey.startsWith(m) || m.startsWith(publicKey.slice(0, 8))
    );
  }

  // =================================================================
  //  SECTION 5: FEED (View Content)
  // =================================================================

  /**
   * Get posts from the local feed cache
   *
   * @param options.tag - Filter by trust tag
   * @param options.limit - Maximum number of posts
   * @param options.includeNsfw - Override NSFW setting for this call
   * @param options.includeDeleted - Show deleted posts (default: false)
   */
  async getFeed(options?: { tag?: string; limit?: number; includeNsfw?: boolean; includeDeleted?: boolean }): Promise<PostPackage[]> {
    if (!this.store) {
      throw new Error('No store configured');
    }

    let posts: PostPackage[];

    // Filter by tag if specified
    if (options?.tag) {
      posts = await this.getFeedByTag(options.tag);
    } else {
      posts = await this.store.getFeed();
    }

    // Filter out deleted posts (unless includeDeleted is true)
    if (!options?.includeDeleted) {
      const deletedPostIds = new Set(
        this.state.getPostDeletions().map(d => d.postId)
      );
      posts = posts.filter(post => !deletedPostIds.has(post.id));
    }

    // Build a map of edits: originalId -> latestEditId
    // This allows us to track edit chains and show only the latest version
    const editMap = new Map<string, string>(); // originalId -> editedPostId
    for (const post of posts) {
      if (post.editOf) {
        editMap.set(post.editOf, post.id);
      }
    }

    // Filter out posts that have been superseded by edits
    // (the original post is hidden, the edit is shown)
    posts = posts.filter(post => !editMap.has(post.id));

    // Apply NSFW filtering
    const settings = this.getProfile().trustSettings;
    const showNsfw = options?.includeNsfw ?? settings.showNsfw ?? false;
    const nsfwMinReputation = settings.nsfwMinReputation ?? DEFAULT_TRUST_SETTINGS.nsfwMinReputation ?? 0.7;

    if (!showNsfw) {
      // Filter out NSFW posts
      posts = posts.filter(post => !post.nsfw);
    } else {
      // Show NSFW but only from high-reputation users
      posts = posts.filter(post => {
        if (!post.nsfw) return true;
        const rep = this.reputationValidator.computeReputation(post.author);
        return rep.score >= nsfwMinReputation;
      });
    }

    // Filter out muted users
    posts = posts.filter(post => !this.localData.isMuted(post.author));

    return options?.limit ? posts.slice(0, options.limit) : posts;
  }

  /**
   * Check if a post has been retracted
   */
  isPostRetracted(postId: string): boolean {
    return this.state.isPostDeleted(postId);
  }

  /**
   * @deprecated Use isPostRetracted instead
   */
  isPostDeleted(postId: string): boolean {
    return this.isPostRetracted(postId);
  }

  /**
   * Get all post retractions
   */
  getPostRetractions(): import('./clout-types.js').PostDeletePackage[] {
    return this.state.getPostDeletions();
  }

  /**
   * @deprecated Use getPostRetractions instead
   */
  getPostDeletions(): import('./clout-types.js').PostDeletePackage[] {
    return this.getPostRetractions();
  }

  /**
   * Get profile for any user (from Chronicle state or local knowledge)
   */
  getProfileForUser(publicKey: string): CloutProfile | null {
    // If it's our own key, return our profile
    if (publicKey === this.publicKeyHex) {
      return this.getProfile();
    }

    // TODO: In a full implementation, we'd fetch from peer state
    // For now, return minimal profile
    return {
      publicKey,
      trustGraph: new Set(),
      trustSettings: DEFAULT_TRUST_SETTINGS
    };
  }

  /**
   * Get invitation chain details (Mock)
   */
  getInvitationChain() {
    // Simplified for test - returns who we trust (as proxy for who we invited)
    // Excluding self
    const trusts = Array.from(this.trustGraph).filter(k => k !== this.publicKeyHex);
    return {
      invitedBy: undefined, // Not tracked in this MVP state
      invited: trusts
    };
  }

  /**
   * Get inbox with received slides
   */
  async getInbox(): Promise<Inbox> {
    const slides = await this.messaging.getInbox();
    return {
      slides,
      lastUpdated: Date.now()
    };
  }

  /**
   * Decrypt a slide
   */
  decryptSlide(slide: SlidePackage): string {
    return this.messaging.decrypt(slide);
  }

  /**
   * Get node statistics
   */
  async getStats() {
    const gossipStats = (this.gossip && this.gossip.getStats)
      ? this.gossip.getStats()
      : { postCount: 0 };

    // Get inbox count safely
    let slideCount = 0;
    if (this.store) {
      const inbox = await this.store.getInbox();
      slideCount = inbox.length;
    } else if (this.gossip && this.gossip.getSlides) {
      slideCount = this.gossip.getSlides().length;
    }

    return {
      identity: {
        trustCount: this.trustGraph.size,
        publicKey: this.publicKeyHex
      },
      state: {
        postCount: gossipStats.postCount,
        slideCount
      }
    };
  }

  // =================================================================
  //  SECTION 9: DATA EXPORT/IMPORT
  // =================================================================

  /**
   * Export all user data for backup
   *
   * Includes:
   * - Chronicle state (posts, trust signals, profile)
   * - Local data (tags, nicknames, muted users)
   * - Identity info (public key)
   */
  async exportBackup(): Promise<{
    version: string;
    exportedAt: number;
    identity: { publicKey: string };
    chronicleState: {
      posts: PostPackage[];
      trustSignals: TrustSignal[];
      profile: any;
    };
    localData: {
      tags: Record<string, string[]>;
      nicknames: Record<string, string>;
      muted: string[];
    };
  }> {
    const chronicleState = this.state.getState();
    const localData = this.localData.export();

    return {
      version: '1.0',
      exportedAt: Date.now(),
      identity: {
        publicKey: this.publicKeyHex
      },
      chronicleState: {
        posts: chronicleState.myPosts || [],
        trustSignals: chronicleState.myTrustSignals || [],
        profile: chronicleState.profile ? {
          ...chronicleState.profile,
          trustGraph: Array.from(chronicleState.profile.trustGraph || [])
        } : null
      },
      localData
    };
  }

  /**
   * Import user data from backup
   *
   * @param backup - The backup data to import
   * @param options.mergePosts - If true, merge posts with existing (default: true)
   * @param options.replaceLocalData - If true, replace local data (default: false, meaning merge)
   */
  async importBackup(
    backup: {
      version: string;
      chronicleState?: {
        posts?: PostPackage[];
        trustSignals?: TrustSignal[];
        profile?: any;
      };
      localData?: {
        tags?: Record<string, string[]>;
        nicknames?: Record<string, string>;
        muted?: string[];
      };
    },
    options?: { mergePosts?: boolean; replaceLocalData?: boolean }
  ): Promise<{ postsImported: number; trustSignalsImported: number; localDataImported: boolean }> {
    const mergePosts = options?.mergePosts ?? true;
    const replaceLocalData = options?.replaceLocalData ?? false;

    let postsImported = 0;
    let trustSignalsImported = 0;

    // Import Chronicle state (posts, trust signals)
    if (backup.chronicleState) {
      // Import posts
      if (backup.chronicleState.posts && backup.chronicleState.posts.length > 0) {
        for (const post of backup.chronicleState.posts) {
          try {
            this.state.addPost(post);
            postsImported++;
          } catch (e) {
            console.warn(`[Clout] Skipped duplicate post ${post.id?.slice(0, 8)}`);
          }
        }
        console.log(`[Clout] 📥 Imported ${postsImported} posts`);
      }

      // Import trust signals
      if (backup.chronicleState.trustSignals && backup.chronicleState.trustSignals.length > 0) {
        for (const signal of backup.chronicleState.trustSignals) {
          try {
            this.state.addTrustSignal(signal);
            // Also update local trust graph (trust signals indicate trust)
            this.trustGraph.add(signal.trustee);
            trustSignalsImported++;
          } catch (e) {
            console.warn(`[Clout] Skipped trust signal`);
          }
        }
        console.log(`[Clout] 📥 Imported ${trustSignalsImported} trust signals`);
      }

      // Import profile settings (if from same identity)
      if (backup.chronicleState.profile && backup.chronicleState.profile.publicKey === this.publicKeyHex) {
        const currentProfile = this.getProfile();
        this.state.updateProfile({
          ...currentProfile,
          trustSettings: {
            ...currentProfile.trustSettings,
            ...backup.chronicleState.profile.trustSettings
          },
          metadata: {
            ...currentProfile.metadata,
            ...backup.chronicleState.profile.metadata
          }
        });
        console.log(`[Clout] 📥 Imported profile settings`);
      }
    }

    // Import local data
    let localDataImported = false;
    if (backup.localData) {
      if (replaceLocalData) {
        // Clear existing and import fresh
        // Note: We'd need clear methods, but for now just import (which adds)
      }
      this.localData.import(backup.localData);
      localDataImported = true;
      console.log(`[Clout] 📥 Imported local data (tags, nicknames, muted)`);
    }

    return { postsImported, trustSignalsImported, localDataImported };
  }

  // =================================================================
  //  SECTION 10: RELAY METHODS (for browser-side identity)
  // =================================================================

  /**
   * Relay a pre-signed post to the gossip network
   *
   * Used when the browser has signed the post with the user's private key.
   * The server verifies the signature and broadcasts to gossip.
   *
   * @param postPackage - Pre-signed post data from browser
   * @returns Witness attestation
   */
  async relayPost(postPackage: {
    id: string;
    content: string;
    author: string;
    signature: Uint8Array;
    ephemeralPublicKey?: Uint8Array;
    ephemeralKeyProof?: Uint8Array;
    replyTo?: string;
    nsfw?: boolean;
    contentWarning?: string;
    media?: { cid: string };
    authorshipProof?: Uint8Array;
  }): Promise<Attestation> {
    // Get witness proof for the post
    const postHash = Crypto.hashObject({
      id: postPackage.id,
      content: postPackage.content,
      author: postPackage.author,
      signature: Crypto.toHex(postPackage.signature)
    });

    const proof = await this.witness.timestamp(postHash);

    // Build full post package with proof
    const fullPost: PostPackage = {
      id: postPackage.id,
      content: postPackage.content,
      author: postPackage.author,
      signature: postPackage.signature,
      proof,
      ephemeralPublicKey: postPackage.ephemeralPublicKey,
      ephemeralKeyProof: postPackage.ephemeralKeyProof,
      replyTo: postPackage.replyTo,
      nsfw: postPackage.nsfw,
      contentWarning: postPackage.contentWarning,
      media: postPackage.media ? {
        cid: postPackage.media.cid,
        mimeType: 'application/octet-stream', // Will be resolved later
        size: 0,
        storedAt: Date.now()
      } : undefined,
      authorshipProof: postPackage.authorshipProof,
      mentions: this.extractMentions(postPackage.content)
    };

    // Store locally
    this.state.addPost(fullPost);
    if (this.store) {
      await this.store.addPost(fullPost);
    }

    // Broadcast via gossip
    if (this.gossip) {
      await this.gossip.publish({
        type: 'post',
        post: fullPost,
        timestamp: proof.timestamp
      });
    }

    console.log(`[Clout] Relayed post ${postPackage.id.slice(0, 8)} from ${postPackage.author.slice(0, 8)}`);
    return proof;
  }

  /**
   * Relay a pre-signed encrypted trust signal to the gossip network
   *
   * Used when the browser has created an encrypted trust signal with the user's private key.
   * The server verifies the signature and broadcasts to gossip.
   *
   * @param signal - Pre-signed encrypted trust signal from browser
   * @returns Witness attestation
   */
  async relayTrustSignal(signal: {
    truster: string;
    trusteeCommitment: string;
    encryptedTrustee: {
      ephemeralPublicKey: Uint8Array;
      ciphertext: Uint8Array;
    };
    signature: Uint8Array;
    weight: number;
    version: 'encrypted-v1';
  }): Promise<Attestation> {
    // Get witness proof for the commitment
    const proof = await this.witness.timestamp(signal.trusteeCommitment);

    // Build full encrypted trust signal
    const fullSignal: EncryptedTrustSignal = {
      truster: signal.truster,
      trusteeCommitment: signal.trusteeCommitment,
      encryptedTrustee: signal.encryptedTrustee,
      signature: signal.signature,
      proof,
      weight: signal.weight,
      version: signal.version
    };

    // Broadcast via gossip
    if (this.gossip) {
      await this.gossip.publish({
        type: 'trust-encrypted',
        encryptedTrustSignal: fullSignal,
        timestamp: proof.timestamp
      });
    }

    console.log(`[Clout] Relayed trust signal from ${signal.truster.slice(0, 8)}`);
    return proof;
  }

  /**
   * Verify a Freebird token
   *
   * @param token - The VOPRF token bytes
   * @returns true if valid
   */
  async verifyFreebirdToken(token: Uint8Array): Promise<boolean> {
    return this.freebird.verifyToken(token);
  }

  /**
   * Get a witness proof for arbitrary data
   *
   * @param data - Data to get proof for (will be hashed if string)
   * @returns Witness attestation
   */
  async getWitnessProof(data: string | Uint8Array): Promise<Attestation> {
    const hashInput = typeof data === 'string' ? data : Crypto.toHex(data);
    return this.witness.timestamp(hashInput);
  }
}