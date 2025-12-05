import { CloutPost, type PostConfig, type ContentGossip } from './post.js';
import { TicketBooth, type CloutTicket } from './ticket-booth.js';
import { Crypto } from './crypto.js';
import { ReputationValidator } from './reputation.js';
import { CloutStateManager } from './chronicle/clout-state.js';
import { StorageManager, type MediaMetadata } from './storage/wnfs-manager.js';
import { CloutLocalData } from './clout/local-data.js';
import { CloutMessaging } from './clout/messaging.js';
import { CloutStateSync } from './clout/state-sync.js';
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
  private readonly localData: CloutLocalData;
  private readonly messaging: CloutMessaging;
  private readonly stateSync: CloutStateSync;

  // State
  private currentTicket?: CloutTicket;
  private readonly trustGraph: Set<string>;
  private mediaStorageEnabled: boolean;

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

    // 3. Initialize Local Data (Tags + Nicknames)
    this.localData = new CloutLocalData(this.trustGraph);

    // 4. Initialize Reputation Validator (The Filter)
    this.reputationValidator = new ReputationValidator({
      trustGraph: this.trustGraph,
      witness: this.witness,
      maxHops: config.maxHops ?? 3,
      minReputation: config.minReputation ?? 0.3
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

    // Subscribe to gossip to populate local store
    if (this.gossip) {
      this.gossip.subscribe(async (msg: ContentGossipMessage) => {
        await this.handleGossipMessage(msg);
      });

      // Initialize CRDT state synchronization
      this.stateSync.initialize();
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
   * Publish a new post with optional media attachment
   *
   * Uses the "Offload-and-Link" pattern for media:
   * 1. Offload: Store media file in WNFS blockstore
   * 2. Address: Get content-addressed CID
   * 3. Link: Embed CID reference in post content
   *
   * @param content - Post content
   * @param options - Post options including replyTo, media, nsfw flag, and ephemeral key settings
   */
  async post(
    content: string,
    options?: {
      replyTo?: string;
      media?: MediaInput;
      useEphemeralKey?: boolean;
      /** Mark post as Not Safe For Work - requires user to willingly label content */
      nsfw?: boolean;
    }
  ): Promise<CloutPost> {
    const replyTo = options?.replyTo;
    const media = options?.media;
    const useEphemeralKey = options?.useEphemeralKey !== false; // default: true
    const nsfw = options?.nsfw ?? false;

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
      nsfw
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
   * Get display name for a user - nickname if set, otherwise truncated public key
   */
  getDisplayName(publicKey: string): string {
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

  // =================================================================
  //  SECTION 5: FEED (View Content)
  // =================================================================

  /**
   * Get posts from the local feed cache
   *
   * @param options.tag - Filter by trust tag
   * @param options.limit - Maximum number of posts
   * @param options.includeNsfw - Override NSFW setting for this call
   */
  async getFeed(options?: { tag?: string; limit?: number; includeNsfw?: boolean }): Promise<PostPackage[]> {
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
}