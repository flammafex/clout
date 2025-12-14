/**
 * Trust Routes - Trust operations, reputation, tags, nicknames
 */

import { Router } from 'express';
import type { Clout } from '../../clout.js';
import { Crypto } from '../../crypto.js';

/**
 * Validate a public key from request (body or params)
 * Returns the validated key or throws with a descriptive error
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

export function createTrustRoutes(getClout: () => Clout | undefined, isInitialized: () => boolean): Router {
  const router = Router();

  // Trust User
  router.post('/trust', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const publicKey = validatePublicKey(req.body.publicKey);
      // Weight is optional, defaults to 1.0 (full trust)
      const weight = typeof req.body.weight === 'number'
        ? Math.max(0.1, Math.min(1.0, req.body.weight))
        : 1.0;
      await getClout()!.trust(publicKey, weight);
      res.json({ success: true, data: { publicKey, weight } });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Revoke trust (untrust/unfollow)
  router.delete('/trust/:publicKey', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const publicKey = validatePublicKey(req.params.publicKey);
      await getClout()!.revokeTrust(publicKey);
      res.json({ success: true, data: { publicKey, revoked: true } });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Get list of directly trusted users
  // Philosophical stance: you should trust yourself above all, so self is included at the top
  router.get('/trusted', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const profile = clout.getProfile();
      const myKey = profile.publicKey;

      // Self entry - you trust yourself above all
      const selfEntry = {
        publicKey: myKey,
        publicKeyShort: myKey.slice(0, 12),
        displayName: profile.metadata?.displayName || 'You',
        nickname: null,
        reputation: { score: 1.0, distance: 0, visible: true },
        tags: [],
        isMuted: false,
        distance: 0,
        isSelf: true,
        weight: 1.0  // Self always has full trust
      };

      const trustedKeys = Array.from(profile.trustGraph).filter(k => k !== myKey);
      const trustedUsers = trustedKeys.map(publicKey => {
        const reputation = clout.getReputation(publicKey);
        const tags = clout.getTagsForUser(publicKey);
        const nickname = clout.getNickname(publicKey);
        const isMuted = clout.isMuted(publicKey);
        const weight = clout.getTrustWeight(publicKey) ?? 1.0;
        return {
          publicKey,
          publicKeyShort: publicKey.slice(0, 12),
          displayName: clout.getDisplayName(publicKey),
          nickname,
          reputation,
          tags,
          isMuted,
          distance: 1,
          isSelf: false,
          weight
        };
      });

      // Self at top, then trusted users
      const allUsers = [selfEntry, ...trustedUsers];

      res.json({
        success: true,
        data: {
          count: allUsers.length,
          users: allUsers
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get reputation for a specific user
  router.get('/reputation/:publicKey', (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const publicKey = validatePublicKey(req.params.publicKey);
      const reputation = clout.getReputation(publicKey);

      res.json({
        success: true,
        data: {
          publicKey,
          publicKeyShort: publicKey.slice(0, 8),
          ...reputation
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // =========================================================================
  // TAGS
  // =========================================================================

  // Get all tags with member counts
  router.get('/tags', (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const tags = getClout()!.getAllTags();
      const tagsArray = Array.from(tags.entries()).map(([tag, count]) => ({
        tag,
        count
      }));

      res.json({ success: true, data: { tags: tagsArray } });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get users with a specific tag
  router.get('/tags/:tag/users', (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const tag = req.params.tag;
      const users = getClout()!.getUsersByTag(tag);

      res.json({
        success: true,
        data: {
          tag,
          users: users.map(u => ({ publicKey: u, short: u.slice(0, 8) }))
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get tags for a specific user
  router.get('/tags/user/:publicKey', (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const publicKey = validatePublicKey(req.params.publicKey);
      const tags = getClout()!.getTagsForUser(publicKey);

      res.json({ success: true, data: { publicKey, tags } });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Add tag to user
  router.post('/tags', (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const publicKey = validatePublicKey(req.body.publicKey);
      const { tag } = req.body;
      if (!tag) {
        return res.status(400).json({
          success: false,
          error: 'tag is required'
        });
      }

      getClout()!.addTrustTag(publicKey, tag);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Remove tag from user
  router.delete('/tags', (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const publicKey = validatePublicKey(req.body.publicKey);
      const { tag } = req.body;
      if (!tag) {
        return res.status(400).json({
          success: false,
          error: 'tag is required'
        });
      }

      getClout()!.removeTrustTag(publicKey, tag);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // =========================================================================
  // NICKNAMES
  // =========================================================================

  // Get all nicknames
  router.get('/nicknames', (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const nicknames = getClout()!.getAllNicknames();
      const nicknamesArray = Array.from(nicknames.entries()).map(([publicKey, nickname]) => ({
        publicKey,
        publicKeyShort: publicKey.slice(0, 12),
        nickname
      }));

      res.json({ success: true, data: { nicknames: nicknamesArray } });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get nickname for a specific user
  router.get('/nickname/:publicKey', (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const publicKey = validatePublicKey(req.params.publicKey);
      const nickname = clout.getNickname(publicKey);
      const displayName = clout.getDisplayName(publicKey);

      res.json({
        success: true,
        data: { publicKey, nickname, displayName }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Set nickname for a user
  router.post('/nickname', (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const publicKey = validatePublicKey(req.body.publicKey);
      const { nickname } = req.body;

      clout.setNickname(publicKey, nickname || '');
      const displayName = clout.getDisplayName(publicKey);

      res.json({
        success: true,
        data: { publicKey, nickname: nickname || null, displayName }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Delete nickname for a user
  router.delete('/nickname/:publicKey', (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const publicKey = validatePublicKey(req.params.publicKey);
      getClout()!.setNickname(publicKey, '');

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // =========================================================================
  // MUTED USERS
  // =========================================================================

  // Get all muted users
  router.get('/muted', (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const mutedKeys = clout.getMutedUsers();
      const mutedUsers = mutedKeys.map(publicKey => ({
        publicKey,
        publicKeyShort: publicKey.slice(0, 12),
        displayName: clout.getDisplayName(publicKey),
        nickname: clout.getNickname(publicKey)
      }));

      res.json({
        success: true,
        data: {
          count: mutedUsers.length,
          users: mutedUsers
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Check if a user is muted
  router.get('/muted/:publicKey', (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const publicKey = validatePublicKey(req.params.publicKey);
      const isMuted = clout.isMuted(publicKey);

      res.json({
        success: true,
        data: { publicKey, isMuted }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Mute a user
  router.post('/mute', (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const publicKey = validatePublicKey(req.body.publicKey);

      clout.mute(publicKey);
      res.json({
        success: true,
        data: { publicKey, isMuted: true }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Unmute a user
  router.post('/unmute', (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const publicKey = validatePublicKey(req.body.publicKey);

      clout.unmute(publicKey);
      res.json({
        success: true,
        data: { publicKey, isMuted: false }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // =========================================================================
  // TRUST REQUESTS (Consent-based trust)
  // =========================================================================

  // Send a trust request
  router.post('/trust-request', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const recipient = validatePublicKey(req.body.publicKey, 'publicKey');
      const weight = typeof req.body.weight === 'number'
        ? Math.max(0.1, Math.min(1.0, req.body.weight))
        : 1.0;
      const message = req.body.message || null;

      // Create and send trust request
      const request = await clout.sendTrustRequest(recipient, weight, message);

      res.json({
        success: true,
        data: request
      });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Get incoming trust requests
  router.get('/trust-requests/incoming', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const includeAll = req.query.all === 'true';
      const requests = await clout.getIncomingTrustRequests(includeAll);

      // Enrich with display names
      const enrichedRequests = requests.map(r => ({
        ...r,
        requesterDisplayName: clout.getDisplayName(r.requester),
        requesterShort: r.requester.slice(0, 12)
      }));

      res.json({
        success: true,
        data: {
          count: enrichedRequests.length,
          requests: enrichedRequests
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get outgoing trust requests
  router.get('/trust-requests/outgoing', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const requests = await clout.getOutgoingTrustRequests();

      // Enrich with display names
      const enrichedRequests = requests.map(r => ({
        ...r,
        recipientDisplayName: clout.getDisplayName(r.recipient),
        recipientShort: r.recipient.slice(0, 12)
      }));

      res.json({
        success: true,
        data: {
          count: enrichedRequests.length,
          requests: enrichedRequests
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Accept a trust request
  router.post('/trust-request/:id/accept', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const requestId = req.params.id;
      const result = await clout.acceptTrustRequest(requestId);

      res.json({
        success: true,
        data: result
      });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Reject a trust request (silently - requester sees pending/ghosted)
  router.post('/trust-request/:id/reject', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const requestId = req.params.id;
      await clout.rejectTrustRequest(requestId);

      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Withdraw an outgoing trust request
  router.delete('/trust-request/:id', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const requestId = req.params.id;
      await clout.withdrawTrustRequest(requestId);

      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Retry a ghosted trust request
  router.post('/trust-request/:id/retry', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const requestId = req.params.id;
      const result = await clout.retryTrustRequest(requestId);

      res.json({
        success: true,
        data: result
      });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  return router;
}
