import { CloutPost, type PostConfig, type ContentGossip } from './post.js';
import { TicketBooth, type CloutTicket } from './ticket-booth.js';
import { Crypto } from './crypto.js';
import { ReputationValidator } from './reputation.js';
import { CloutStateManager } from './chronicle/clout-state.js';
import type { FreebirdClient, WitnessClient } from './types.js';
import {
  type TrustSignal,
  type ReputationScore,
  type Feed,
  type PostPackage,
  type SlidePackage,
  type Inbox,
  type CloutStore,
  type ContentGossipMessage,
  type CloutProfile,
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
  
  // State
  private currentTicket?: CloutTicket;
  private readonly trustGraph: Set<string>;
  private readonly trustTags: Map<string, Set<string>>; // tag -> Set<publicKey>
  private stateSyncTimer?: NodeJS.Timeout;
  private readonly stateSyncInterval = 30000; // Sync every 30 seconds

  // Note: receivedSlides removed in favor of local store

  constructor(config: CloutConfig) {
    this.publicKeyHex = config.publicKey;
    this.privateKey = config.privateKey;
    this.freebird = config.freebird;
    this.witness = config.witness;
    this.gossip = config.gossip;
    this.store = config.store;
    
    // 1. Initialize TicketBooth (Anti-Sybil)
    this.ticketBooth = new TicketBooth(config.freebird, config.witness);

    // 2. Initialize Trust Graph (Bootstrap with self)
    this.trustGraph = new Set<string>([this.publicKeyHex]);

    // 2a. Initialize Trust Tags (Local organization)
    this.trustTags = new Map<string, Set<string>>();

    // 3. Initialize Reputation Validator (The Filter)
    this.reputationValidator = new ReputationValidator({
      trustGraph: this.trustGraph,
      witness: this.witness,
      maxHops: config.maxHops ?? 3,
      minReputation: config.minReputation ?? 0.3
    });

    // 4. Initialize State Manager (CRDT / Phase 5)
    // This manages the syncable state (Profile, My Posts, My Trust Signals)
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

    // 5. Initialize Storage & Gossip Subscription
    // This handles local-only data (Feed, Inbox) to prevent privacy leaks in CRDT
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

    // Subscribe to gossip to populate local store
    if (this.gossip) {
      this.gossip.subscribe(async (msg: ContentGossipMessage) => {
        await this.handleGossipMessage(msg);
      });

      // Set up CRDT state synchronization handlers
      this.gossip.setStateSyncHandler(async (publicKey: string, stateBinary: Uint8Array) => {
        await this.handleStateSync(publicKey, stateBinary);
      });

      this.gossip.setStateRequestHandler(async (publicKey: string) => {
        return this.handleStateRequest(publicKey);
      });

      // Start periodic state sync
      this.startStateSyncTimer();

      // Request initial state from peers
      setTimeout(() => {
        this.requestPeerStates();
      }, 2000); // Wait 2s for peer connections to establish
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
              await this.store.addPost(msg.post);
            }
          }
          break;

        case 'slide':
          if (msg.slide) {
            // Check Relevance: Is this slide for me?
            if (msg.slide.recipient === this.publicKeyHex) {
              await this.store.addSlide(msg.slide);
              console.log(`[Clout] 📬 Received new slide from ${msg.slide.sender.slice(0,8)}`);
            }
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
   * Handle incoming CRDT state sync from peer
   */
  private async handleStateSync(publicKey: string, stateBinary: Uint8Array): Promise<void> {
    try {
      console.log(`[Clout] 📦 Merging state from ${publicKey.slice(0, 8)}`);

      // Merge the remote state into our Chronicle
      this.state.merge(stateBinary);

      // The CRDT will automatically reconcile conflicts
      // Our local changes are preserved, remote changes are incorporated
      const mergedState = this.state.getState();
      console.log(`[Clout] ✅ State merged. Posts: ${mergedState.myPosts.length}, Trust signals: ${mergedState.myTrustSignals.length}`);
    } catch (error: any) {
      console.error(`[Clout] ❌ Failed to merge state:`, error.message);
    }
  }

  /**
   * Handle state request from peer
   */
  private async handleStateRequest(publicKey: string): Promise<Uint8Array | null> {
    try {
      console.log(`[Clout] 📤 Sending state to ${publicKey.slice(0, 8)}`);

      // Export our Chronicle state as binary
      const stateBinary = this.state.exportSync();
      return stateBinary;
    } catch (error: any) {
      console.error(`[Clout] ❌ Failed to export state:`, error.message);
      return null;
    }
  }

  /**
   * Start periodic state synchronization timer
   */
  private startStateSyncTimer(): void {
    // Clear any existing timer
    if (this.stateSyncTimer) {
      clearInterval(this.stateSyncTimer);
    }

    // Broadcast state periodically
    this.stateSyncTimer = setInterval(() => {
      this.broadcastState();
    }, this.stateSyncInterval);

    console.log(`[Clout] 🔄 State sync enabled (every ${this.stateSyncInterval / 1000}s)`);
  }

  /**
   * Broadcast our current state to all peers
   */
  private async broadcastState(): Promise<void> {
    if (!this.gossip) return;

    try {
      const stateBinary = this.state.exportSync();
      await this.gossip.broadcastState(this.publicKeyHex, stateBinary);
    } catch (error: any) {
      console.error(`[Clout] ❌ Failed to broadcast state:`, error.message);
    }
  }

  /**
   * Request state from all trusted peers
   */
  private async requestPeerStates(): Promise<void> {
    if (!this.gossip) return;

    try {
      console.log(`[Clout] 📥 Requesting state from peers`);
      await this.gossip.requestState(this.publicKeyHex);
    } catch (error: any) {
      console.error(`[Clout] ❌ Failed to request state:`, error.message);
    }
  }

  /**
   * Stop state synchronization and clean up
   */
  destroy(): void {
    if (this.stateSyncTimer) {
      clearInterval(this.stateSyncTimer);
      this.stateSyncTimer = undefined;
    }
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
   * Publish a new post
   * @param content - Post content
   * @param replyTo - Optional parent post ID for threading
   * @param useEphemeralKey - Use rotating ephemeral keys for forward secrecy (default: true)
   */
  async post(content: string, replyTo?: string, useEphemeralKey: boolean = true): Promise<CloutPost> {
    // 1. Check for Day Pass
    if (!this.currentTicket) {
      throw new Error("No active Day Pass. Call buyDayPass() first.");
    }

    if (Date.now() > this.currentTicket.expiry) {
      this.currentTicket = undefined;
      throw new Error("Day Pass expired. Please buy a new one.");
    }

    // 2. Derive ephemeral key for forward secrecy (optional)
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

    // 3. Sign Content (Placeholder using Hash + Key for MVP)
    // In prod, use Ed25519 signature
    const signature = Crypto.hash(content, signingKey);

    const config: PostConfig = {
      author: this.publicKeyHex,
      content,
      signature,
      freebird: this.freebird,
      witness: this.witness,
      replyTo,
      ephemeralPublicKey,
      ephemeralKeyProof
    };

    // 4. Create & Gossip Post
    const post = await CloutPost.post(config, this.currentTicket, this.gossip);

    // 5. Persist to CRDT State (for sync) and Local Store (for own feed)
    const pkg = post.getPackage();
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
    // 1. Encrypt message for recipient
    const recipientPublicKey = Crypto.fromHex(recipientKey);
    const { ephemeralPublicKey, ciphertext } = Crypto.encrypt(message, recipientPublicKey);

    // 2. Create signature over the slide components
    const signaturePayload = Crypto.hash(
      recipientPublicKey,
      ephemeralPublicKey,
      ciphertext
    );
    const signature = Crypto.hash(signaturePayload, this.privateKey);

    // 3. Get Witness timestamp proof
    const slideHash = Crypto.toHex(Crypto.hash(
      this.publicKeyHex,
      recipientKey,
      ephemeralPublicKey,
      ciphertext
    ));
    const proof = await this.witness.timestamp(slideHash);

    // 4. Create slide package
    const slide: SlidePackage = {
      id: slideHash,
      sender: this.publicKeyHex,
      recipient: recipientKey,
      ephemeralPublicKey,
      ciphertext,
      signature,
      proof
    };

    // 5. Propagate through gossip network
    if (this.gossip) {
      await this.gossip.publish({
        type: 'slide',
        slide,
        timestamp: Date.now()
      });
    }

    // 6. Save to local store (Outbox/Sent items)
    if (this.store) {
      // We might want to store sent slides too, though getInbox() typically returns received
      // For now, we only log it
    }

    console.log(`[Clout] 📬 Slide sent to ${recipientKey.slice(0, 8)}`);
    return slide;
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
      const signalPayload = {
        truster: this.publicKeyHex,
        trustee: trusteeKey,
        weight,
        timestamp: Date.now()
      };

      const payloadHash = Crypto.hashString(JSON.stringify(signalPayload));
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
        timestamp: Date.now()
      });

      // 3. Persist to CRDT State
      this.state.addTrustSignal(signal);
      
      // Update the profile in the state to reflect the new trust graph
      this.state.updateProfile({
        publicKey: this.publicKeyHex,
        trustGraph: this.trustGraph,
        trustSettings: this.state.getState().profile?.trustSettings || DEFAULT_TRUST_SETTINGS
      });
    }
    
    console.log(`[Clout] 🤝 Trusted ${trusteeKey.slice(0, 8)}`);
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
   * Get the current user's profile (from Chronicle state)
   */
  getProfile(): CloutProfile {
    const state = this.state.getState();
    return state.profile || {
      publicKey: this.publicKeyHex,
      trustGraph: this.trustGraph,
      trustSettings: DEFAULT_TRUST_SETTINGS
    };
  }

  /**
   * Update profile metadata (display name, bio, avatar)
   * Changes sync automatically via Chronicle CRDT
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
  }

  // =================================================================
  //  SECTION 4: TRUST TAGS (Local Organization)
  // =================================================================

  /**
   * Add a tag to a trusted user (e.g., "friends", "work", "family")
   *
   * Tags are local only and not synced to the network for privacy.
   * Use tags to filter your feed and organize your trust network.
   */
  addTrustTag(publicKey: string, tag: string): void {
    if (!this.trustGraph.has(publicKey)) {
      throw new Error(`Cannot tag ${publicKey}: not in trust graph`);
    }

    // Normalize tag (lowercase, trim)
    const normalizedTag = tag.toLowerCase().trim();

    if (!this.trustTags.has(normalizedTag)) {
      this.trustTags.set(normalizedTag, new Set<string>());
    }

    this.trustTags.get(normalizedTag)!.add(publicKey);
    console.log(`[Clout] 🏷️ Tagged ${publicKey.slice(0, 8)} as '${normalizedTag}'`);
  }

  /**
   * Remove a tag from a user
   */
  removeTrustTag(publicKey: string, tag: string): void {
    const normalizedTag = tag.toLowerCase().trim();
    const taggedUsers = this.trustTags.get(normalizedTag);

    if (taggedUsers) {
      taggedUsers.delete(publicKey);

      // Clean up empty tags
      if (taggedUsers.size === 0) {
        this.trustTags.delete(normalizedTag);
      }

      console.log(`[Clout] 🏷️ Removed tag '${normalizedTag}' from ${publicKey.slice(0, 8)}`);
    }
  }

  /**
   * Get all users with a specific tag
   */
  getUsersByTag(tag: string): string[] {
    const normalizedTag = tag.toLowerCase().trim();
    const users = this.trustTags.get(normalizedTag);
    return users ? Array.from(users) : [];
  }

  /**
   * Get all tags for a specific user
   */
  getTagsForUser(publicKey: string): string[] {
    const tags: string[] = [];

    for (const [tag, users] of this.trustTags.entries()) {
      if (users.has(publicKey)) {
        tags.push(tag);
      }
    }

    return tags;
  }

  /**
   * Get all tags and their member counts
   */
  getAllTags(): Map<string, number> {
    const tagCounts = new Map<string, number>();

    for (const [tag, users] of this.trustTags.entries()) {
      tagCounts.set(tag, users.size);
    }

    return tagCounts;
  }

  /**
   * Filter feed by tag (get posts only from users with a specific tag)
   */
  async getFeedByTag(tag: string): Promise<PostPackage[]> {
    if (!this.store) {
      throw new Error('No store configured');
    }

    const normalizedTag = tag.toLowerCase().trim();
    const taggedUsers = this.trustTags.get(normalizedTag);

    if (!taggedUsers || taggedUsers.size === 0) {
      return [];
    }

    // Get all posts and filter by tagged authors
    const allPosts = await this.store.getFeed();
    return allPosts.filter(post => taggedUsers.has(post.author));
  }

  // =================================================================
  //  SECTION 5: FEED (View Content)
  // =================================================================

  /**
   * Get posts from the local feed cache
   */
  async getFeed(options?: { tag?: string; limit?: number }): Promise<PostPackage[]> {
    if (!this.store) {
      throw new Error('No store configured');
    }

    // Filter by tag if specified
    if (options?.tag) {
      const posts = await this.getFeedByTag(options.tag);
      return options.limit ? posts.slice(0, options.limit) : posts;
    }

    // Get all posts
    const posts = await this.store.getFeed();
    return options?.limit ? posts.slice(0, options.limit) : posts;
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
   * Get inbox with decrypted slides
   */
  async getInbox(): Promise<Inbox> {
    // Read from local store instead of gossip memory
    const slides = this.store
      ? await this.store.getInbox()
      : (this.gossip && this.gossip.getSlides) ? this.gossip.getSlides() : [];

    // Filter slides addressed to us (store should already be filtered, but double check)
    const mySlides = slides.filter(
      slide => slide.recipient === this.publicKeyHex
    );

    // Sort by timestamp (newest first)
    const sortedSlides = mySlides.sort((a, b) =>
      b.proof.timestamp - a.proof.timestamp
    );

    return {
      slides: sortedSlides,
      lastUpdated: Date.now()
    };
  }

  /**
   * Decrypt a slide
   */
  decryptSlide(slide: SlidePackage): string {
    if (slide.recipient !== this.publicKeyHex) {
      throw new Error('Cannot decrypt slide not addressed to this user');
    }

    return Crypto.decrypt(
      slide.ephemeralPublicKey,
      slide.ciphertext,
      this.privateKey
    );
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
}