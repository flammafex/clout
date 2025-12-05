/**
 * Trust Routes - Trust operations, reputation, tags, nicknames
 */

import { Router } from 'express';
import type { Clout } from '../../clout.js';

export function createTrustRoutes(getClout: () => Clout | undefined, isInitialized: () => boolean): Router {
  const router = Router();

  // Trust User
  router.post('/trust', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const { publicKey } = req.body;
      await getClout()!.trust(publicKey);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get list of directly trusted users
  router.get('/trusted', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const profile = clout.getProfile();
      const myKey = profile.publicKey;
      const trustedKeys = Array.from(profile.trustGraph).filter(k => k !== myKey);

      const trustedUsers = trustedKeys.map(publicKey => {
        const reputation = clout.getReputation(publicKey);
        const tags = clout.getTagsForUser(publicKey);
        const nickname = clout.getNickname(publicKey);
        return {
          publicKey,
          publicKeyShort: publicKey.slice(0, 12),
          displayName: nickname || publicKey.slice(0, 12) + '...',
          nickname,
          reputation,
          tags,
          distance: 1
        };
      });

      res.json({
        success: true,
        data: {
          count: trustedUsers.length,
          users: trustedUsers
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

      const publicKey = req.params.publicKey;
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

      const publicKey = req.params.publicKey;
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

      const { publicKey, tag } = req.body;
      if (!publicKey || !tag) {
        return res.status(400).json({
          success: false,
          error: 'publicKey and tag are required'
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

      const { publicKey, tag } = req.body;
      if (!publicKey || !tag) {
        return res.status(400).json({
          success: false,
          error: 'publicKey and tag are required'
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

      const publicKey = req.params.publicKey;
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

      const { publicKey, nickname } = req.body;
      if (!publicKey) {
        return res.status(400).json({
          success: false,
          error: 'publicKey is required'
        });
      }

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

      const publicKey = req.params.publicKey;
      getClout()!.setNickname(publicKey, '');

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}
