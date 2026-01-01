/**
 * Feed Routes - Posts, threads, reactions, mentions, and live updates
 */

import { Router, Response } from 'express';
import type { Clout } from '../../clout.js';

// Store connected SSE clients for live updates
const sseClients: Set<Response> = new Set();

// Notify all connected clients of a new post
export function notifyNewPost(post: any) {
  const message = JSON.stringify({ type: 'new_post', data: post });
  for (const client of sseClients) {
    client.write(`data: ${message}\n\n`);
  }
}

// Notify clients of notification count changes
export function notifyNotifications(counts: any) {
  const message = JSON.stringify({ type: 'notifications', data: counts });
  for (const client of sseClients) {
    client.write(`data: ${message}\n\n`);
  }
}

// Helper to get reactions summary for a post
function getReactionsSummary(clout: Clout, postId: string) {
  const { reactions, myReaction } = clout.getReactionsForPost(postId);
  const summary: Record<string, number> = {};
  let totalCount = 0;
  reactions.forEach((data, emoji) => {
    summary[emoji] = data.count;
    totalCount += data.count;
  });
  return { reactions: summary, myReaction, totalCount };
}

// Valid sort options
type SortOption = 'newest' | 'reactions' | 'replies' | 'hot';

// Helper to compute reply counts for all posts
function computeReplyCounts(posts: any[]): Map<string, number> {
  const replyCounts = new Map<string, number>();
  for (const post of posts) {
    if (post.replyTo) {
      const current = replyCounts.get(post.replyTo) || 0;
      replyCounts.set(post.replyTo, current + 1);
    }
  }
  return replyCounts;
}

// Hot ranking algorithm: combines recency with engagement
// Score = (reactions + replies * 2) / (age_in_hours + 2)^1.5
function computeHotScore(post: any, reactionCount: number, replyCount: number): number {
  const timestamp = post.proof?.timestamp || post.timestamp || Date.now();
  const ageMs = Date.now() - timestamp;
  const ageHours = Math.max(0, ageMs / (1000 * 60 * 60));

  // Replies weighted more than reactions (indicate discussion)
  const engagement = reactionCount + (replyCount * 2);

  // Gravity factor - older posts decay faster
  const gravity = Math.pow(ageHours + 2, 1.5);

  return engagement / gravity;
}

export function createFeedRoutes(
  getClout: () => Clout | undefined,
  isInitialized: () => boolean,
  areVisitorsAllowed: () => boolean = () => true
): Router {
  const router = Router();

  // Get Feed
  // Public route - visitors can view the feed without an identity (if allowed)
  // Supports sorting: newest (default), reactions, replies, hot
  // Supports pagination: limit + offset
  router.get('/feed', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const sort = (req.query.sort as SortOption) || 'newest';
      const includeNsfw = req.query.nsfw === 'true' ? true : undefined;

      // Validate sort option
      const validSorts: SortOption[] = ['newest', 'reactions', 'replies', 'hot'];
      if (!validSorts.includes(sort)) {
        return res.status(400).json({
          success: false,
          error: `Invalid sort option. Valid options: ${validSorts.join(', ')}`
        });
      }

      // Check if we have an initialized member or just a visitor
      const isMember = isInitialized();
      const clout = getClout();

      if (!isMember || !clout) {
        // Check if visitors are allowed
        if (!areVisitorsAllowed()) {
          // Private instance - require identity
          return res.status(401).json({
            success: false,
            error: 'This is a private Clout instance. Identity required.',
            requiresIdentity: true
          });
        }

        // Visitor mode - return empty feed with visitor flag
        // In the future, this could return a curated public feed from gossip
        return res.json({
          success: true,
          data: {
            posts: [],
            totalPosts: 0,
            nsfwEnabled: false,
            isVisitor: true,
            visitorsAllowed: true,
            sort,
            message: 'Welcome! Join with an invitation code to see the full feed.'
          }
        });
      }

      // Member mode - full personalized feed
      const allPosts = await clout.getFeed({ includeNsfw });

      // Compute reply counts for sorting
      const replyCounts = computeReplyCounts(allPosts);

      // Get current user's profile for avatar lookup
      const userProfile = clout.getProfile();
      const userPublicKey = userProfile.publicKey;
      const userAvatar = userProfile.metadata?.avatar || '👤';

      // Enrich posts with reaction/reply counts for sorting
      const enrichedPosts = allPosts.map((post: any) => {
        const reactionData = getReactionsSummary(clout, post.id);
        const replyCount = replyCounts.get(post.id) || 0;
        return {
          post,
          reactionCount: reactionData.totalCount,
          replyCount,
          reactionData,
          hotScore: computeHotScore(post, reactionData.totalCount, replyCount)
        };
      });

      // Sort based on selected option
      switch (sort) {
        case 'reactions':
          enrichedPosts.sort((a, b) => b.reactionCount - a.reactionCount);
          break;
        case 'replies':
          enrichedPosts.sort((a, b) => b.replyCount - a.replyCount);
          break;
        case 'hot':
          enrichedPosts.sort((a, b) => b.hotScore - a.hotScore);
          break;
        case 'newest':
        default:
          // Already sorted by newest from getFeed()
          break;
      }

      // Apply pagination
      const paginatedPosts = enrichedPosts.slice(offset, offset + limit);
      const hasMore = offset + limit < enrichedPosts.length;

      res.json({
        success: true,
        data: {
          posts: paginatedPosts.map(({ post, reactionData, replyCount }) => {
            const trustPath = clout.getTrustPath(post.author);
            const isAuthor = post.author === userPublicKey;
            // Use embedded author data from post, fall back to server lookups, then defaults
            const authorAvatar = post.authorAvatar || (isAuthor ? userAvatar : '👤');
            const authorDisplayName = post.authorDisplayName || clout.getDisplayName(post.author);
            return {
              ...post,
              authorShort: post.author.slice(0, 8),
              authorDisplayName,
              authorNickname: clout.getNickname(post.author),
              authorAvatar,
              reputation: clout.getReputation(post.author),
              authorTags: clout.getTagsForUser(post.author),
              trustPath: trustPath?.path.map(k => clout.getDisplayName(k)) || [],
              trustPathKeys: trustPath?.path.map(k => k.slice(0, 8)) || [],
              isDirectlyTrusted: clout.isDirectlyTrusted(post.author),
              reactions: reactionData.reactions,
              myReaction: reactionData.myReaction,
              replyCount,
              isBookmarked: clout.isBookmarked(post.id),
              isAuthor,
              isEdited: !!post.editOf,
              isDecayed: clout.isPostDecayed(post)
            };
          }),
          totalPosts: allPosts.length,
          offset,
          limit,
          hasMore,
          sort,
          nsfwEnabled: clout.isNsfwEnabled(),
          isVisitor: false
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Create Post
  router.post('/post', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;
      const { content, replyTo, mediaCid, nsfw, contentWarning } = req.body;

      // Auto-mint ticket if needed
      let ticketJustMinted = false;
      if (!clout.hasActiveTicket()) {
        const token = await clout.obtainToken();
        await clout.buyDayPass(token);
        ticketJustMinted = true;
      }

      const options: {
        replyTo?: string;
        media?: { data: Uint8Array; mimeType: string; filename?: string };
        nsfw?: boolean;
        contentWarning?: string;
      } = {};
      if (replyTo) options.replyTo = replyTo;
      if (nsfw) options.nsfw = true;
      if (contentWarning) options.contentWarning = contentWarning;

      if (mediaCid) {
        const mediaData = await clout.resolveMedia(mediaCid);
        const metadata = clout.getMediaMetadata(mediaCid);
        if (mediaData && metadata) {
          options.media = {
            data: mediaData,
            mimeType: metadata.mimeType,
            filename: metadata.filename
          };
        }
      }

      const post = await clout.post(content || '', options);

      // Always include ticket info if there's an active ticket (for UI timer)
      const ticketInfo = clout.getTicketInfo();

      res.json({
        success: true,
        data: {
          ...post.getPackage(),
          ticketInfo: ticketInfo || undefined
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Retract Post - publicly take back what you said
  router.post('/post/:id/retract', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;
      const postId = req.params.id;
      const reason = req.body.reason as 'retracted' | 'edited' | 'mistake' | 'other' | undefined;

      const retraction = await clout.retractPost(postId, reason || 'retracted');
      res.json({ success: true, data: { postId, retracted: true, reason: retraction.reason } });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // @deprecated - Use POST /post/:id/retract instead
  router.delete('/post/:id', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;
      const postId = req.params.id;
      const reason = req.body.reason as 'retracted' | 'edited' | 'mistake' | 'other' | undefined;

      const retraction = await clout.retractPost(postId, reason || 'retracted');
      res.json({ success: true, data: { postId, retracted: true, reason: retraction.reason } });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Edit Post
  router.put('/post/:id', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;
      const originalPostId = req.params.id;
      const { content, nsfw, contentWarning } = req.body;

      if (!content || content.trim() === '') {
        return res.status(400).json({ success: false, error: 'Content is required' });
      }

      const newPost = await clout.editPost(originalPostId, content, {
        nsfw,
        contentWarning
      });

      const pkg = newPost.getPackage();
      res.json({
        success: true,
        data: {
          originalPostId,
          newPost: {
            ...pkg,
            authorShort: pkg.author.slice(0, 8),
            authorDisplayName: clout.getDisplayName(pkg.author)
          }
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get Thread
  // Public route - visitors can view threads (if allowed)
  // Supports edit chain resolution: if the requested post was edited,
  // automatically resolves to the latest version and includes all replies
  // from the entire edit chain.
  router.get('/thread/:id', async (req, res) => {
    try {
      const postId = req.params.id;
      const isMember = isInitialized();
      const clout = getClout();

      if (!isMember || !clout) {
        // Check if visitors are allowed
        if (!areVisitorsAllowed()) {
          return res.status(401).json({
            success: false,
            error: 'This is a private Clout instance. Identity required.',
            requiresIdentity: true
          });
        }

        // Visitor mode - return empty thread with visitor flag
        return res.json({
          success: true,
          data: {
            parent: null,
            replies: [],
            isVisitor: true,
            message: 'Join with an invitation code to view threads.'
          }
        });
      }

      // Use getPostById which handles edit chain resolution
      const { post: parentPost, resolved, originalId, wasRetracted, retractionReason } = await clout.getPostById(postId);

      if (!parentPost) {
        // Post not found - check why
        if (wasRetracted) {
          const message = retractionReason === 'edited'
            ? 'This post was edited but the new version could not be found'
            : 'This post was retracted by the author';
          return res.status(404).json({
            success: false,
            error: message,
            isRetracted: true,
            retractionReason
          });
        }
        return res.status(404).json({
          success: false,
          error: 'Post not found',
          isRetracted: false
        });
      }

      // Get replies using the edit-chain-aware method
      const replies = await clout.getRepliesForPost(parentPost.id);

      // Pre-resolve all replyTo IDs so links point to the latest version
      const replyToIds = new Set(replies.map(r => r.replyTo).filter(Boolean));
      const resolvedReplyToMap = new Map<string, string>();
      for (const replyToId of replyToIds) {
        const resolvedId = await clout.resolvePostId(replyToId!);
        resolvedReplyToMap.set(replyToId!, resolvedId);
      }

      // Get current user's profile for avatar lookup
      const userProfile = clout.getProfile();
      const userPublicKey = userProfile.publicKey;
      const userAvatar = userProfile.metadata?.avatar || '👤';

      // Helper to enrich post with reactions, bookmarks, etc.
      const enrichPost = (post: any) => {
        const reactionData = getReactionsSummary(clout, post.id);
        const isAuthor = post.author === userPublicKey;
        // Resolve replyTo to the latest version in the edit chain
        const resolvedReplyTo = post.replyTo ? resolvedReplyToMap.get(post.replyTo) || post.replyTo : undefined;
        // Use embedded author data from post, fall back to server lookups, then defaults
        const authorAvatar = post.authorAvatar || (isAuthor ? userAvatar : '👤');
        const authorDisplayName = post.authorDisplayName || clout.getDisplayName(post.author);
        return {
          ...post,
          authorShort: post.author.slice(0, 8),
          authorDisplayName,
          authorNickname: clout.getNickname(post.author),
          authorAvatar,
          reactions: reactionData.reactions,
          myReaction: reactionData.myReaction,
          isBookmarked: clout.isBookmarked(post.id),
          isAuthor,
          isEdited: !!post.editOf,
          isDecayed: clout.isPostDecayed(post),
          // Include resolved replyTo for correct thread navigation
          resolvedReplyTo
        };
      };

      res.json({
        success: true,
        data: {
          parent: enrichPost(parentPost),
          replies: replies.map(enrichPost),
          isVisitor: false,
          // Include resolution info for the frontend
          resolved,
          originalId: resolved ? originalId : undefined
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get feed filtered by tag
  router.get('/feed/tag/:tag', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const tag = req.params.tag;
      const limit = parseInt(req.query.limit as string) || 50;

      const posts = await clout.getFeed({ tag, limit });

      // Get current user's profile for avatar lookup
      const userProfile = clout.getProfile();
      const userPublicKey = userProfile.publicKey;
      const userAvatar = userProfile.metadata?.avatar || '👤';

      res.json({
        success: true,
        data: {
          tag,
          posts: posts.map((post: any) => {
            const isAuthor = post.author === userPublicKey;
            return {
              ...post,
              authorShort: post.author.slice(0, 8),
              reputation: clout.getReputation(post.author),
              authorAvatar: post.authorAvatar || (isAuthor ? userAvatar : '👤'),
              authorDisplayName: post.authorDisplayName || clout.getDisplayName(post.author)
            };
          }),
          totalPosts: posts.length
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get Stats
  router.get('/stats', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const stats = await getClout()!.getStats();
      res.json({ success: true, data: stats });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // =========================================================================
  // REACTIONS
  // =========================================================================

  // Get available reaction emojis
  router.get('/reactions/emojis', (req, res) => {
    const { Clout } = require('../../clout.js');
    res.json({
      success: true,
      data: { emojis: Clout.REACTION_EMOJIS }
    });
  });

  // React to a post
  router.post('/react', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;
      const { postId, emoji } = req.body;

      if (!postId) {
        return res.status(400).json({ success: false, error: 'postId is required' });
      }

      const reaction = await clout.react(postId, emoji || '👍');
      res.json({ success: true, data: { postId, emoji: reaction.emoji } });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Remove reaction from a post
  router.post('/unreact', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;
      const { postId, emoji } = req.body;

      if (!postId) {
        return res.status(400).json({ success: false, error: 'postId is required' });
      }

      await clout.unreact(postId, emoji || '👍');
      res.json({ success: true, data: { postId, removed: true } });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get reactions for a specific post
  router.get('/reactions/:postId', (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;
      const { postId } = req.params;

      const { reactions, myReaction } = clout.getReactionsForPost(postId);

      // Convert Map to plain object
      const reactionCounts: Record<string, number> = {};
      reactions.forEach((data, emoji) => {
        reactionCounts[emoji] = data.count;
      });

      res.json({
        success: true,
        data: {
          postId,
          reactions: reactionCounts,
          myReaction
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // =========================================================================
  // MENTIONS
  // =========================================================================

  // Get posts that mention the current user
  router.get('/mentions', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const limit = parseInt(req.query.limit as string) || 20;
      const posts = await clout.getMentions({ limit });

      // Get current user's profile for avatar lookup
      const userProfile = clout.getProfile();
      const userPublicKey = userProfile.publicKey;
      const userAvatar = userProfile.metadata?.avatar || '👤';

      res.json({
        success: true,
        data: {
          posts: posts.map((post: any) => {
            const isAuthor = post.author === userPublicKey;
            return {
              ...post,
              authorShort: post.author.slice(0, 8),
              authorDisplayName: post.authorDisplayName || clout.getDisplayName(post.author),
              authorAvatar: post.authorAvatar || (isAuthor ? userAvatar : '👤'),
              reactions: getReactionsSummary(clout, post.id).reactions
            };
          }),
          count: posts.length
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // =========================================================================
  // BOOKMARKS
  // =========================================================================

  // Get bookmarked posts
  router.get('/bookmarks', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const posts = await clout.getBookmarks();

      // Get current user's profile for avatar lookup
      const userProfile = clout.getProfile();
      const userPublicKey = userProfile.publicKey;
      const userAvatar = userProfile.metadata?.avatar || '👤';

      res.json({
        success: true,
        data: {
          posts: posts.map((post: any) => {
            const isAuthor = post.author === userPublicKey;
            return {
              ...post,
              authorShort: post.author.slice(0, 8),
              authorDisplayName: post.authorDisplayName || clout.getDisplayName(post.author),
              authorAvatar: post.authorAvatar || (isAuthor ? userAvatar : '👤'),
              reactions: getReactionsSummary(clout, post.id).reactions,
              isBookmarked: true
            };
          }),
          count: posts.length
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Bookmark a post
  router.post('/bookmark', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;
      const { postId } = req.body;

      if (!postId) {
        return res.status(400).json({ success: false, error: 'postId is required' });
      }

      await clout.bookmark(postId);
      res.json({ success: true, data: { postId, bookmarked: true } });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Remove bookmark from a post
  router.post('/unbookmark', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;
      const { postId } = req.body;

      if (!postId) {
        return res.status(400).json({ success: false, error: 'postId is required' });
      }

      await clout.unbookmark(postId);
      res.json({ success: true, data: { postId, bookmarked: false } });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // =========================================================================
  // SEARCH
  // =========================================================================

  // Search posts by content or author
  router.get('/search', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const query = (req.query.q as string || '').toLowerCase().trim();
      const limit = parseInt(req.query.limit as string) || 50;

      if (!query) {
        return res.json({ success: true, data: { posts: [], count: 0, query: '' } });
      }

      const allPosts = await clout.getFeed();

      // Search in content, author key, and author display name
      const results = allPosts.filter((post: any) => {
        const content = (post.content || '').toLowerCase();
        const authorKey = post.author.toLowerCase();
        const displayName = (clout.getDisplayName(post.author) || '').toLowerCase();
        const nickname = (clout.getNickname(post.author) || '').toLowerCase();

        return content.includes(query) ||
               authorKey.includes(query) ||
               displayName.includes(query) ||
               nickname.includes(query);
      }).slice(0, limit);

      // Get current user's profile for avatar lookup
      const userProfile = clout.getProfile();
      const userPublicKey = userProfile.publicKey;
      const userAvatar = userProfile.metadata?.avatar || '👤';

      res.json({
        success: true,
        data: {
          posts: results.map((post: any) => {
            const isAuthor = post.author === userPublicKey;
            return {
              ...post,
              authorShort: post.author.slice(0, 8),
              authorDisplayName: post.authorDisplayName || clout.getDisplayName(post.author),
              authorAvatar: post.authorAvatar || (isAuthor ? userAvatar : '👤'),
              reactions: getReactionsSummary(clout, post.id).reactions,
              isBookmarked: clout.isBookmarked(post.id)
            };
          }),
          count: results.length,
          query
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // =========================================================================
  // NOTIFICATIONS
  // =========================================================================

  // Get notification counts
  router.get('/notifications/counts', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const counts = await clout.getNotificationCounts();
      res.json({ success: true, data: counts });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get replies to my posts
  router.get('/notifications/replies', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const limit = parseInt(req.query.limit as string) || 20;
      const unreadOnly = req.query.unread === 'true';

      const replies = await clout.getReplies({ limit, unreadOnly });

      // Get current user's profile for avatar lookup
      const userProfile = clout.getProfile();
      const userPublicKey = userProfile.publicKey;
      const userAvatar = userProfile.metadata?.avatar || '👤';

      res.json({
        success: true,
        data: {
          posts: replies.map((post: any) => {
            const isAuthor = post.author === userPublicKey;
            return {
              ...post,
              authorShort: post.author.slice(0, 8),
              authorDisplayName: post.authorDisplayName || clout.getDisplayName(post.author),
              authorAvatar: post.authorAvatar || (isAuthor ? userAvatar : '👤'),
              reactions: getReactionsSummary(clout, post.id).reactions
            };
          }),
          count: replies.length
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Mark notifications as seen
  router.post('/notifications/mark-seen', (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;
      const { type } = req.body;

      switch (type) {
        case 'slides':
          clout.markSlidesSeen();
          break;
        case 'replies':
          clout.markRepliesSeen();
          break;
        case 'mentions':
          clout.markMentionsSeen();
          break;
        case 'all':
          clout.markSlidesSeen();
          clout.markRepliesSeen();
          clout.markMentionsSeen();
          break;
        default:
          return res.status(400).json({ success: false, error: 'Invalid type. Use: slides, replies, mentions, or all' });
      }

      res.json({ success: true, data: { marked: type } });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // =========================================================================
  // LIVE UPDATES (Server-Sent Events)
  // =========================================================================

  // SSE endpoint for live updates
  router.get('/live', (req, res) => {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering for nginx

    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);

    // Add client to set
    sseClients.add(res);
    console.log(`[SSE] Client connected. Total: ${sseClients.size}`);

    // Send heartbeat every 30 seconds to keep connection alive
    const heartbeat = setInterval(() => {
      res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })}\n\n`);
    }, 30000);

    // Remove client on disconnect
    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
      console.log(`[SSE] Client disconnected. Total: ${sseClients.size}`);
    });
  });

  // Get number of connected clients (for debugging)
  router.get('/live/status', (req, res) => {
    res.json({
      success: true,
      data: {
        connectedClients: sseClients.size
      }
    });
  });

  return router;
}
