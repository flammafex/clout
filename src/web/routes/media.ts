/**
 * Media Routes - WNFS-based content-addressed storage
 */

import { Router } from 'express';
import type { Clout } from '../../clout.js';

export function createMediaRoutes(getClout: () => Clout | undefined, isInitialized: () => boolean): Router {
  const router = Router();

  // Upload Media - returns CID for later use in posts
  router.post('/upload', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const contentType = req.headers['content-type'] || 'application/octet-stream';
      const filename = req.headers['x-filename'] as string | undefined;
      const data = req.body as Buffer;

      if (!data || data.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No file data received'
        });
      }

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

  // Get Media by CID
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
