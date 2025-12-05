/**
 * Feed Routes - Posts, threads, and feed retrieval
 */

import { Router } from 'express';
import type { Clout } from '../../clout.js';

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
            return {
              ...post,
              authorShort: post.author.slice(0, 8),
              authorDisplayName: clout.getDisplayName(post.author),
              authorNickname: clout.getNickname(post.author),
              reputation: clout.getReputation(post.author),
              authorTags: clout.getTagsForUser(post.author),
              trustPath: trustPath?.path.map(k => clout.getDisplayName(k)) || [],
              trustPathKeys: trustPath?.path.map(k => k.slice(0, 8)) || [],
              isDirectlyTrusted: clout.isDirectlyTrusted(post.author)
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
      const { content, replyTo, mediaCid, nsfw } = req.body;

      // Auto-mint ticket if needed
      if (!clout.hasActiveTicket()) {
        const token = await clout.obtainToken();
        await clout.buyDayPass(token);
      }

      const options: {
        replyTo?: string;
        media?: { data: Uint8Array; mimeType: string; filename?: string };
        nsfw?: boolean;
      } = {};
      if (replyTo) options.replyTo = replyTo;
      if (nsfw) options.nsfw = true;

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

  return router;
}
