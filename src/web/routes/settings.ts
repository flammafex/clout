/**
 * Settings Routes - Trust settings, NSFW filtering, content filters
 */

import { Router } from 'express';
import type { Clout } from '../../clout.js';

export function createSettingsRoutes(getClout: () => Clout | undefined, isInitialized: () => boolean): Router {
  const router = Router();

  // Get current settings
  router.get('/', (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const profile = clout.getProfile();

      // Check if admin features are available
      const adminKey = process.env.FREEBIRD_ADMIN_KEY;
      const issuerUrl = process.env.FREEBIRD_ISSUER_URL || 'http://localhost:8081';
      const ownerPubkey = process.env.INSTANCE_OWNER_PUBKEY;
      const isAdmin = !!adminKey;

      res.json({
        success: true,
        data: {
          trustSettings: profile.trustSettings,
          nsfwEnabled: clout.isNsfwEnabled(),
          admin: isAdmin ? {
            enabled: true,
            freebirdUrl: `${issuerUrl}/admin`,
            sybilMode: process.env.FREEBIRD_SYBIL_MODE || 'invitation',
            ownerPubkey: ownerPubkey || null
          } : null
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Update trust settings
  router.post('/', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const settings = req.body;
      await clout.updateTrustSettings(settings);

      const profile = clout.getProfile();
      res.json({
        success: true,
        data: { trustSettings: profile.trustSettings }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Toggle NSFW content display
  router.post('/nsfw', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const { enabled } = req.body;
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'enabled must be a boolean'
        });
      }

      await clout.setNsfwEnabled(enabled);
      res.json({
        success: true,
        data: { nsfwEnabled: clout.isNsfwEnabled() }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Set content-type filter
  router.post('/content-filter', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const { contentType, maxHops, minReputation } = req.body;
      if (!contentType) {
        return res.status(400).json({
          success: false,
          error: 'contentType is required'
        });
      }

      await clout.setContentTypeFilter(contentType, {
        maxHops: maxHops ?? 3,
        minReputation: minReputation ?? 0.3
      });

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // =========================================================================
  // DAY PASS DELEGATION
  // =========================================================================

  // Get delegation status (eligibility and pending delegations)
  router.get('/daypass/delegation', (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const reputation = clout.getReputation(clout.getProfile().publicKey);
      const canDelegate = reputation.score >= 0.7;
      const hasPending = clout.hasPendingDelegation();

      res.json({
        success: true,
        data: {
          canDelegate,
          reputation: reputation.score,
          requiredReputation: 0.7,
          hasPendingDelegation: hasPending
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Delegate a Day Pass to someone
  router.post('/daypass/delegate', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const { recipientKey, durationHours } = req.body;
      if (!recipientKey || typeof recipientKey !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'recipientKey is required'
        });
      }

      const duration = typeof durationHours === 'number' ? durationHours : 24;
      await clout.delegatePass(recipientKey, duration);

      res.json({
        success: true,
        data: {
          recipientKey,
          durationHours: duration,
          message: `Delegated ${duration}h Day Pass to ${recipientKey.slice(0, 8)}...`
        }
      });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Accept a pending delegation
  router.post('/daypass/accept', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      await clout.acceptDelegatedPass();

      res.json({
        success: true,
        data: { message: 'Accepted delegated Day Pass' }
      });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  return router;
}
