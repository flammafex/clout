/**
 * Slides Routes - Encrypted Direct Messages
 */

import { Router } from 'express';
import type { Clout } from '../../clout.js';

export function createSlidesRoutes(getClout: () => Clout | undefined, isInitialized: () => boolean): Router {
  const router = Router();

  // Get Slides (Inbox)
  router.get('/', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const inbox = await clout.getInbox();
      const limit = parseInt(req.query.limit as string) || 50;

      res.json({
        success: true,
        data: {
          slides: inbox.slides.map(slide => {
            let content = '[Encrypted]';
            try {
              content = clout.decryptSlide(slide);
            } catch (e) {}

            return {
              ...slide,
              senderShort: slide.sender.slice(0, 8),
              senderDisplayName: clout.getDisplayName(slide.sender),
              senderNickname: clout.getNickname(slide.sender),
              decryptedContent: content
            };
          }).slice(0, limit),
          totalSlides: inbox.slides.length
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Send Slide
  router.post('/', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const { recipient, message } = req.body;

      const slide = await getClout()!.slide(recipient, message);
      res.json({ success: true, data: slide });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}
