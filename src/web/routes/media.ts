/**
 * Media Routes - WNFS-based content-addressed storage
 */

import { Router } from 'express';
import { Clout } from '../../clout.js';

// Allowed content types for upload (SVG excluded - XSS vector)
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/ogg',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'application/pdf'
]);

// Maximum file size: 100MB
const MAX_FILE_SIZE = 100 * 1024 * 1024;

/**
 * Sanitize filename to prevent path traversal attacks
 * Removes path separators and parent directory references
 */
function sanitizeFilename(filename: string | undefined): string | undefined {
  if (!filename) return undefined;

  // Remove path separators and parent directory references
  let sanitized = filename
    .replace(/\.\./g, '')           // Remove ..
    .replace(/[\/\\]/g, '')          // Remove / and \
    .replace(/[\x00-\x1f]/g, '')     // Remove control characters
    .trim();

  // Limit length
  if (sanitized.length > 255) {
    sanitized = sanitized.slice(0, 255);
  }

  // If nothing left, return undefined
  return sanitized.length > 0 ? sanitized : undefined;
}

export function createMediaRoutes(getClout: () => Clout | undefined, isInitialized: () => boolean): Router {
  const router = Router();

  // Upload Media - returns CID for later use in posts
  router.post('/upload', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const contentType = req.headers['content-type'] || 'application/octet-stream';
      const rawFilename = req.headers['x-filename'] as string | undefined;
      const data = req.body as Buffer;

      // Validate content type (whitelist approach)
      if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
        return res.status(400).json({
          success: false,
          error: `Content type not allowed: ${contentType}. Allowed types: ${Array.from(ALLOWED_CONTENT_TYPES).join(', ')}`
        });
      }

      // Validate file size server-side
      if (!data || data.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No file data received'
        });
      }

      if (data.length > MAX_FILE_SIZE) {
        return res.status(400).json({
          success: false,
          error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`
        });
      }

      // Sanitize filename to prevent path traversal
      const filename = sanitizeFilename(rawFilename);

      // Store in WNFS blockstore
      const clout = getClout()!;
      const metadata = await clout.storage.store(
        new Uint8Array(data),
        contentType,
        filename
      );

      console.log(`[WebServer] Media uploaded: ${metadata.cid.slice(0, 12)}... (${contentType}, ${data.length} bytes)`);

      res.json({
        success: true,
        data: metadata
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get Media by CID (local storage only)
  router.get('/:cid', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const cid = req.params.cid;
      const data = await clout.resolveMedia(cid);

      if (!data) {
        return res.status(404).json({
          success: false,
          error: 'Media not found'
        });
      }

      // Get metadata for content-type
      const metadata = clout.getMediaMetadata(cid);
      const contentType = metadata?.mimeType || 'application/octet-stream';

      // Set appropriate headers
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', data.length);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // CIDs are immutable
      if (metadata?.filename) {
        res.setHeader('Content-Disposition', `inline; filename="${metadata.filename}"`);
      }

      res.send(Buffer.from(data));
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get Media for a specific post (with P2P fetch support)
  // Uses contentTypeFilters to determine if P2P fetch is allowed based on author hop distance
  router.get('/post/:postId', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const postId = req.params.postId;
      const feed = await clout.getFeed();
      const post = feed.find(p => p.id === postId);

      if (!post) {
        return res.status(404).json({
          success: false,
          error: 'Post not found'
        });
      }

      // Check if post has media
      if (!Clout.postHasMedia(post)) {
        return res.status(404).json({
          success: false,
          error: 'Post has no media'
        });
      }

      // Resolve media (will try local first, then P2P if allowed by contentTypeFilters)
      const data = await clout.resolvePostMedia(post, true);

      if (!data) {
        // Media not available - could be beyond hop distance or author offline
        const cid = Clout.extractMediaCid(post);
        const authorReputation = (clout as any).reputationValidator.computeReputation(post.author);

        return res.status(403).json({
          success: false,
          error: 'Media not available',
          reason: authorReputation.distance > 1
            ? `Author is ${authorReputation.distance} hops away. Adjust Media Trust Settings to fetch from further.`
            : 'Author is offline or media not found'
        });
      }

      // Get metadata for content-type
      const cid = Clout.extractMediaCid(post);
      const metadata = cid ? clout.getMediaMetadata(cid) : null;
      const contentType = post.media?.mimeType || metadata?.mimeType || 'application/octet-stream';

      // Set appropriate headers
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', data.length);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      if (metadata?.filename || post.media?.filename) {
        res.setHeader('Content-Disposition', `inline; filename="${metadata?.filename || post.media?.filename}"`);
      }

      res.send(Buffer.from(data));
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get Media Metadata
  router.get('/:cid/info', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const cid = req.params.cid;
      const metadata = getClout()!.getMediaMetadata(cid);

      if (!metadata) {
        return res.status(404).json({
          success: false,
          error: 'Media metadata not found'
        });
      }

      res.json({ success: true, data: metadata });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get Media Stats (note: must come before /:cid to avoid matching)
  router.get('/stats', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const stats = await getClout()!.getMediaStats();
      res.json({ success: true, data: stats });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Check if Media Exists
  router.head('/:cid', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const cid = req.params.cid;
      const exists = await clout.hasMedia(cid);

      if (!exists) {
        return res.status(404).end();
      }

      const metadata = clout.getMediaMetadata(cid);
      if (metadata) {
        res.setHeader('Content-Type', metadata.mimeType);
        res.setHeader('Content-Length', metadata.size);
      }

      res.status(200).end();
    } catch (error: any) {
      res.status(500).end();
    }
  });

  return router;
}
