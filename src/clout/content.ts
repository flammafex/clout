/**
 * Content Module - Post creation, editing, and deletion
 *
 * Handles:
 * - Creating new posts with optional media attachments
 * - Editing posts (creates new version, retracts original)
 * - Retracting posts (soft delete with "right to be forgotten")
 * - Ephemeral key signing for forward secrecy
 */

import { CloutPost, type PostConfig, type ContentGossip } from '../post.js';
import { Crypto } from '../crypto.js';
import { StorageManager, type MediaMetadata } from '../storage/wnfs-manager.js';
import type { CloutStateManager } from '../chronicle/clout-state.js';
import type { CloutTicket } from '../ticket-booth.js';
import type { FreebirdClient, WitnessClient } from '../types.js';
import type { CloutStore, PostPackage, PostDeletePackage, MediaInput } from '../clout-types.js';

export interface ContentConfig {
  publicKey: string;
  privateKey: Uint8Array;
  freebird: FreebirdClient;
  witness: WitnessClient;
  gossip?: ContentGossip;
  store?: CloutStore;
  state: CloutStateManager;
  storage: StorageManager;
  mediaStorageEnabled: boolean;
  getTicket: () => CloutTicket | undefined;
  clearTicket: () => void;
  obtainToken: () => Promise<Uint8Array>;
  buyDayPass: (token: Uint8Array) => Promise<void>;
  hasActiveTicket: () => boolean;
  getProfile: () => { displayName?: string; avatar?: string };
}

export class CloutContent {
  private readonly publicKeyHex: string;
  private readonly privateKey: Uint8Array;
  private readonly freebird: FreebirdClient;
  private readonly witness: WitnessClient;
  private readonly gossip?: ContentGossip;
  private readonly store?: CloutStore;
  private readonly state: CloutStateManager;
  private readonly storage: StorageManager;
  private readonly mediaStorageEnabled: boolean;

  // Callbacks to economics module
  private readonly getTicket: () => CloutTicket | undefined;
  private readonly clearTicket: () => void;
  private readonly obtainToken: () => Promise<Uint8Array>;
  private readonly getProfile: () => { displayName?: string; avatar?: string };
  private readonly buyDayPass: (token: Uint8Array) => Promise<void>;
  private readonly hasActiveTicket: () => boolean;

  constructor(config: ContentConfig) {
    this.publicKeyHex = config.publicKey;
    this.privateKey = config.privateKey;
    this.freebird = config.freebird;
    this.witness = config.witness;
    this.gossip = config.gossip;
    this.store = config.store;
    this.state = config.state;
    this.storage = config.storage;
    this.mediaStorageEnabled = config.mediaStorageEnabled;
    this.getTicket = config.getTicket;
    this.clearTicket = config.clearTicket;
    this.obtainToken = config.obtainToken;
    this.buyDayPass = config.buyDayPass;
    this.hasActiveTicket = config.hasActiveTicket;
    this.getProfile = config.getProfile;
  }

  /**
   * Extract @mentions from post content
   */
  extractMentions(content: string): string[] {
    const mentionPattern = /@([a-fA-F0-9]{8,})/g;
    const mentions: string[] = [];
    let match;

    while ((match = mentionPattern.exec(content)) !== null) {
      const mentioned = match[1];
      if (mentioned.length >= 8) {
        mentions.push(mentioned);
      }
    }

    return [...new Set(mentions)]; // Deduplicate
  }

  /**
   * Publish a new post with optional media attachment
   *
   * Uses the "Offload-and-Link" pattern for media:
   * 1. Offload: Store media file in WNFS blockstore
   * 2. Address: Get content-addressed CID
   * 3. Link: Embed CID reference in post content
   */
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
    const replyTo = options?.replyTo;
    const media = options?.media;
    const useEphemeralKey = options?.useEphemeralKey !== false; // default: true
    const nsfw = options?.nsfw ?? false;
    const contentWarning = options?.contentWarning;

    // Extract @mentions from content
    const mentions = this.extractMentions(content);

    // 1. Check for Day Pass
    const currentTicket = this.getTicket();
    if (!currentTicket) {
      throw new Error("No active Day Pass. Call buyDayPass() first.");
    }

    if (Date.now() > currentTicket.expiry) {
      this.clearTicket();
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
    const signature = Crypto.hash(finalContent, signingKey);

    // Get author's profile for embedding in post
    const profile = this.getProfile();

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
      mentions: mentions.length > 0 ? mentions : undefined,
      authorDisplayName: profile.displayName,
      authorAvatar: profile.avatar
    };

    // 5. Create & Gossip Post
    const post = await CloutPost.post(config, currentTicket, this.gossip);

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
   * receive this signal should hide it from feeds.
   */
  async retractPost(postId: string, reason?: 'retracted' | 'edited' | 'mistake' | 'other'): Promise<PostDeletePackage> {
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
    const retractionPayload = { postId, deletedAt: retractedAt };
    const payloadHash = Crypto.hashObject(retractionPayload);

    // 3. Sign the retraction
    const signature = Crypto.hash(JSON.stringify(retractionPayload), this.privateKey);

    // 4. Get Witness attestation for the retraction
    const proof = await this.witness.timestamp(payloadHash);

    // 5. Create the retraction package
    const retraction: PostDeletePackage = {
      postId,
      author: this.publicKeyHex,
      signature,
      proof,
      deletedAt: retractedAt,
      reason: reason || 'retracted'
    };

    // 6. Store retraction locally (both CRDT and file store)
    this.state.addPostDeletion(retraction);

    if (this.store && 'addDeletion' in this.store) {
      await (this.store as any).addDeletion(retraction);
    }

    // 7. Immediately decay the content
    this.state.decayPost(postId);

    // 8. Gossip the retraction to the network
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
   * Edit a post by creating a new version that supersedes the original
   */
  async editPost(
    originalPostId: string,
    newContent: string,
    options?: {
      media?: MediaInput;
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
      replyTo: originalPost.replyTo,
      media: options?.media,
      nsfw: options?.nsfw ?? originalPost.nsfw,
      contentWarning: options?.contentWarning ?? originalPost.contentWarning,
      editOf: originalPostId
    });

    // 3. Retract the original post with reason 'edited'
    await this.retractPost(originalPostId, 'edited');

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
      media?: MediaInput;
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
    const mentions = this.extractMentions(content);

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
    const currentTicket = this.getTicket()!;
    const post = await CloutPost.post(config, currentTicket, this.gossip);

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
}
