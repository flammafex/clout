/**
 * Admin Routes - Instance owner administration and member invitation management
 *
 * Owner Routes (require signed challenge):
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
 *
 * Security: Admin operations require cryptographic proof of ownership via signature.
 * The browser must sign a challenge payload to prove they control the private key.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Clout } from '../../clout.js';
import { Crypto } from '../../crypto.js';
import { createFreebirdAdminFromEnv, type FreebirdAdmin } from '../../integrations/freebird-admin.js';
import type { FileSystemStore, MemberQuotaEntry, CreatedInvitation } from '../../store/file-store.js';
import { validatePublicKey, validateSignature, getBrowserUserPublicKey, getErrorMessage } from './validation.js';

// Signature timestamp must be within this window (prevents replay attacks)
const SIGNATURE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export interface AdminRoutesConfig {
  getClout: () => Clout | undefined;
  isInitialized: () => boolean;
  getStore: () => FileSystemStore | undefined;
  getOwnerPublicKey: () => string | undefined;
  findBootstrapInvitationByRedeemer?: (publicKey: string) => { code: string; redeemedAt: number } | null;
}

/**
 * Verify a signed admin operation
 *
 * For POST requests, expects:
 * - userPublicKey: The claimed public key
 * - adminSignature: Hex-encoded Ed25519 signature
 * - adminTimestamp: Unix timestamp (ms) when the signature was created
 *
 * The browser signs: "admin:{operation}:{publicKey}:{timestamp}"
 *
 * @returns The verified public key, or null if verification fails
 */
function verifyAdminSignature(
  req: Request,
  operation: string,
  ownerPublicKey: string | undefined
): { verified: boolean; publicKey?: string; error?: string } {
  const publicKey = getBrowserUserPublicKey(req);
  const signatureHex = req.body?.adminSignature || req.headers['x-admin-signature'];
  const timestampStr = req.body?.adminTimestamp || req.headers['x-admin-timestamp'];

  // Check if public key matches owner
  if (!publicKey || !ownerPublicKey) {
    return { verified: false, error: 'Missing public key or owner not configured' };
  }

  if (publicKey !== ownerPublicKey) {
    return { verified: false, error: 'Only the instance owner can perform this operation' };
  }

  // Validate signature and timestamp are present
  if (!signatureHex || typeof signatureHex !== 'string') {
    return { verified: false, error: 'Missing admin signature. Send via adminSignature body param or X-Admin-Signature header.' };
  }

  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) {
    return { verified: false, error: 'Missing or invalid timestamp. Send via adminTimestamp body param or X-Admin-Timestamp header.' };
  }

  // Check timestamp is within acceptable window (prevents replay attacks)
  const now = Date.now();
  if (Math.abs(now - timestamp) > SIGNATURE_WINDOW_MS) {
    return { verified: false, error: `Signature expired. Timestamp must be within ${SIGNATURE_WINDOW_MS / 1000}s of server time.` };
  }

  // Verify signature
  try {
    const signaturePayload = `admin:${operation}:${publicKey}:${timestamp}`;
    const payloadBytes = new TextEncoder().encode(signaturePayload);
    const signatureBytes = validateSignature(signatureHex, 'adminSignature');
    const publicKeyBytes = Crypto.fromHex(publicKey);

    if (!Crypto.verify(payloadBytes, signatureBytes, publicKeyBytes)) {
      return { verified: false, error: 'Invalid signature - request was not signed by the claimed owner' };
    }

    return { verified: true, publicKey };
  } catch (e: any) {
    return { verified: false, error: `Signature verification failed: ${e.message}` };
  }
}

/**
 * Check if the requesting browser user is the instance owner (for non-sensitive read operations)
 * This checks the browser user's public key (from request header/body), NOT the server identity
 *
 * Note: For sensitive operations (POST), use verifyAdminSignature instead.
 */
function isOwner(browserUserPublicKey: string | undefined, ownerPublicKey: string | undefined): boolean {
  if (!browserUserPublicKey || !ownerPublicKey) {
    return false;
  }
  return browserUserPublicKey === ownerPublicKey;
}

export function createAdminRoutes(config: AdminRoutesConfig): Router {
  const { getClout, isInitialized, getStore, getOwnerPublicKey, findBootstrapInvitationByRedeemer } = config;
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
  router.get('/admin/members', async (req: Request, res: Response) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const store = getStore();
      if (!store) throw new Error('Store not available');

      const clout = getClout()!;
      const browserUserKey = getBrowserUserPublicKey(req);
      const ownerKey = getOwnerPublicKey();

      // Only owner can list all members
      if (!isOwner(browserUserKey, ownerKey)) {
        return res.status(403).json({
          success: false,
          error: 'Only the instance owner can list members. Send your public key via X-User-PublicKey header.'
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
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  /**
   * Grant invitation quota to a member
   * POST /admin/quota/grant
   *
   * Flow: Clout publicKey → invitation code → Freebird invitee_id → grant quota
   * This privacy-preserving approach avoids storing a mapping between Clout and Freebird IDs.
   *
   * Requires signed challenge to prove ownership of admin key.
   */
  router.post('/admin/quota/grant', async (req: Request, res: Response) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const store = getStore();
      if (!store) throw new Error('Store not available');

      const clout = getClout()!;
      const ownerKey = getOwnerPublicKey();

      // Verify admin signature (cryptographic proof of ownership)
      const verification = verifyAdminSignature(req, 'quota/grant', ownerKey);
      if (!verification.verified) {
        return res.status(403).json({
          success: false,
          error: verification.error
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

      // Step 1: Look up which invitation code this member redeemed
      let invitationCode: string | null = null;

      // Check in createdInvitations (member invitations)
      const memberInvitation = store.getInvitationByRedeemer(memberPublicKey);
      if (memberInvitation) {
        invitationCode = memberInvitation.code;
      }

      // Check in bootstrap invitations if not found
      if (!invitationCode && findBootstrapInvitationByRedeemer) {
        const bootstrapInv = findBootstrapInvitationByRedeemer(memberPublicKey);
        if (bootstrapInv) {
          invitationCode = bootstrapInv.code;
        }
      }

      // Step 2: Look up Freebird invitee_id and grant quota
      const freebirdAdmin = getFreebirdAdmin();
      let freebirdGranted = false;

      if (freebirdAdmin && invitationCode) {
        try {
          // Look up the Freebird invitee_id from the invitation code
          const freebirdInvitation = await freebirdAdmin.getInvitationByCode(invitationCode);

          if (freebirdInvitation && freebirdInvitation.invitee_id) {
            // Grant quota using the correct Freebird user ID
            await freebirdAdmin.grantInvitationQuota(freebirdInvitation.invitee_id, amount);
            freebirdGranted = true;
            console.log(`[Admin] Granted ${amount} quota to Freebird user ${freebirdInvitation.invitee_id.slice(0, 16)}...`);
          } else {
            console.warn(`[Admin] Invitation ${invitationCode.slice(0, 8)}... not found in Freebird or not redeemed`);
          }
        } catch (e: any) {
          console.warn(`[Admin] Freebird quota grant failed: ${e.message}`);
        }
      } else if (freebirdAdmin && !invitationCode) {
        console.warn(`[Admin] Could not find invitation code for ${memberPublicKey.slice(0, 16)}... - Freebird quota not granted`);
      }

      // Step 3: Grant quota locally (always do this regardless of Freebird result)
      const entry = store.grantQuota(memberPublicKey, amount);

      res.json({
        success: true,
        data: {
          publicKey: memberPublicKey,
          publicKeyShort: memberPublicKey.slice(0, 16),
          displayName: clout.getDisplayName(memberPublicKey),
          quota: entry.quota,
          used: entry.used,
          remaining: entry.quota - entry.used,
          freebirdSynced: freebirdGranted
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  /**
   * List all invitations (owner only)
   * GET /admin/invitations
   */
  router.get('/admin/invitations', async (req: Request, res: Response) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const store = getStore();
      if (!store) throw new Error('Store not available');

      const clout = getClout()!;
      const browserUserKey = getBrowserUserPublicKey(req);
      const ownerKey = getOwnerPublicKey();

      if (!isOwner(browserUserKey, ownerKey)) {
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
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  /**
   * Create invitations (owner only - bypasses quota)
   * POST /admin/invitations
   *
   * Requires signed challenge to prove ownership of admin key.
   */
  router.post('/admin/invitations', async (req: Request, res: Response) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const store = getStore();
      if (!store) throw new Error('Store not available');

      const clout = getClout()!;
      const ownerKey = getOwnerPublicKey();

      // Verify admin signature (cryptographic proof of ownership)
      const verification = verifyAdminSignature(req, 'invitations/create', ownerKey);
      if (!verification.verified) {
        return res.status(403).json({
          success: false,
          error: verification.error
        });
      }

      const browserUserKey = verification.publicKey;

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

      // Create invitations via Freebird (use browser user's key as creator)
      const invitations = await freebirdAdmin.createInvitations(browserUserKey!, count, expiresInDays);

      // Record locally
      const now = Date.now();
      const expiresAt = now + (expiresInDays * 24 * 60 * 60 * 1000);

      for (const inv of invitations) {
        store.recordInvitation({
          code: inv.code,
          creatorPublicKey: browserUserKey!,
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
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  /**
   * Get Freebird stats (owner only)
   * GET /admin/stats
   */
  router.get('/admin/stats', async (req: Request, res: Response) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const browserUserKey = getBrowserUserPublicKey(req);
      const ownerKey = getOwnerPublicKey();

      if (!isOwner(browserUserKey, ownerKey)) {
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
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  /**
   * List all users from Freebird (owner only)
   * GET /admin/users
   */
  router.get('/admin/users', async (req: Request, res: Response) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const clout = getClout()!;
      const browserUserKey = getBrowserUserPublicKey(req);
      const ownerKey = getOwnerPublicKey();

      if (!isOwner(browserUserKey, ownerKey)) {
        return res.status(403).json({
          success: false,
          error: 'Only the instance owner can list users'
        });
      }

      const freebirdAdmin = getFreebirdAdmin();
      if (!freebirdAdmin) {
        return res.status(500).json({
          success: false,
          error: 'Freebird admin not configured'
        });
      }

      const limit = parseInt(req.query.limit as string, 10) || 100;
      const offset = parseInt(req.query.offset as string, 10) || 0;

      const users = await freebirdAdmin.listUsers(limit, offset);

      // Enrich with display names from Clout
      const enriched = users.map(user => ({
        ...user,
        displayName: clout.getDisplayName(user.user_id),
        publicKeyShort: user.user_id.slice(0, 16)
      }));

      res.json({
        success: true,
        data: {
          count: enriched.length,
          users: enriched
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  /**
   * Ban a user (owner only)
   * POST /admin/users/ban
   *
   * Requires signed challenge to prove ownership of admin key.
   */
  router.post('/admin/users/ban', async (req: Request, res: Response) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const ownerKey = getOwnerPublicKey();

      // Verify admin signature (cryptographic proof of ownership)
      const verification = verifyAdminSignature(req, 'users/ban', ownerKey);
      if (!verification.verified) {
        return res.status(403).json({
          success: false,
          error: verification.error
        });
      }

      const userPublicKey = validatePublicKey(req.body.publicKey);
      const banTree = req.body.banTree === true;

      // Prevent banning yourself
      if (userPublicKey === verification.publicKey) {
        return res.status(400).json({
          success: false,
          error: 'Cannot ban yourself'
        });
      }

      const freebirdAdmin = getFreebirdAdmin();
      if (!freebirdAdmin) {
        return res.status(500).json({
          success: false,
          error: 'Freebird admin not configured'
        });
      }

      const result = await freebirdAdmin.banUser(userPublicKey, banTree);

      res.json({
        success: true,
        data: {
          publicKey: userPublicKey,
          publicKeyShort: userPublicKey.slice(0, 16),
          bannedCount: result.banned_count,
          banTree
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  /**
   * Lookup user by public key - find which invitation they used
   * GET /admin/user-lookup?publicKey=abc123
   */
  router.get('/admin/user-lookup', async (req: Request, res: Response) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const store = getStore();
      if (!store) throw new Error('Store not available');

      const clout = getClout()!;
      const browserUserKey = getBrowserUserPublicKey(req);
      const ownerKey = getOwnerPublicKey();

      if (!isOwner(browserUserKey, ownerKey)) {
        return res.status(403).json({
          success: false,
          error: 'Only the instance owner can lookup users'
        });
      }

      const publicKey = req.query.publicKey as string;
      if (!publicKey) {
        return res.status(400).json({
          success: false,
          error: 'publicKey query parameter is required'
        });
      }

      // Look up in FileStore (createdInvitations)
      const invitation = store.getInvitationByRedeemer(publicKey);

      if (invitation) {
        return res.json({
          success: true,
          data: {
            publicKey,
            publicKeyShort: publicKey.slice(0, 16),
            displayName: clout.getDisplayName(publicKey),
            invitationCode: invitation.code,
            invitedBy: invitation.creatorPublicKey,
            invitedByShort: invitation.creatorPublicKey.slice(0, 16),
            invitedByName: clout.getDisplayName(invitation.creatorPublicKey),
            redeemedAt: invitation.redeemedAt,
            source: 'member_invitation'
          }
        });
      }

      // Check if this is a bootstrap invitation user (stored in invitations.json)
      if (findBootstrapInvitationByRedeemer) {
        const bootstrapInv = findBootstrapInvitationByRedeemer(publicKey);
        if (bootstrapInv) {
          return res.json({
            success: true,
            data: {
              publicKey,
              publicKeyShort: publicKey.slice(0, 16),
              displayName: clout.getDisplayName(publicKey),
              invitationCode: bootstrapInv.code,
              invitedBy: ownerKey || 'instance_owner',
              invitedByShort: ownerKey?.slice(0, 16) || 'owner',
              invitedByName: 'Instance Owner (bootstrap)',
              redeemedAt: bootstrapInv.redeemedAt,
              source: 'bootstrap_invitation'
            }
          });
        }
      }

      // Not found
      return res.json({
        success: true,
        data: {
          publicKey,
          publicKeyShort: publicKey.slice(0, 16),
          displayName: clout.getDisplayName(publicKey),
          invitationCode: null,
          message: 'User not found - may have joined before tracking was enabled, or is not a member'
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // =========================================================================
  // MEMBER ROUTES - For users with quota
  // These routes require a browser user's public key to identify who is making the request
  // =========================================================================

  /**
   * Get my quota status
   * GET /invitations/quota
   */
  router.get('/invitations/quota', async (req: Request, res: Response) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const store = getStore();
      if (!store) throw new Error('Store not available');

      const browserUserKey = getBrowserUserPublicKey(req);
      if (!browserUserKey) {
        return res.status(400).json({
          success: false,
          error: 'Missing browser user public key. Send via X-User-PublicKey header.'
        });
      }

      const stats = store.getInvitationStats(browserUserKey);

      res.json({
        success: true,
        data: {
          publicKey: browserUserKey,
          ...stats
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  /**
   * List invitations I've created
   * GET /invitations/mine
   */
  router.get('/invitations/mine', async (req: Request, res: Response) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const store = getStore();
      if (!store) throw new Error('Store not available');

      const clout = getClout()!;
      const browserUserKey = getBrowserUserPublicKey(req);
      if (!browserUserKey) {
        return res.status(400).json({
          success: false,
          error: 'Missing browser user public key. Send via X-User-PublicKey header.'
        });
      }

      const invitations = store.getInvitationsByCreator(browserUserKey);

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
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  /**
   * Create invitation using my quota
   * POST /invitations/create
   */
  router.post('/invitations/create', async (req: Request, res: Response) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const store = getStore();
      if (!store) throw new Error('Store not available');

      const browserUserKey = getBrowserUserPublicKey(req);
      if (!browserUserKey) {
        return res.status(400).json({
          success: false,
          error: 'Missing browser user public key. Send via X-User-PublicKey header or userPublicKey body param.'
        });
      }
      const ownerKey = getOwnerPublicKey();

      // Check if user has quota
      const remaining = store.getRemainingQuota(browserUserKey);

      // Owner can always create invitations (bypass quota)
      const bypassQuota = isOwner(browserUserKey, ownerKey);

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
      const invitations = await freebirdAdmin.createInvitations(browserUserKey, 1, expiresInDays);

      if (invitations.length === 0) {
        return res.status(500).json({
          success: false,
          error: 'Failed to create invitation'
        });
      }

      const invitation = invitations[0];

      // Use quota (unless owner bypassing)
      if (!bypassQuota) {
        store.useQuota(browserUserKey, 1);
      }

      // Record invitation
      const now = Date.now();
      const expiresAt = now + (expiresInDays * 24 * 60 * 60 * 1000);

      store.recordInvitation({
        code: invitation.code,
        creatorPublicKey: browserUserKey,
        createdAt: now,
        expiresAt,
        redeemed: false
      });

      res.json({
        success: true,
        data: {
          code: invitation.code,
          creatorPublicKey: browserUserKey,
          createdAt: now,
          expiresAt,
          quotaRemaining: bypassQuota ? 'unlimited' : store.getRemainingQuota(browserUserKey)
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  return router;
}
