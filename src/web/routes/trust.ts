/**
 * Trust Routes - Trust operations, reputation, tags, nicknames
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Clout } from '../../clout.js';
import { validatePublicKey, validateWeight, getErrorMessage } from './validation.js';

export function createTrustRoutes(getClout: () => Clout | undefined, isInitialized: () => boolean): Router {
  const router = Router();

  // Trust User
  router.post('/trust', async (req: Request, res: Response) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const publicKey = validatePublicKey(req.body.publicKey);
      const weight = validateWeight(req.body.weight);
      await getClout()!.trust(publicKey, weight);
      res.json({ success: true, data: { publicKey, weight } });
    } catch (error) {
      res.status(400).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // Revoke trust (untrust/unfollow)
  router.delete('/trust/:publicKey', async (req: Request, res: Response) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const publicKey = validatePublicKey(req.params.publicKey);
      await getClout()!.revokeTrust(publicKey);
      res.json({ success: true, data: { publicKey, revoked: true } });
    } catch (error) {
      res.status(400).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // Get list of directly trusted users
  // Philosophical stance: you should trust yourself above all, so self is included at the top
  router.get('/trusted', async (_req: Request, res: Response) => {
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
        tags: [] as string[],
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
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // Get reputation for a specific user
  router.get('/reputation/:publicKey', (req: Request, res: Response) => {
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
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // =========================================================================
  // TAGS
  // =========================================================================

  // Get all tags with member counts
  router.get('/tags', (_req: Request, res: Response) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const tags = getClout()!.getAllTags();
      const tagsArray = Array.from(tags.entries()).map(([tag, count]) => ({
        tag,
        count
      }));

      res.json({ success: true, data: { tags: tagsArray } });
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // Get users with a specific tag
  router.get('/tags/:tag/users', (req: Request, res: Response) => {
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
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // Get tags for a specific user
  router.get('/tags/user/:publicKey', (req: Request, res: Response) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const publicKey = validatePublicKey(req.params.publicKey);
      const tags = getClout()!.getTagsForUser(publicKey);

      res.json({ success: true, data: { publicKey, tags } });
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // Add tag to user
  router.post('/tags', (req: Request, res: Response) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const publicKey = validatePublicKey(req.body.publicKey);
      const { tag } = req.body;
      if (!tag) {
        res.status(400).json({
          success: false,
          error: 'tag is required'
        });
        return;
      }

      getClout()!.addTrustTag(publicKey, tag);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // Remove tag from user
  router.delete('/tags', (req: Request, res: Response) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const publicKey = validatePublicKey(req.body.publicKey);
      const { tag } = req.body;
      if (!tag) {
        res.status(400).json({
          success: false,
          error: 'tag is required'
        });
        return;
      }

      getClout()!.removeTrustTag(publicKey, tag);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // =========================================================================
  // NICKNAMES
  // =========================================================================

  // Get all nicknames
  router.get('/nicknames', (_req: Request, res: Response) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const nicknames = getClout()!.getAllNicknames();
      const nicknamesArray = Array.from(nicknames.entries()).map(([publicKey, nickname]) => ({
        publicKey,
        publicKeyShort: publicKey.slice(0, 12),
        nickname
      }));

      res.json({ success: true, data: { nicknames: nicknamesArray } });
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // Get nickname for a specific user
  router.get('/nickname/:publicKey', (req: Request, res: Response) => {
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
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // Set nickname for a user
  router.post('/nickname', (req: Request, res: Response) => {
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
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // Delete nickname for a user
  router.delete('/nickname/:publicKey', (req: Request, res: Response) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');

      const publicKey = validatePublicKey(req.params.publicKey);
      getClout()!.setNickname(publicKey, '');

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // =========================================================================
  // MUTED USERS
  // =========================================================================

  // Get all muted users
  router.get('/muted', (_req: Request, res: Response) => {
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
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // Check if a user is muted
  router.get('/muted/:publicKey', (req: Request, res: Response) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const publicKey = validatePublicKey(req.params.publicKey);
      const isMuted = clout.isMuted(publicKey);

      res.json({
        success: true,
        data: { publicKey, isMuted }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // Mute a user
  router.post('/mute', (req: Request, res: Response) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const publicKey = validatePublicKey(req.body.publicKey);

      clout.mute(publicKey);
      res.json({
        success: true,
        data: { publicKey, isMuted: true }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // Unmute a user
  router.post('/unmute', (req: Request, res: Response) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const publicKey = validatePublicKey(req.body.publicKey);

      clout.unmute(publicKey);
      res.json({
        success: true,
        data: { publicKey, isMuted: false }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // =========================================================================
  // TRUST REQUESTS (Consent-based trust)
  // =========================================================================

  // Send a trust request
  router.post('/trust-request', async (req: Request, res: Response) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const recipient = validatePublicKey(req.body.publicKey, 'publicKey');
      const weight = validateWeight(req.body.weight);
      const message = req.body.message || null;

      // Create and send trust request
      const request = await clout.sendTrustRequest(recipient, weight, message);

      res.json({
        success: true,
        data: request
      });
    } catch (error) {
      res.status(400).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // Get incoming trust requests
  router.get('/trust-requests/incoming', async (req: Request, res: Response) => {
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
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // Get outgoing trust requests
  router.get('/trust-requests/outgoing', async (_req: Request, res: Response) => {
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
    } catch (error) {
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // Accept a trust request
  router.post('/trust-request/:id/accept', async (req: Request, res: Response) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const requestId = req.params.id;
      const result = await clout.acceptTrustRequest(requestId);

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      res.status(400).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // Reject a trust request (silently - requester sees pending/ghosted)
  router.post('/trust-request/:id/reject', async (req: Request, res: Response) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const requestId = req.params.id;
      await clout.rejectTrustRequest(requestId);

      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // Withdraw an outgoing trust request
  router.delete('/trust-request/:id', async (req: Request, res: Response) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const requestId = req.params.id;
      await clout.withdrawTrustRequest(requestId);

      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // Retry a ghosted trust request
  router.post('/trust-request/:id/retry', async (req: Request, res: Response) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const requestId = req.params.id;
      const result = await clout.retryTrustRequest(requestId);

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      res.status(400).json({ success: false, error: getErrorMessage(error) });
    }
  });

  return router;
}
