/**
 * Clout - Main orchestration class
 *
 * This class coordinates all the Clout modules:
 * - Economics (Day Pass system)
 * - Content (Posting, editing, deleting)
 * - Media (Storage and P2P retrieval)
 * - Trust (Social graph management)
 * - Reactions (Trust-weighted reactions)
 * - Feed (Feed filtering and stats)
 * - Backup (Export/import)
 * - Relay (Browser identity relay)
 */

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
import { CloutNode, type CloutNodeConfig } from './network/clout-node.js';

// Module imports
import { CloutEconomics } from './clout/economics.js';
import { CloutContent } from './clout/content.js';
import { CloutMedia } from './clout/media.js';
import { CloutTrust } from './clout/trust.js';
import { CloutReactions, REACTION_EMOJIS } from './clout/reactions.js';
import { CloutFeed } from './clout/feed.js';
import { CloutRelay } from './clout/relay.js';
import { CloutProfileModule } from './clout/profile.js';

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
  gossip?: GossipNode;
  store?: CloutStore;

  // Trust Settings
  maxHops?: number;
  minReputation?: number;

  /**
   * Use encrypted trust signals for privacy (default: true)
   */
  useEncryptedTrustSignals?: boolean;

  // Media Storage Settings
  enableMediaStorage?: boolean;
  mediaStoragePath?: string;
  maxMediaSize?: number;

  // P2P Network Settings
  enableP2P?: boolean;
  relayServers?: string[];
  enableDHT?: boolean;
}

export class Clout {
  private readonly publicKeyHex: string;
  private readonly privateKey: Uint8Array;
  private readonly freebird: FreebirdClient;
  private readonly witness: WitnessClient;
  private readonly gossip?: GossipNode;
  private readonly store?: CloutStore;

  // Core components
  public readonly ticketBooth: TicketBooth;
  private readonly reputationValidator: ReputationValidator;
  public readonly state: CloutStateManager;
  public readonly storage: StorageManager;
  private readonly profileStore: ProfileStore;
  private readonly localData: CloutLocalData;
  private readonly messaging: CloutMessaging;
  private readonly stateSync: CloutStateSync;
  private cloutNode?: CloutNode;

  // Modules
  private readonly economics: CloutEconomics;
  private readonly content: CloutContent;
  private readonly media: CloutMedia;
  private readonly trustModule: CloutTrust;
  private readonly reactions: CloutReactions;
  private readonly feedModule: CloutFeed;
  private readonly relay: CloutRelay;
  private readonly profileModule: CloutProfileModule;

  // State
  private readonly trustGraph: Set<string>;
  private mediaStorageEnabled: boolean;
  private readonly useEncryptedTrustSignals: boolean;

  // Gossip message backpressure handling
  private readonly messageQueue: ContentGossipMessage[] = [];
  private readonly maxQueueSize = 1000;
  private processingQueue = false;

  // Re-export for static access
  static readonly REACTION_EMOJIS = REACTION_EMOJIS;

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

    // 6. Initialize WNFS Media Storage
    this.mediaStorageEnabled = config.enableMediaStorage !== false;
    this.storage = new StorageManager({
      storagePath: config.mediaStoragePath,
      maxFileSize: config.maxMediaSize
    });

    // 6b. Initialize Profile Store
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

    // 9. Initialize P2P Network (Chronicle blob growth)
    if (config.enableP2P) {
      this.initializeP2PNetwork(config);
    }

    // 10. Initialize Modules
    this.economics = new CloutEconomics({
      publicKey: this.publicKeyHex,
      privateKey: this.privateKey,
      freebird: this.freebird,
      witness: this.witness,
      store: this.store,
      ticketBooth: this.ticketBooth,
      reputationValidator: this.reputationValidator
    });

    this.content = new CloutContent({
      publicKey: this.publicKeyHex,
      privateKey: this.privateKey,
      freebird: this.freebird,
      witness: this.witness,
      gossip: this.gossip,
      store: this.store,
      state: this.state,
      storage: this.storage,
      mediaStorageEnabled: this.mediaStorageEnabled,
      getTicket: () => this.economics.getCurrentTicket(),
      clearTicket: () => this.economics.clearTicket(),
      obtainToken: () => this.economics.obtainToken(),
      buyDayPass: (token) => this.economics.buyDayPass(token),
      hasActiveTicket: () => this.economics.hasActiveTicket(),
      getProfile: () => {
        const profile = this.getProfile();
        return {
          displayName: profile.metadata?.displayName,
          avatar: profile.metadata?.avatar
        };
      }
    });

    this.media = new CloutMedia({
      publicKey: this.publicKeyHex,
      storage: this.storage,
      mediaStorageEnabled: this.mediaStorageEnabled,
      getCloutNode: () => this.cloutNode,
      reputationValidator: this.reputationValidator,
      getProfile: () => this.getProfile()
    });

    this.trustModule = new CloutTrust({
      publicKey: this.publicKeyHex,
      privateKey: this.privateKey,
      witness: this.witness,
      gossip: this.gossip,
      state: this.state,
      trustGraph: this.trustGraph,
      reputationValidator: this.reputationValidator,
      useEncryptedTrustSignals: this.useEncryptedTrustSignals,
      getCloutNode: () => this.cloutNode
    });

    this.reactions = new CloutReactions({
      publicKey: this.publicKeyHex,
      privateKey: this.privateKey,
      witness: this.witness,
      gossip: this.gossip,
      store: this.store,
      state: this.state,
      reputationValidator: this.reputationValidator
    });

    this.feedModule = new CloutFeed({
      publicKey: this.publicKeyHex,
      store: this.store,
      state: this.state,
      gossip: this.gossip,
      localData: this.localData,
      messaging: this.messaging,
      trustGraph: this.trustGraph,
      reputationValidator: this.reputationValidator,
      getCloutNode: () => this.cloutNode,
      getProfile: () => this.getProfile()
    });

    this.relay = new CloutRelay({
      publicKey: this.publicKeyHex,
      freebird: this.freebird,
      witness: this.witness,
      gossip: this.gossip,
      store: this.store,
      state: this.state,
      extractMentions: (content) => this.content.extractMentions(content)
    });

    this.profileModule = new CloutProfileModule({
      publicKey: this.publicKeyHex,
      trustGraph: this.trustGraph,
      state: this.state,
      profileStore: this.profileStore,
      defaultTrustSettings: DEFAULT_TRUST_SETTINGS
    });

    // 11. Initialize Storage & Gossip Subscription
    this.initializeDataLayer();
  }

  /**
   * Initialize P2P network for Chronicle blob growth
   */
  private async initializeP2PNetwork(config: CloutConfig): Promise<void> {
    const nodeConfig: CloutNodeConfig = {
      publicKey: this.publicKeyHex,
      nodeType: 'light' as any,
      trustGraph: this.trustGraph,
      relayServers: config.relayServers,
      enableDHT: config.enableDHT ?? true,
      onPeerConnected: (peer) => {
        console.log(`[Clout] 🔗 Peer connected: ${peer.publicKey.slice(0, 8)} - requesting Chronicle`);
        this.stateSync.forceSync();
      },
      onMessage: (peer, message) => {
        this.enqueueGossipMessage(message as ContentGossipMessage);
      }
    };

    this.cloutNode = new CloutNode(nodeConfig);

    try {
      await this.cloutNode.start();
      console.log('[Clout] 🌐 P2P network started - Chronicle blob ready to grow!');
    } catch (error) {
      console.error('[Clout] Failed to start P2P network:', error);
    }
  }

  /**
   * Initialize local storage and subscribe to gossip
   */
  private async initializeDataLayer() {
    if (this.store) {
      await this.store.init();
    }

    if (this.mediaStorageEnabled) {
      await this.storage.init();
    }

    await this.profileStore.init();
    await this.loadSavedProfile();
    await this.loadSavedDeletions();
    await this.reactions.loadSavedReactions();
    await this.loadSavedBookmarks();

    if (this.gossip) {
      this.gossip.subscribe(async (msg: ContentGossipMessage) => {
        this.enqueueGossipMessage(msg);
      });

      this.stateSync.initialize();
    }
  }

  /**
   * Enqueue a gossip message with backpressure handling
   */
  private enqueueGossipMessage(msg: ContentGossipMessage): void {
    if (this.messageQueue.length >= this.maxQueueSize) {
      console.warn('[Clout] Message queue full, dropping oldest message');
      this.messageQueue.shift();
    }
    this.messageQueue.push(msg);
    this.processMessageQueue();
  }

  /**
   * Process queued gossip messages
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
   * Load saved profile from local storage
   */
  private async loadSavedProfile(): Promise<void> {
    const savedProfile = this.profileStore.getProfile();
    if (savedProfile && savedProfile.publicKey === this.publicKeyHex) {
      console.log('[Clout] 📂 Restoring saved profile from local storage');

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
   * Load saved deletions from file store
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
   * Load saved bookmarks from file store
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
   */
  private async handleGossipMessage(msg: ContentGossipMessage): Promise<void> {
    if (!this.store) return;

    try {
      switch (msg.type) {
        case 'post':
          if (msg.post) {
            await this.store.addPost(msg.post);
          }
          break;

        case 'slide':
          if (msg.slide) {
            await this.messaging.handleIncomingSlide(msg.slide);
          }
          break;

        case 'trust':
          if (msg.trustSignal) {
            await this.trustModule.handleTrustSignal(msg.trustSignal);
          }
          break;

        case 'trust-encrypted':
          if (msg.encryptedTrustSignal) {
            await this.trustModule.handleEncryptedTrustSignal(msg.encryptedTrustSignal);
          }
          break;

        case 'media-request':
          if (msg.mediaRequest) {
            await this.media.handleMediaRequest(msg.mediaRequest);
          }
          break;

        case 'media-response':
          if (msg.mediaResponse) {
            this.media.handleMediaResponse(msg.mediaResponse);
          }
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
   */
  async forceSync(): Promise<void> {
    await this.stateSync.forceSync();
  }

  // =================================================================
  //  ECONOMICS (Day Pass) - Delegated to CloutEconomics
  // =================================================================

  async buyDayPass(freebirdToken: Uint8Array): Promise<void> {
    return this.economics.buyDayPass(freebirdToken);
  }

  async obtainToken(): Promise<Uint8Array> {
    return this.economics.obtainToken();
  }

  hasActiveTicket(): boolean {
    return this.economics.hasActiveTicket();
  }

  getTicketInfo(): { expiry: number; durationHours: number; delegatedFrom?: string } | null {
    return this.economics.getTicketInfo();
  }

  async loadSavedTicket(): Promise<void> {
    return this.economics.loadSavedTicket();
  }

  async delegatePass(recipientKey: string, durationHours: number = 24): Promise<void> {
    return this.economics.delegatePass(recipientKey, durationHours);
  }

  async acceptDelegatedPass(): Promise<void> {
    return this.economics.acceptDelegatedPass();
  }

  hasPendingDelegation(): boolean {
    return this.economics.hasPendingDelegation();
  }

  // =================================================================
  //  CONTENT (Posting) - Delegated to CloutContent
  // =================================================================

  async post(
    content: string,
    options?: {
      replyTo?: string;
      media?: MediaInput;
      useEphemeralKey?: boolean;
      nsfw?: boolean;
      contentWarning?: string;
    }
  ): Promise<CloutPost> {
    return this.content.post(content, options);
  }

  async retractPost(postId: string, reason?: 'retracted' | 'edited' | 'mistake' | 'other'): Promise<import('./clout-types.js').PostDeletePackage> {
    return this.content.retractPost(postId, reason);
  }

  async editPost(
    originalPostId: string,
    newContent: string,
    options?: {
      media?: import('./clout-types.js').MediaInput;
      nsfw?: boolean;
      contentWarning?: string;
    }
  ): Promise<CloutPost> {
    return this.content.editPost(originalPostId, newContent, options);
  }

  async slide(recipientKey: string, message: string): Promise<SlidePackage> {
    return this.messaging.send(recipientKey, message);
  }

  // =================================================================
  //  MEDIA - Delegated to CloutMedia
  // =================================================================

  async resolveMedia(cid: string): Promise<Uint8Array | null> {
    return this.media.resolveMedia(cid);
  }

  async resolvePostMedia(
    post: PostPackage,
    fetchFromNetwork = true,
    allowSelf = false
  ): Promise<Uint8Array | null> {
    return this.media.resolvePostMedia(post, fetchFromNetwork, allowSelf);
  }

  getMediaMetadata(cid: string): MediaMetadata | null {
    return this.media.getMediaMetadata(cid);
  }

  async hasMedia(cid: string): Promise<boolean> {
    return this.media.hasMedia(cid);
  }

  static postHasMedia(post: PostPackage): boolean {
    return CloutMedia.postHasMedia(post);
  }

  static extractMediaCid(post: PostPackage): string | null {
    return CloutMedia.extractMediaCid(post);
  }

  async getMediaStats(): Promise<{
    mediaCount: number;
    totalSize: number;
    byMimeType: Record<string, { count: number; size: number }>;
  }> {
    return this.media.getMediaStats();
  }

  // =================================================================
  //  TRUST - Delegated to CloutTrust
  // =================================================================

  async trust(trusteeKey: string, weight: number = 1.0): Promise<void> {
    return this.trustModule.trust(trusteeKey, weight);
  }

  async revokeTrust(trusteeKey: string): Promise<void> {
    return this.trustModule.revokeTrust(trusteeKey);
  }

  async invite(guestPublicKey: string, params: any): Promise<{ code: Uint8Array }> {
    return this.trustModule.invite(guestPublicKey, params);
  }

  async acceptInvitation(code: Uint8Array): Promise<Uint8Array> {
    return this.trustModule.acceptInvitation(code);
  }

  getReputation(publicKey: string): ReputationScore {
    return this.trustModule.getReputation(publicKey);
  }

  getTrustPath(publicKey: string): { path: string[]; distance: number } | null {
    return this.trustModule.getTrustPath(publicKey);
  }

  isDirectlyTrusted(publicKey: string): boolean {
    return this.trustModule.isDirectlyTrusted(publicKey);
  }

  getTrustWeight(publicKey: string): number | null {
    return this.trustModule.getTrustWeight(publicKey);
  }

  // =================================================================
  //  TRUST REQUESTS (Consent-based trust) - Browser-side storage
  //  These methods are stubs for API routes; actual storage is in IndexedDB
  // =================================================================

  /**
   * Send a trust request (requires browser-side storage)
   * The actual request is stored in browser IndexedDB and sent via gossip
   */
  async sendTrustRequest(recipient: string, weight: number = 1.0, message?: string | null): Promise<any> {
    const now = Date.now();
    const id = `${this.publicKeyHex}-${recipient}-${now}`;

    // For server-side, we just create the request object
    // Browser-side handles storage and gossip
    const request = {
      id,
      requester: this.publicKeyHex,
      recipient,
      weight,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      retryCount: 0,
      message: message || undefined
    };

    console.log(`[Clout] 📨 Sending trust request to ${recipient.slice(0, 8)}`);
    return request;
  }

  /**
   * Get incoming trust requests (browser-side storage)
   */
  async getIncomingTrustRequests(_includeAll: boolean = false): Promise<any[]> {
    // Browser-side handles storage - return empty for server
    return [];
  }

  /**
   * Get outgoing trust requests (browser-side storage)
   */
  async getOutgoingTrustRequests(): Promise<any[]> {
    // Browser-side handles storage - return empty for server
    return [];
  }

  /**
   * Accept a trust request
   * When accepting, we establish trust with the requester
   */
  async acceptTrustRequest(requestId: string): Promise<any> {
    // Parse requester from request ID (format: requester-recipient-timestamp)
    const parts = requestId.split('-');
    if (parts.length < 3) {
      throw new Error('Invalid request ID format');
    }
    const requester = parts[0];

    // Establish trust with the requester
    await this.trustModule.trust(requester);

    console.log(`[Clout] ✅ Accepted trust request from ${requester.slice(0, 8)}`);
    return { id: requestId, status: 'accepted', requester };
  }

  /**
   * Reject a trust request (silently - requester sees it as pending/ghosted)
   */
  async rejectTrustRequest(requestId: string): Promise<void> {
    // Just log - no trust established, requester doesn't know
    console.log(`[Clout] 🚫 Rejected trust request ${requestId}`);
  }

  /**
   * Withdraw an outgoing trust request
   */
  async withdrawTrustRequest(requestId: string): Promise<void> {
    console.log(`[Clout] 🔙 Withdrew trust request ${requestId}`);
  }

  /**
   * Retry a ghosted trust request
   */
  async retryTrustRequest(requestId: string): Promise<any> {
    const now = Date.now();
    console.log(`[Clout] 🔄 Retrying trust request ${requestId}`);
    return {
      id: requestId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      retryCount: 1
    };
  }

  // =================================================================
  //  PROFILE - Delegated to CloutProfileModule
  // =================================================================

  getProfile(): CloutProfile {
    return this.profileModule.getProfile();
  }

  async setProfileMetadata(metadata: {
    displayName?: string;
    bio?: string;
    avatar?: string;
  }): Promise<void> {
    return this.profileModule.setProfileMetadata(metadata);
  }

  async updateTrustSettings(settings: Partial<import('./clout-types.js').TrustSettings>): Promise<void> {
    return this.profileModule.updateTrustSettings(settings);
  }

  async setContentTypeFilter(
    contentType: string,
    filter: import('./clout-types.js').ContentTypeFilter
  ): Promise<void> {
    return this.profileModule.setContentTypeFilter(contentType, filter);
  }

  async removeContentTypeFilter(contentType: string): Promise<void> {
    return this.profileModule.removeContentTypeFilter(contentType);
  }

  async setNsfwEnabled(enabled: boolean): Promise<void> {
    return this.profileModule.setNsfwEnabled(enabled);
  }

  isNsfwEnabled(): boolean {
    return this.profileModule.isNsfwEnabled();
  }

  // =================================================================
  //  TRUST TAGS - Delegated to CloutLocalData
  // =================================================================

  addTrustTag(publicKey: string, tag: string): void {
    this.localData.addTag(publicKey, tag);
  }

  removeTrustTag(publicKey: string, tag: string): void {
    this.localData.removeTag(publicKey, tag);
  }

  getUsersByTag(tag: string): string[] {
    return this.localData.getUsersByTag(tag);
  }

  getTagsForUser(publicKey: string): string[] {
    return this.localData.getTagsForUser(publicKey);
  }

  getAllTags(): Map<string, number> {
    return this.localData.getAllTags();
  }

  async getFeedByTag(tag: string): Promise<PostPackage[]> {
    return this.feedModule.getFeedByTag(tag);
  }

  // =================================================================
  //  NICKNAMES - Delegated to CloutLocalData
  // =================================================================

  setNickname(publicKey: string, nickname: string): void {
    this.localData.setNickname(publicKey, nickname);
  }

  getNickname(publicKey: string): string | undefined {
    return this.localData.getNickname(publicKey);
  }

  getDisplayName(publicKey: string): string {
    if (publicKey === this.publicKeyHex) {
      const profile = this.getProfile();
      if (profile.metadata?.displayName) {
        return profile.metadata.displayName;
      }
    }
    return this.localData.getDisplayName(publicKey);
  }

  getAllNicknames(): Map<string, string> {
    return this.localData.getAllNicknames();
  }

  // =================================================================
  //  MUTED USERS - Delegated to CloutLocalData
  // =================================================================

  mute(publicKey: string): void {
    this.localData.mute(publicKey);
  }

  unmute(publicKey: string): void {
    this.localData.unmute(publicKey);
  }

  isMuted(publicKey: string): boolean {
    return this.localData.isMuted(publicKey);
  }

  getMutedUsers(): string[] {
    return this.localData.getMutedUsers();
  }

  getMutedCount(): number {
    return this.localData.getMutedCount();
  }

  // =================================================================
  //  BOOKMARKS - Delegated to CloutLocalData
  // =================================================================

  async bookmark(postId: string): Promise<void> {
    this.localData.bookmark(postId);

    if (this.store && 'addBookmark' in this.store) {
      await (this.store as any).addBookmark(postId);
    }
  }

  async unbookmark(postId: string): Promise<void> {
    this.localData.unbookmark(postId);

    if (this.store && 'removeBookmark' in this.store) {
      await (this.store as any).removeBookmark(postId);
    }
  }

  isBookmarked(postId: string): boolean {
    return this.localData.isBookmarked(postId);
  }

  getBookmarkIds(): string[] {
    return this.localData.getBookmarks();
  }

  async getBookmarks(): Promise<PostPackage[]> {
    if (!this.store) {
      throw new Error('No store configured');
    }

    const bookmarkIds = new Set(this.localData.getBookmarks());
    if (bookmarkIds.size === 0) return [];

    const allPosts = await this.store.getFeed();
    return allPosts.filter(post => bookmarkIds.has(post.id));
  }

  getBookmarkCount(): number {
    return this.localData.getBookmarks().length;
  }

  // =================================================================
  //  STORE ACCESS
  // =================================================================

  /**
   * Get the underlying store instance (for direct operations)
   */
  getStore(): import('./clout-types.js').CloutStore | undefined {
    return this.store;
  }

  // =================================================================
  //  NOTIFICATIONS - Delegated to CloutFeed
  // =================================================================

  async getNotificationCounts(): Promise<{
    slides: number;
    replies: number;
    mentions: number;
    total: number;
  }> {
    return this.feedModule.getNotificationCounts();
  }

  async getReplies(options?: { limit?: number; unreadOnly?: boolean }): Promise<PostPackage[]> {
    return this.feedModule.getReplies(options);
  }

  markSlidesSeen(): void {
    this.localData.markSlidesSeen();
  }

  markRepliesSeen(): void {
    this.localData.markRepliesSeen();
  }

  markMentionsSeen(): void {
    this.localData.markMentionsSeen();
  }

  // =================================================================
  //  REACTIONS - Delegated to CloutReactions
  // =================================================================

  async react(postId: string, emoji: string = '👍'): Promise<ReactionPackage> {
    return this.reactions.react(postId, emoji);
  }

  async unreact(postId: string, emoji: string = '👍'): Promise<void> {
    return this.reactions.unreact(postId, emoji);
  }

  getReactionsForPost(postId: string): {
    reactions: Map<string, { count: number; weightedCount: number; reactors: string[] }>;
    myReaction?: string;
  } {
    return this.reactions.getReactionsForPost(postId);
  }

  getMyReaction(postId: string): string | undefined {
    return this.reactions.getMyReaction(postId);
  }

  // =================================================================
  //  MENTIONS - Delegated to CloutFeed
  // =================================================================

  extractMentions(content: string): string[] {
    return this.content.extractMentions(content);
  }

  async getMentions(options?: { limit?: number }): Promise<PostPackage[]> {
    return this.feedModule.getMentions(options);
  }

  static postMentionsUser(post: PostPackage, publicKey: string): boolean {
    return CloutFeed.postMentionsUser(post, publicKey);
  }

  // =================================================================
  //  FEED - Delegated to CloutFeed
  // =================================================================

  async getFeed(options?: {
    tag?: string;
    limit?: number;
    includeNsfw?: boolean;
    includeDeleted?: boolean;
    includeDecayed?: boolean;
    filterByTrust?: boolean;
    trustGraph?: Set<string>;
  }): Promise<PostPackage[]> {
    return this.feedModule.getFeed(options);
  }

  isPostRetracted(postId: string): boolean {
    return this.feedModule.isPostRetracted(postId);
  }

  getPostRetractions(): import('./clout-types.js').PostDeletePackage[] {
    return this.feedModule.getPostRetractions();
  }

  getRetractionReason(postId: string): string | null {
    return this.feedModule.getRetractionReason(postId);
  }

  async resolvePostId(postId: string): Promise<string> {
    return this.feedModule.resolvePostId(postId);
  }

  async getPostById(postId: string): Promise<{
    post: PostPackage | null;
    resolved: boolean;
    originalId: string;
    wasRetracted: boolean;
    retractionReason: string | null;
  }> {
    return this.feedModule.getPostById(postId);
  }

  async getRepliesForPost(postId: string): Promise<PostPackage[]> {
    return this.feedModule.getRepliesForPost(postId);
  }

  processContentDecay(): number {
    return this.feedModule.processContentDecay();
  }

  isPostDecayed(post: PostPackage): boolean {
    return this.feedModule.isPostDecayed(post);
  }

  getProfileForUser(publicKey: string): CloutProfile | null {
    return this.feedModule.getProfileForUser(publicKey);
  }

  getInvitationChain() {
    return this.feedModule.getInvitationChain();
  }

  async getInbox(): Promise<Inbox> {
    return this.feedModule.getInbox();
  }

  decryptSlide(slide: SlidePackage): string {
    return this.feedModule.decryptSlide(slide);
  }

  async getStats() {
    return this.feedModule.getStats();
  }

  async getCloutStats(): Promise<{
    chronicleSize: number;
    trustReach: number;
    uniqueAuthors: number;
    myPostCount: number;
    reactionCount: number;
    connectedPeers: number;
    blobDensity: number;
  }> {
    return this.feedModule.getCloutStats();
  }

  // =================================================================
  //  RELAY - Delegated to CloutRelay
  // =================================================================

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
    link?: { url: string; title?: string; description?: string; image?: string; siteName?: string; type?: string; fetchedAt: number };
    authorshipProof?: Uint8Array;
    authorDisplayName?: string;
    authorAvatar?: string;
  }): Promise<Attestation> {
    return this.relay.relayPost(postPackage);
  }

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
    return this.relay.relayTrustSignal(signal);
  }

  async verifyFreebirdToken(token: Uint8Array): Promise<boolean> {
    return this.relay.verifyFreebirdToken(token);
  }

  async getWitnessProof(data: string | Uint8Array): Promise<Attestation> {
    return this.relay.getWitnessProof(data);
  }
}
