/**
 * Feed Module - Feed retrieval, filtering, and statistics
 *
 * Handles:
 * - Feed caching and retrieval
 * - NSFW/trust/mute filtering
 * - Content decay processing
 * - Notifications (replies, mentions)
 * - Statistics gathering
 */

import type { CloutStateManager } from '../chronicle/clout-state.js';
import type { CloutLocalData } from './local-data.js';
import type { CloutMessaging } from './messaging.js';
import type { CloutNode } from '../network/clout-node.js';
import type { ReputationValidator } from '../reputation.js';
import type { ContentGossip } from '../post.js';
import {
  type CloutStore,
  type PostPackage,
  type PostDeletePackage,
  type SlidePackage,
  type CloutProfile,
  type Inbox,
  DEFAULT_TRUST_SETTINGS
} from '../clout-types.js';

export interface FeedConfig {
  publicKey: string;
  store?: CloutStore;
  state: CloutStateManager;
  gossip?: ContentGossip;
  localData: CloutLocalData;
  messaging: CloutMessaging;
  trustGraph: Set<string>;
  reputationValidator: ReputationValidator;
  getCloutNode: () => CloutNode | undefined;
  getProfile: () => CloutProfile;
}

export class CloutFeed {
  private readonly publicKeyHex: string;
  private readonly store?: CloutStore;
  private readonly state: CloutStateManager;
  private readonly gossip?: ContentGossip;
  private readonly localData: CloutLocalData;
  private readonly messaging: CloutMessaging;
  private readonly trustGraph: Set<string>;
  private readonly reputationValidator: ReputationValidator;
  private readonly getCloutNode: () => CloutNode | undefined;
  private readonly getProfile: () => CloutProfile;

  // Feed cache to avoid duplicate store.getFeed() calls within a short window
  private feedCache: { posts: PostPackage[]; timestamp: number } | null = null;
  private readonly feedCacheTtlMs = 500; // 500ms cache to dedupe rapid calls

  constructor(config: FeedConfig) {
    this.publicKeyHex = config.publicKey;
    this.store = config.store;
    this.state = config.state;
    this.gossip = config.gossip;
    this.localData = config.localData;
    this.messaging = config.messaging;
    this.trustGraph = config.trustGraph;
    this.reputationValidator = config.reputationValidator;
    this.getCloutNode = config.getCloutNode;
    this.getProfile = config.getProfile;
  }

  /**
   * Get raw feed from store with short-lived cache to dedupe rapid calls
   */
  async getCachedFeed(): Promise<PostPackage[]> {
    if (!this.store) {
      return [];
    }

    const now = Date.now();
    if (this.feedCache && (now - this.feedCache.timestamp) < this.feedCacheTtlMs) {
      return this.feedCache.posts;
    }

    const posts = await this.store.getFeed();
    this.feedCache = { posts, timestamp: now };
    return posts;
  }

  /**
   * Invalidate the feed cache (call after creating/editing/deleting posts)
   */
  invalidateFeedCache(): void {
    this.feedCache = null;
  }

  /**
   * Get posts filtered by tag
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

  /**
   * Get posts from the local feed cache
   */
  async getFeed(options?: {
    tag?: string;
    limit?: number;
    includeNsfw?: boolean;
    includeDeleted?: boolean;
    includeDecayed?: boolean;
    filterByTrust?: boolean;
    trustGraph?: Set<string>;
  }): Promise<PostPackage[]> {
    if (!this.store) {
      throw new Error('No store configured');
    }

    // Process content decay on our own posts (lazy/periodic)
    this.processContentDecay();

    let posts: PostPackage[];

    // Filter by tag if specified
    if (options?.tag) {
      posts = await this.getFeedByTag(options.tag);
    } else {
      posts = await this.getCachedFeed();
    }

    // Filter out deleted posts (unless includeDeleted is true)
    if (!options?.includeDeleted) {
      let deletions: PostDeletePackage[] = [];
      if (this.store && 'getDeletionsSync' in this.store) {
        deletions = (this.store as any).getDeletionsSync() || [];
      } else {
        deletions = this.state.getPostDeletions();
      }
      const deletedPostIds = new Set(deletions.map(d => d.postId));
      posts = posts.filter(post => !deletedPostIds.has(post.id));
    }

    // Build a map of edits: originalId -> latestEditId
    const editMap = new Map<string, string>();
    for (const post of posts) {
      if (post.editOf) {
        editMap.set(post.editOf, post.id);
      }
    }

    // Filter out posts that have been superseded by edits
    posts = posts.filter(post => !editMap.has(post.id));

    // Apply NSFW filtering
    const settings = this.getProfile().trustSettings;
    const showNsfw = options?.includeNsfw ?? settings.showNsfw ?? false;
    const nsfwMinReputation = settings.nsfwMinReputation ?? DEFAULT_TRUST_SETTINGS.nsfwMinReputation ?? 0.7;

    if (!showNsfw) {
      posts = posts.filter(post => !post.nsfw);
    } else {
      posts = posts.filter(post => {
        if (!post.nsfw) return true;
        const rep = this.reputationValidator.computeReputation(post.author);
        return rep.score >= nsfwMinReputation;
      });
    }

    // Filter out muted users
    posts = posts.filter(post => !this.localData.isMuted(post.author));

    // Apply trust filtering if requested (CLI mode / Dark Social Graph)
    if (options?.filterByTrust) {
      const trustSet = options.trustGraph || this.trustGraph;
      posts = posts.filter(post => {
        if (post.author === this.publicKeyHex) return true;
        return trustSet.has(post.author);
      });
    }

    return options?.limit ? posts.slice(0, options.limit) : posts;
  }

  /**
   * Check if a post has been retracted
   */
  isPostRetracted(postId: string): boolean {
    if (this.store && 'isDeleted' in this.store) {
      return (this.store as any).isDeleted(postId);
    }
    return this.state.isPostDeleted(postId);
  }

  /**
   * Get all post retractions
   */
  getPostRetractions(): PostDeletePackage[] {
    if (this.store && 'getDeletionsSync' in this.store) {
      return (this.store as any).getDeletionsSync() || [];
    }
    return this.state.getPostDeletions();
  }

  /**
   * Get the retraction reason for a post
   */
  getRetractionReason(postId: string): string | null {
    const retractions = this.getPostRetractions();
    const retraction = retractions.find(r => r.postId === postId);
    return retraction?.reason || null;
  }

  /**
   * Resolve a post ID through the edit chain to find the latest version
   *
   * If a post was edited, this follows the chain:
   *   originalId -> editedId -> editedId2 -> ... -> latestId
   *
   * Returns the latest post ID in the chain, or the original if not edited.
   */
  async resolvePostId(postId: string): Promise<string> {
    if (!this.store) {
      return postId;
    }

    const allPosts = await this.getCachedFeed();

    // Build edit chain map: originalId -> editedId
    const editMap = new Map<string, string>();
    for (const post of allPosts) {
      if (post.editOf) {
        editMap.set(post.editOf, post.id);
      }
    }

    // Follow the chain to the latest version
    let currentId = postId;
    let iterations = 0;
    const maxIterations = 100; // Prevent infinite loops

    while (editMap.has(currentId) && iterations < maxIterations) {
      currentId = editMap.get(currentId)!;
      iterations++;
    }

    return currentId;
  }

  /**
   * Get a post by ID, resolving through the edit chain
   *
   * If the post was edited, returns the latest version.
   * Also returns info about whether resolution occurred.
   */
  async getPostById(postId: string): Promise<{
    post: PostPackage | null;
    resolved: boolean;
    originalId: string;
    wasRetracted: boolean;
    retractionReason: string | null;
  }> {
    if (!this.store) {
      return { post: null, resolved: false, originalId: postId, wasRetracted: false, retractionReason: null };
    }

    const allPosts = await this.getCachedFeed();

    // First, check if this exact ID exists
    let post = allPosts.find(p => p.id === postId) || null;

    // If found directly, return it
    if (post) {
      return {
        post,
        resolved: false,
        originalId: postId,
        wasRetracted: false,
        retractionReason: null
      };
    }

    // Not found - check if it was retracted
    const wasRetracted = this.isPostRetracted(postId);
    const retractionReason = this.getRetractionReason(postId);

    // If retracted due to edit, try to resolve to the new version
    if (wasRetracted && retractionReason === 'edited') {
      const resolvedId = await this.resolvePostId(postId);
      if (resolvedId !== postId) {
        post = allPosts.find(p => p.id === resolvedId) || null;
        if (post) {
          return {
            post,
            resolved: true,
            originalId: postId,
            wasRetracted: true,
            retractionReason: 'edited'
          };
        }
      }
    }

    // Post not found or couldn't resolve
    return {
      post: null,
      resolved: false,
      originalId: postId,
      wasRetracted,
      retractionReason
    };
  }

  /**
   * Get all replies to a post, including replies to older versions in the edit chain
   *
   * This ensures that when a post is edited, all replies to both the
   * original and edited versions are shown together.
   */
  async getRepliesForPost(postId: string): Promise<PostPackage[]> {
    if (!this.store) {
      return [];
    }

    const allPosts = await this.getCachedFeed();

    // Build the edit chain backwards: collect all IDs that lead to this post
    // We need to find replies to ANY version in the chain
    const chainIds = new Set<string>([postId]);

    // Find all posts that were edited into this one (reverse chain)
    let foundMore = true;
    while (foundMore) {
      foundMore = false;
      for (const post of allPosts) {
        if (post.editOf && chainIds.has(post.id) && !chainIds.has(post.editOf)) {
          // This post is an edit of something - add the original to the chain
          chainIds.add(post.editOf);
          foundMore = true;
        }
      }
    }

    // Also check retractions for edit chains we might have missed
    const retractions = this.getPostRetractions();
    for (const retraction of retractions) {
      if (retraction.reason === 'edited') {
        // Find if this retracted post leads to our chain
        const resolvedId = await this.resolvePostId(retraction.postId);
        if (chainIds.has(resolvedId)) {
          chainIds.add(retraction.postId);
        }
      }
    }

    // Find all replies to any post in the chain
    const replies = allPosts.filter(p => p.replyTo && chainIds.has(p.replyTo));

    // Sort by timestamp
    replies.sort((a, b) => {
      const timeA = a.proof?.timestamp || 0;
      const timeB = b.proof?.timestamp || 0;
      return timeA - timeB;
    });

    return replies;
  }

  /**
   * Process content decay for old posts
   */
  processContentDecay(): number {
    const settings = this.getProfile().trustSettings;
    if (!settings.contentDecay?.enabled) return 0;

    return this.state.processContentDecay({
      enabled: settings.contentDecay.enabled,
      decayAfterDays: settings.contentDecay.decayAfterDays,
      retractedDecayDays: settings.contentDecay.retractedDecayDays
    });
  }

  /**
   * Check if a post's content has decayed
   */
  isPostDecayed(post: PostPackage): boolean {
    return !!post.decayedAt || post.content === null;
  }

  /**
   * Get profile for any user
   */
  getProfileForUser(publicKey: string): CloutProfile | null {
    if (publicKey === this.publicKeyHex) {
      return this.getProfile();
    }

    return {
      publicKey,
      trustGraph: new Set(),
      trustSettings: DEFAULT_TRUST_SETTINGS
    };
  }

  /**
   * Get invitation chain details
   */
  getInvitationChain() {
    const trusts = Array.from(this.trustGraph).filter(k => k !== this.publicKeyHex);
    return {
      invitedBy: undefined,
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

    // Fetch feed ONCE and reuse for replies + mentions (uses cache)
    const allPosts = await this.getCachedFeed();

    // Count unread replies to my posts
    const myPostIds = new Set(
      allPosts.filter((p: any) => p.author === this.publicKeyHex).map((p: any) => p.id)
    );
    const unreadReplies = allPosts.filter((p: any) => {
      if (!p.replyTo || !myPostIds.has(p.replyTo)) return false;
      if (p.author === this.publicKeyHex) return false;
      const timestamp = p.proof?.timestamp || 0;
      return timestamp > state.lastSeenReplies;
    }).length;

    // Count unread mentions (inline instead of calling getMentions)
    const unreadMentions = allPosts.filter((p: any) => {
      if (p.author === this.publicKeyHex) return false;
      if (!p.mentions) return false;
      const isMentioned = p.mentions.some((m: string) =>
        this.publicKeyHex.startsWith(m) || m.startsWith(this.publicKeyHex.slice(0, 8))
      );
      if (!isMentioned) return false;
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

    if (options?.unreadOnly) {
      const lastSeen = this.localData.getLastSeen('replies');
      replies = replies.filter((p: any) => (p.proof?.timestamp || 0) > lastSeen);
    }

    replies.sort((a: any, b: any) => {
      const timeA = a.proof?.timestamp || 0;
      const timeB = b.proof?.timestamp || 0;
      return timeB - timeA;
    });

    return options?.limit ? replies.slice(0, options.limit) : replies;
  }

  /**
   * Get posts where the current user is mentioned
   */
  async getMentions(options?: { limit?: number }): Promise<PostPackage[]> {
    if (!this.store) {
      throw new Error('No store configured');
    }

    const allPosts = await this.store.getFeed();

    const mentions = allPosts.filter(post => {
      if (!post.mentions) return false;
      return post.mentions.some(m =>
        this.publicKeyHex.startsWith(m) || m.startsWith(this.publicKeyHex.slice(0, 8))
      );
    });

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

  // -----------------------------------------------------------------
  //  STATISTICS
  // -----------------------------------------------------------------

  /**
   * Get node statistics
   */
  async getStats() {
    let feedCount = 0;
    if (this.store) {
      // Use getFeed() to exclude retracted posts from the count
      const feed = await this.getFeed({ includeNsfw: true });
      feedCount = feed.length;
    } else if (this.gossip && (this.gossip as any).getStats) {
      feedCount = (this.gossip as any).getStats().postCount || 0;
    }

    let slideCount = 0;
    if (this.store) {
      const inbox = await this.store.getInbox();
      slideCount = inbox.length;
    } else if (this.gossip && (this.gossip as any).getSlides) {
      slideCount = (this.gossip as any).getSlides().length;
    }

    return {
      identity: {
        trustCount: this.trustGraph.size,
        publicKey: this.publicKeyHex
      },
      state: {
        postCount: feedCount,
        slideCount
      }
    };
  }

  /**
   * Get Clout stats - metrics for your Chronicle blob
   */
  async getCloutStats(): Promise<{
    chronicleSize: number;
    trustReach: number;
    uniqueAuthors: number;
    myPostCount: number;
    reactionCount: number;
    connectedPeers: number;
    blobDensity: number;
  }> {
    const state = this.state.getState();
    const myPosts = state.myPosts || [];
    const trustSignals = state.myTrustSignals || [];

    // Use getFeed() to exclude retracted posts from counts
    const feed = await this.getFeed({ includeNsfw: true });
    const uniqueAuthors = new Set(feed.map(p => p.author)).size;

    // Count ALL reactions from the store, not just user's own reactions
    let totalReactionCount = 0;
    if (this.store && 'getReactionsSync' in this.store) {
      const allReactions = (this.store as any).getReactionsSync() || [];
      // Count non-removed reactions
      totalReactionCount = allReactions.filter((r: any) => !r.removed).length;
    }

    const cloutNode = this.getCloutNode();
    const connectedPeers = cloutNode?.getPeers().length ?? 0;

    const blobDensity = uniqueAuthors > 0
      ? trustSignals.length / uniqueAuthors
      : 0;

    return {
      chronicleSize: feed.length,
      trustReach: this.trustGraph.size,
      uniqueAuthors,
      myPostCount: myPosts.length,
      reactionCount: totalReactionCount,
      connectedPeers,
      blobDensity: Math.round(blobDensity * 100) / 100
    };
  }
}
