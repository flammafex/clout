/**
 * Media Module - Content-addressed media storage and P2P retrieval
 *
 * Handles:
 * - Local WNFS blockstore storage/retrieval
 * - P2P media fetch from trusted peers
 * - Hop-distance based access control for media
 */

import { StorageManager, type MediaMetadata } from '../storage/block-store.js';
import type { ReputationValidator } from '../reputation.js';
import type { PostPackage, CloutProfile, ContentGossipMessage } from '../clout-types.js';

export interface MediaConfig {
  publicKey: string;
  storage: StorageManager;
  mediaStorageEnabled: boolean;
  reputationValidator: ReputationValidator;
  getProfile: () => CloutProfile;
}

export class CloutMedia {
  private readonly publicKeyHex: string;
  private readonly storage: StorageManager;
  private readonly mediaStorageEnabled: boolean;
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
  async handleMediaRequest(_request: {
    cid: string;
    requester: string;
    postId: string;
  }): Promise<void> {
    // P2P media serving removed (network layer deleted); no-op stub
    return;
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
    // (P2P network layer removed; media can only be served from local storage)
    if (!fetchFromNetwork) {
      return null;
    }
    return null;
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
