/**
 * Feed Routes - Posts, threads, reactions, and mentions
 */

import { Router } from 'express';
import type { Clout } from '../../clout.js';

// Helper to get reactions summary for a post
function getReactionsSummary(clout: Clout, postId: string) {
  const { reactions, myReaction } = clout.getReactionsForPost(postId);
  const summary: Record<string, number> = {};
  reactions.forEach((data, emoji) => {
    summary[emoji] = data.count;
  });
  return { reactions: summary, myReaction };
}

export function createFeedRoutes(getClout: () => Clout | undefined, isInitialized: () => boolean): Router {
  const router = Router();

  // Get Feed
  router.get('/feed', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const limit = parseInt(req.query.limit as string) || 50;
      const includeNsfw = req.query.nsfw === 'true' ? true : undefined;

      const allPosts = await clout.getFeed({ includeNsfw });
      const posts = allPosts.slice(0, limit);

      res.json({
        success: true,
        data: {
          posts: posts.map((post: any) => {
            const trustPath = clout.getTrustPath(post.author);
            const reactionData = getReactionsSummary(clout, post.id);
            return {
              ...post,
              authorShort: post.author.slice(0, 8),
              authorDisplayName: clout.getDisplayName(post.author),
              authorNickname: clout.getNickname(post.author),
              reputation: clout.getReputation(post.author),
              authorTags: clout.getTagsForUser(post.author),
              trustPath: trustPath?.path.map(k => clout.getDisplayName(k)) || [],
              trustPathKeys: trustPath?.path.map(k => k.slice(0, 8)) || [],
              isDirectlyTrusted: clout.isDirectlyTrusted(post.author),
              reactions: reactionData.reactions,
              myReaction: reactionData.myReaction
            };
          }),
          totalPosts: allPosts.length,
          nsfwEnabled: clout.isNsfwEnabled()
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
      if (!clout.hasActiveTicket()) {
        const token = await clout.obtainToken();
        await clout.buyDayPass(token);
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
      res.json({ success: true, data: post.getPackage() });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get Thread
  router.get('/thread/:id', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;
      const postId = req.params.id;

      const allPosts = await clout.getFeed();
      const parentPost = allPosts.find((p: any) => p.id === postId);

      if (!parentPost) {
        return res.status(404).json({ success: false, error: 'Post not found' });
      }

      const replies = allPosts
        .filter((p: any) => p.replyTo === postId)
        .sort((a: any, b: any) => a.proof.timestamp - b.proof.timestamp);

      res.json({
        success: true,
        data: {
          parent: {
            ...parentPost,
            authorShort: parentPost.author.slice(0, 8),
            authorDisplayName: clout.getDisplayName(parentPost.author),
            authorNickname: clout.getNickname(parentPost.author)
          },
          replies: replies.map((post: any) => ({
            ...post,
            authorShort: post.author.slice(0, 8),
            authorDisplayName: clout.getDisplayName(post.author),
            authorNickname: clout.getNickname(post.author)
          }))
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

      res.json({
        success: true,
        data: {
          tag,
          posts: posts.map((post: any) => ({
            ...post,
            authorShort: post.author.slice(0, 8),
            reputation: clout.getReputation(post.author)
          })),
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

      res.json({
        success: true,
        data: {
          posts: posts.map((post: any) => ({
            ...post,
            authorShort: post.author.slice(0, 8),
            authorDisplayName: clout.getDisplayName(post.author),
            reactions: getReactionsSummary(clout, post.id).reactions
          })),
          count: posts.length
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}
