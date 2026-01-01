/**
 * Slides Routes - Encrypted Direct Messages
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Clout } from '../../clout.js';
import { validatePublicKey, getErrorMessage } from './validation.js';

export function createSlidesRoutes(getClout: () => Clout | undefined, isInitialized: () => boolean): Router {
  const router = Router();

  // Get Slides (Inbox)
  router.get('/', async (req: Request, res: Response) => {
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
            } catch (decryptError) {
              // Slide may be encrypted for a different recipient or corrupted
              console.warn('[Slides] Failed to decrypt slide:', getErrorMessage(decryptError));
            }

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
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // Send Slide
  router.post('/', async (req: Request, res: Response) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const recipient = validatePublicKey(req.body.recipient, 'recipient');
      const { message } = req.body;

      if (!message || typeof message !== 'string') {
        res.status(400).json({ success: false, error: 'message is required' });
        return;
      }

      const slide = await getClout()!.slide(recipient, message);
      res.json({ success: true, data: slide });
    } catch (error) {
      res.status(400).json({ success: false, error: getErrorMessage(error) });
    }
  });

  return router;
}
