/**
 * Media Module - Content-addressed media storage and P2P retrieval
 *
 * Handles:
 * - Local WNFS blockstore storage/retrieval
 * - P2P media fetch from trusted peers
 * - Hop-distance based access control for media
 */

import { StorageManager, type MediaMetadata } from '../storage/wnfs-manager.js';
import type { CloutNode } from '../network/clout-node.js';
import type { ReputationValidator } from '../reputation.js';
import type { PostPackage, CloutProfile, ContentGossipMessage } from '../clout-types.js';

export interface MediaConfig {
  publicKey: string;
  storage: StorageManager;
  mediaStorageEnabled: boolean;
  getCloutNode: () => CloutNode | undefined;
  reputationValidator: ReputationValidator;
  getProfile: () => CloutProfile;
}

export class CloutMedia {
  private readonly publicKeyHex: string;
  private readonly storage: StorageManager;
  private readonly mediaStorageEnabled: boolean;
  private readonly getCloutNode: () => CloutNode | undefined;
  private readonly reputationValidator: ReputationValidator;
  private readonly getProfile: () => CloutProfile;

  // P2P media fetch: pending requests with callbacks
  private readonly pendingMediaRequests = new Map<string, {
    resolve: (data: Uint8Array | null) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private readonly mediaRequestTimeoutMs = 30000; // 30 seconds

  constructor(config: MediaConfig) {
    this.publicKeyHex = config.publicKey;
    this.storage = config.storage;
    this.mediaStorageEnabled = config.mediaStorageEnabled;
    this.getCloutNode = config.getCloutNode;
    this.reputationValidator = config.reputationValidator;
    this.getProfile = config.getProfile;
  }

  /**
   * Handle incoming media request from peer
   *
   * Security: Only serve media if:
   * 1. The requester is within our trust graph
   * 2. The media exists in our local storage
   */
  async handleMediaRequest(request: {
    cid: string;
    requester: string;
    postId: string;
  }): Promise<void> {
    const cloutNode = this.getCloutNode();
    if (!cloutNode || !this.mediaStorageEnabled) return;

    const { cid, requester, postId } = request;

    // Check if requester is in our trust graph (security check)
    const reputation = this.reputationValidator.computeReputation(requester);
    if (!reputation.visible) {
      console.log(`[Clout] 🚫 Media request from untrusted peer: ${requester.slice(0, 8)}`);
      return; // Silent drop - don't respond to untrusted requests
    }

    // Try to get the media from local storage
    const mediaData = await this.storage.retrieve(cid);
    const metadata = this.storage.getMetadata(cid);

    // Send response back to requester
    const response: ContentGossipMessage = {
      type: 'media-response',
      mediaResponse: {
        cid,
        data: mediaData,
        mimeType: metadata?.mimeType,
        error: mediaData ? undefined : 'Media not found'
      },
      timestamp: Date.now()
    };

    try {
      await cloutNode.sendToPeer(requester, response);
      if (mediaData) {
        console.log(`[Clout] 📤 Sent media ${cid.slice(0, 12)}... to ${requester.slice(0, 8)}`);
      }
    } catch (err) {
      console.warn(`[Clout] Failed to send media response to ${requester.slice(0, 8)}:`, err);
    }
  }

  /**
   * Handle incoming media response from peer
   */
  handleMediaResponse(response: {
    cid: string;
    data: Uint8Array | null;
    mimeType?: string;
    error?: string;
  }): void {
    const pending = this.pendingMediaRequests.get(response.cid);
    if (!pending) {
      console.log(`[Clout] Received unexpected media response for ${response.cid.slice(0, 12)}...`);
      return;
    }

    // Clear timeout
    clearTimeout(pending.timeout);
    this.pendingMediaRequests.delete(response.cid);

    if (response.data) {
      console.log(`[Clout] 📥 Received media ${response.cid.slice(0, 12)}... (${response.data.length} bytes)`);

      // Store in local cache for future use
      if (this.mediaStorageEnabled && response.mimeType) {
        this.storage.store(response.data, response.mimeType).catch(err => {
          console.warn('[Clout] Failed to cache received media:', err);
        });
      }

      pending.resolve(response.data);
    } else {
      console.log(`[Clout] Media request failed: ${response.error || 'unknown error'}`);
      pending.resolve(null);
    }
  }

  /**
   * Resolve and retrieve media content by CID
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
   * Uses the Offload-and-Link pattern:
   * 1. Check local WNFS blockstore
   * 2. If not found, check contentTypeFilters for media hop distance
   * 3. If author is within allowed hop distance, fetch from P2P network
   */
  async resolvePostMedia(post: PostPackage, fetchFromNetwork = true): Promise<Uint8Array | null> {
    // Get CID from post
    const cid = post.media?.cid || StorageManager.extractMediaCid(post.content);
    if (!cid) {
      return null;
    }

    // Step 1: Check local storage first
    const localData = await this.resolveMedia(cid);
    if (localData) {
      return localData;
    }

    // Step 2: If not fetching from network, return null
    const cloutNode = this.getCloutNode();
    if (!fetchFromNetwork || !cloutNode) {
      return null;
    }

    // Step 3: Check contentTypeFilters to determine allowed hop distance for this media
    const mimeType = post.media?.mimeType || 'image/unknown';
    const contentTypeFilter = this.getMediaHopLimit(mimeType);

    // Step 4: Check author's hop distance
    const authorReputation = this.reputationValidator.computeReputation(post.author);
    if (authorReputation.distance > contentTypeFilter) {
      // Author is beyond allowed hop distance for this media type
      console.log(`[Clout] 🔒 Media from ${post.author.slice(0, 8)} at hop ${authorReputation.distance} exceeds limit ${contentTypeFilter} for ${mimeType}`);
      return null;
    }

    // Step 5: Request media from the author's node
    return this.requestMediaFromNetwork(cid, post.author, post.id);
  }

  /**
   * Get the maximum hop distance for fetching a media type
   */
  private getMediaHopLimit(mimeType: string): number {
    const profile = this.getProfile();
    const filters = profile.trustSettings.contentTypeFilters;

    if (filters) {
      // Check for exact MIME type match
      if (filters[mimeType]) {
        return filters[mimeType].maxHops;
      }

      // Check for category match (e.g., "image/*" -> "image")
      const category = mimeType.split('/')[0];
      const categoryFilters: Record<string, string> = {
        'image': 'image/png',
        'video': 'video/mp4',
        'audio': 'audio/mpeg'
      };

      const representativeType = categoryFilters[category];
      if (representativeType && filters[representativeType]) {
        return filters[representativeType].maxHops;
      }
    }

    // Fall back to global maxHops
    return profile.trustSettings.maxHops;
  }

  /**
   * Request media from the network via P2P
   */
  private async requestMediaFromNetwork(
    cid: string,
    authorKey: string,
    postId: string
  ): Promise<Uint8Array | null> {
    const cloutNode = this.getCloutNode();
    if (!cloutNode) {
      return null;
    }

    // Check if we already have a pending request for this CID
    if (this.pendingMediaRequests.has(cid)) {
      console.log(`[Clout] Already fetching media ${cid.slice(0, 12)}...`);
      // Return the existing promise's result
      return new Promise((resolve, reject) => {
        const existing = this.pendingMediaRequests.get(cid);
        if (existing) {
          // Chain onto existing request
          const originalResolve = existing.resolve;
          existing.resolve = (data) => {
            originalResolve(data);
            resolve(data);
          };
        }
      });
    }

    console.log(`[Clout] 🔄 Requesting media ${cid.slice(0, 12)}... from ${authorKey.slice(0, 8)}`);

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingMediaRequests.delete(cid);
        console.log(`[Clout] ⏱️ Media request timeout for ${cid.slice(0, 12)}...`);
        resolve(null);
      }, this.mediaRequestTimeoutMs);

      // Store pending request
      this.pendingMediaRequests.set(cid, { resolve, reject, timeout });

      // Send request to author
      const request: ContentGossipMessage = {
        type: 'media-request',
        mediaRequest: {
          cid,
          requester: this.publicKeyHex,
          postId
        },
        timestamp: Date.now()
      };

      cloutNode.sendToPeer(authorKey, request).catch(err => {
        console.warn(`[Clout] Failed to send media request to ${authorKey.slice(0, 8)}:`, err);
        clearTimeout(timeout);
        this.pendingMediaRequests.delete(cid);
        resolve(null);
      });
    });
  }

  /**
   * Get metadata for a stored media file
   */
  getMediaMetadata(cid: string): MediaMetadata | null {
    if (!this.mediaStorageEnabled) {
      throw new Error("Media storage is not enabled.");
    }

    return this.storage.getMetadata(cid);
  }

  /**
   * Check if media exists locally by CID
   */
  async hasMedia(cid: string): Promise<boolean> {
    if (!this.mediaStorageEnabled) {
      return false;
    }

    return this.storage.has(cid);
  }

  /**
   * Check if a post has media attachment
   */
  static postHasMedia(post: PostPackage): boolean {
    return !!post.media?.cid || StorageManager.hasMediaLink(post.content);
  }

  /**
   * Extract media CID from a post
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
}
