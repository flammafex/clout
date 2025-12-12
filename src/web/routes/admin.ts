/**
 * Admin Routes - Instance owner administration and member invitation management
 *
 * Owner Routes (require admin key):
 * - GET  /admin/members       - List all members with quota
 * - POST /admin/quota/grant   - Grant invitation quota to a member
 * - GET  /admin/invitations   - List all invitations
 * - POST /admin/invitations   - Create invitations (as owner)
 * - GET  /admin/stats         - Get Freebird stats
 *
 * Member Routes (for users with quota):
 * - GET  /invitations/quota   - Get my quota status
 * - GET  /invitations/mine    - List invitations I've created
 * - POST /invitations/create  - Create invitation using my quota
 */

import { Router } from 'express';
import type { Clout } from '../../clout.js';
import { Crypto } from '../../crypto.js';
import { createFreebirdAdminFromEnv, type FreebirdAdmin } from '../../integrations/freebird-admin.js';
import type { FileSystemStore, MemberQuotaEntry, CreatedInvitation } from '../../store/file-store.js';

export interface AdminRoutesConfig {
  getClout: () => Clout | undefined;
  isInitialized: () => boolean;
  getStore: () => FileSystemStore | undefined;
  getOwnerPublicKey: () => string | undefined;
}

/**
 * Check if the requesting user is the instance owner
 */
function isOwner(requestPublicKey: string, ownerPublicKey: string | undefined): boolean {
  return ownerPublicKey !== undefined && requestPublicKey === ownerPublicKey;
}

/**
 * Validate a public key
 */
function validatePublicKey(publicKey: unknown, fieldName = 'publicKey'): string {
  if (!publicKey || typeof publicKey !== 'string') {
    throw new Error(`${fieldName} is required`);
  }
  if (!Crypto.isValidPublicKeyHex(publicKey)) {
    throw new Error(`Invalid ${fieldName}: must be 64 hex characters (32 bytes)`);
  }
  return publicKey;
}

export function createAdminRoutes(config: AdminRoutesConfig): Router {
  const { getClout, isInitialized, getStore, getOwnerPublicKey } = config;
  const router = Router();

  // Get or create Freebird admin client
  const getFreebirdAdmin = (): FreebirdAdmin | null => {
    return createFreebirdAdminFromEnv();
  };

  // =========================================================================
  // OWNER ROUTES - Require admin key
  // =========================================================================

  /**
   * List all members with quota
   * GET /admin/members
   */
  router.get('/admin/members', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const store = getStore();
      if (!store) throw new Error('Store not available');

      const clout = getClout()!;
      const myKey = clout.getProfile().publicKey;
      const ownerKey = getOwnerPublicKey();

      // Only owner can list all members
      if (!isOwner(myKey, ownerKey)) {
        return res.status(403).json({
          success: false,
          error: 'Only the instance owner can list members'
        });
      }

      const quotas = store.getAllMemberQuotas();

      // Enrich with display names
      const members = quotas.map(q => ({
        ...q,
        displayName: clout.getDisplayName(q.publicKey),
        publicKeyShort: q.publicKey.slice(0, 16),
        remaining: q.quota - q.used
      }));

      res.json({
        success: true,
        data: {
          count: members.length,
          members
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * Grant invitation quota to a member
   * POST /admin/quota/grant
   */
  router.post('/admin/quota/grant', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const store = getStore();
      if (!store) throw new Error('Store not available');

      const clout = getClout()!;
      const myKey = clout.getProfile().publicKey;
      const ownerKey = getOwnerPublicKey();

      // Only owner can grant quota
      if (!isOwner(myKey, ownerKey)) {
        return res.status(403).json({
          success: false,
          error: 'Only the instance owner can grant quota'
        });
      }

      const memberPublicKey = validatePublicKey(req.body.publicKey);
      const amount = parseInt(req.body.amount, 10);

      if (isNaN(amount) || amount < 1 || amount > 100) {
        return res.status(400).json({
          success: false,
          error: 'amount must be between 1 and 100'
        });
      }

      // Also grant quota in Freebird if admin key available
      const freebirdAdmin = getFreebirdAdmin();
      if (freebirdAdmin) {
        try {
          await freebirdAdmin.grantInvitationQuota(memberPublicKey, amount);
        } catch (e: any) {
          console.warn(`[Admin] Freebird quota grant failed: ${e.message}`);
          // Continue anyway - local quota tracking is the source of truth
        }
      }

      // Grant quota locally
      const entry = store.grantQuota(memberPublicKey, amount);

      res.json({
        success: true,
        data: {
          publicKey: memberPublicKey,
          publicKeyShort: memberPublicKey.slice(0, 16),
          quota: entry.quota,
          used: entry.used,
          remaining: entry.quota - entry.used
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * List all invitations (owner only)
   * GET /admin/invitations
   */
  router.get('/admin/invitations', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const store = getStore();
      if (!store) throw new Error('Store not available');

      const clout = getClout()!;
      const myKey = clout.getProfile().publicKey;
      const ownerKey = getOwnerPublicKey();

      if (!isOwner(myKey, ownerKey)) {
        return res.status(403).json({
          success: false,
          error: 'Only the instance owner can list all invitations'
        });
      }

      const invitations = store.getAllInvitations();

      // Enrich with creator names
      const enriched = invitations.map(inv => ({
        ...inv,
        creatorDisplayName: clout.getDisplayName(inv.creatorPublicKey),
        creatorShort: inv.creatorPublicKey.slice(0, 16),
        redeemerDisplayName: inv.redeemedBy ? clout.getDisplayName(inv.redeemedBy) : null,
        redeemerShort: inv.redeemedBy?.slice(0, 16) || null,
        isExpired: Date.now() > inv.expiresAt
      }));

      res.json({
        success: true,
        data: {
          count: enriched.length,
          invitations: enriched
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * Create invitations (owner only - bypasses quota)
   * POST /admin/invitations
   */
  router.post('/admin/invitations', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const store = getStore();
      if (!store) throw new Error('Store not available');

      const clout = getClout()!;
      const myKey = clout.getProfile().publicKey;
      const ownerKey = getOwnerPublicKey();

      if (!isOwner(myKey, ownerKey)) {
        return res.status(403).json({
          success: false,
          error: 'Only the instance owner can create admin invitations'
        });
      }

      const count = parseInt(req.body.count, 10) || 1;
      const expiresInDays = parseInt(req.body.expiresInDays, 10) || 30;

      if (count < 1 || count > 100) {
        return res.status(400).json({
          success: false,
          error: 'count must be between 1 and 100'
        });
      }

      const freebirdAdmin = getFreebirdAdmin();
      if (!freebirdAdmin) {
        return res.status(500).json({
          success: false,
          error: 'Freebird admin not configured (missing FREEBIRD_ADMIN_KEY)'
        });
      }

      // Create invitations via Freebird
      const invitations = await freebirdAdmin.createInvitations(myKey, count, expiresInDays);

      // Record locally
      const now = Date.now();
      const expiresAt = now + (expiresInDays * 24 * 60 * 60 * 1000);

      for (const inv of invitations) {
        store.recordInvitation({
          code: inv.code,
          creatorPublicKey: myKey,
          createdAt: now,
          expiresAt,
          redeemed: false
        });
      }

      res.json({
        success: true,
        data: {
          count: invitations.length,
          codes: invitations.map(i => i.code),
          expiresAt
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * Get Freebird stats (owner only)
   * GET /admin/stats
   */
  router.get('/admin/stats', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const clout = getClout()!;
      const myKey = clout.getProfile().publicKey;
      const ownerKey = getOwnerPublicKey();

      if (!isOwner(myKey, ownerKey)) {
        return res.status(403).json({
          success: false,
          error: 'Only the instance owner can view admin stats'
        });
      }

      const freebirdAdmin = getFreebirdAdmin();
      if (!freebirdAdmin) {
        return res.status(500).json({
          success: false,
          error: 'Freebird admin not configured'
        });
      }

      const stats = await freebirdAdmin.getStats();
      const adminUiUrl = freebirdAdmin.getAdminUiUrl();

      res.json({
        success: true,
        data: {
          ...stats,
          adminUiUrl
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // =========================================================================
  // MEMBER ROUTES - For users with quota
  // =========================================================================

  /**
   * Get my quota status
   * GET /invitations/quota
   */
  router.get('/invitations/quota', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const store = getStore();
      if (!store) throw new Error('Store not available');

      const clout = getClout()!;
      const myKey = clout.getProfile().publicKey;

      const stats = store.getInvitationStats(myKey);

      res.json({
        success: true,
        data: {
          publicKey: myKey,
          ...stats
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * List invitations I've created
   * GET /invitations/mine
   */
  router.get('/invitations/mine', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const store = getStore();
      if (!store) throw new Error('Store not available');

      const clout = getClout()!;
      const myKey = clout.getProfile().publicKey;

      const invitations = store.getInvitationsByCreator(myKey);

      const enriched = invitations.map(inv => ({
        ...inv,
        redeemerDisplayName: inv.redeemedBy ? clout.getDisplayName(inv.redeemedBy) : null,
        redeemerShort: inv.redeemedBy?.slice(0, 16) || null,
        isExpired: Date.now() > inv.expiresAt
      }));

      res.json({
        success: true,
        data: {
          count: enriched.length,
          invitations: enriched
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * Create invitation using my quota
   * POST /invitations/create
   */
  router.post('/invitations/create', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const store = getStore();
      if (!store) throw new Error('Store not available');

      const clout = getClout()!;
      const myKey = clout.getProfile().publicKey;
      const ownerKey = getOwnerPublicKey();

      // Check if user has quota
      const remaining = store.getRemainingQuota(myKey);

      // Owner can always create invitations (bypass quota)
      const bypassQuota = isOwner(myKey, ownerKey);

      if (!bypassQuota && remaining < 1) {
        return res.status(403).json({
          success: false,
          error: 'No invitation quota remaining. Ask the instance owner for more quota.'
        });
      }

      const expiresInDays = parseInt(req.body.expiresInDays, 10) || 30;

      const freebirdAdmin = getFreebirdAdmin();
      if (!freebirdAdmin) {
        return res.status(500).json({
          success: false,
          error: 'Freebird admin not configured'
        });
      }

      // Create invitation via Freebird (1 at a time for members)
      const invitations = await freebirdAdmin.createInvitations(myKey, 1, expiresInDays);

      if (invitations.length === 0) {
        return res.status(500).json({
          success: false,
          error: 'Failed to create invitation'
        });
      }

      const invitation = invitations[0];

      // Use quota (unless owner bypassing)
      if (!bypassQuota) {
        store.useQuota(myKey, 1);
      }

      // Record invitation
      const now = Date.now();
      const expiresAt = now + (expiresInDays * 24 * 60 * 60 * 1000);

      store.recordInvitation({
        code: invitation.code,
        creatorPublicKey: myKey,
        createdAt: now,
        expiresAt,
        redeemed: false
      });

      res.json({
        success: true,
        data: {
          code: invitation.code,
          creatorPublicKey: myKey,
          createdAt: now,
          expiresAt,
          quotaRemaining: bypassQuota ? 'unlimited' : store.getRemainingQuota(myKey)
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}
