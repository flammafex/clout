/**
 * Invitation Routes - Decode and redeem invitation codes
 *
 * Extracted from CloutWebServer as part of Tier 3 Phase 4.
 * All state transitions are delegated to InvitationRedemption.
 */

import { Router, type Request, type Response } from 'express';
import { Crypto } from '../../crypto.js';
import type { InvitationRedemption, InvitationError } from '../invitation-redemption.js';

export interface InvitationRoutesConfig {
  readonly invitationRedemption: InvitationRedemption;
}

export function createInvitationRoutes(config: InvitationRoutesConfig): Router {
  const router = Router();

  // Decode an invitation code to get inviter info
  // This is called before redemption so the browser can create a trust signal
  router.post('/invitation/decode', (req: Request, res: Response) => {
    try {
      const { code } = req.body;

      if (!code) {
        return res.status(400).json({
          success: false,
          error: 'Invitation code is required'
        });
      }

      const result = config.invitationRedemption.decode(code);

      res.json({
        success: true,
        data: result
      });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Redeem an invitation code
  router.post('/invitation/redeem', async (req: Request, res: Response) => {
    try {
      const { code, publicKey } = req.body;

      if (!code) {
        return res.status(400).json({
          success: false,
          error: 'Invitation code is required'
        });
      }

      if (!publicKey || typeof publicKey !== 'string' || !Crypto.isValidPublicKeyHex(publicKey)) {
        return res.status(400).json({
          success: false,
          error: 'Valid publicKey is required'
        });
      }

      const result = await config.invitationRedemption.reserve(code, publicKey);

      res.json({
        success: true,
        data: result
      });
    } catch (error: any) {
      // InvitationError carries an HTTP status code hint
      if (error.name === 'InvitationError') {
        const statusCode = (error as any).statusCode || 400;
        return res.status(statusCode).json({ success: false, error: error.message });
      }
      res.status(400).json({ success: false, error: error.message });
    }
  });

  return router;
}
