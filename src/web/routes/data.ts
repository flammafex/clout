/**
 * Data Routes - Profile and Identity Management
 */

import { Router } from 'express';
import type { Clout } from '../../clout.js';
import type { IdentityManager, IdentityData } from '../../cli/identity-manager.js';

export function createDataRoutes(
  getClout: () => Clout | undefined,
  isInitialized: () => boolean,
  identityManager: IdentityManager
): Router {
  const router = Router();

  // =========================================================================
  // PROFILE
  // =========================================================================

  // Get current user's profile
  router.get('/identity', (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;
      const profile = clout.getProfile();

      res.json({
        success: true,
        data: {
          publicKey: profile.publicKey,
          metadata: profile.metadata,
          trustSettings: profile.trustSettings
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Update profile metadata
  router.post('/profile', async (req, res) => {
    try {
      if (!isInitialized()) throw new Error('Not initialized');
      const clout = getClout()!;

      const { displayName, bio, avatar } = req.body;

      await clout.setProfileMetadata({
        displayName: displayName || undefined,
        bio: bio || undefined,
        avatar: avatar || undefined
      });

      const profile = clout.getProfile();

      res.json({
        success: true,
        data: {
          publicKey: profile.publicKey,
          metadata: profile.metadata
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // =========================================================================
  // IDENTITY MANAGEMENT
  // =========================================================================

  // List all identities
  router.get('/identities', (req, res) => {
    try {
      const identities = identityManager.listIdentities();
      const defaultName = identityManager.getDefaultIdentityName();

      res.json({
        success: true,
        data: {
          identities: identities.map(id => ({
            name: id.name,
            publicKey: id.publicKey,
            publicKeyShort: id.publicKey.slice(0, 12),
            created: id.created,
            isDefault: id.name === defaultName
          })),
          defaultIdentity: defaultName
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get current identity
  router.get('/identity/current', (req, res) => {
    try {
      const identity = identityManager.getIdentity();
      const defaultName = identityManager.getDefaultIdentityName();

      res.json({
        success: true,
        data: {
          name: identity.name,
          publicKey: identity.publicKey,
          created: identity.created,
          isDefault: identity.name === defaultName
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Create new identity
  router.post('/identities', (req, res) => {
    try {
      const { name, setDefault } = req.body;

      if (!name || typeof name !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'name is required'
        });
      }

      // Validate name format
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        return res.status(400).json({
          success: false,
          error: 'name can only contain letters, numbers, underscores, and hyphens'
        });
      }

      const identity = identityManager.createIdentity(name, setDefault ?? false);

      res.json({
        success: true,
        data: {
          name: identity.name,
          publicKey: identity.publicKey,
          created: identity.created
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Switch default identity
  router.post('/identities/switch', (req, res) => {
    try {
      const { name } = req.body;

      if (!name) {
        return res.status(400).json({
          success: false,
          error: 'name is required'
        });
      }

      identityManager.setDefault(name);

      res.json({
        success: true,
        data: {
          message: `Switched to identity '${name}'. Restart the server to use the new identity.`,
          requiresRestart: true
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Delete identity
  router.delete('/identities/:name', (req, res) => {
    try {
      const { name } = req.params;

      // Don't allow deleting the current identity while server is running
      const defaultName = identityManager.getDefaultIdentityName();
      if (name === defaultName) {
        return res.status(400).json({
          success: false,
          error: 'Cannot delete the currently active identity. Switch to another identity first.'
        });
      }

      identityManager.deleteIdentity(name);

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Export identity secret key (for backup)
  router.get('/identities/:name/export', (req, res) => {
    try {
      const { name } = req.params;
      const secretKey = identityManager.exportSecret(name);

      res.json({
        success: true,
        data: {
          name,
          secretKey,
          warning: 'Keep this secret key safe! Anyone with this key can control your identity.'
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Import identity from secret key
  router.post('/identities/import', (req, res) => {
    try {
      const { name, secretKey, setDefault } = req.body;

      if (!name || !secretKey) {
        return res.status(400).json({
          success: false,
          error: 'name and secretKey are required'
        });
      }

      // Validate name format
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        return res.status(400).json({
          success: false,
          error: 'name can only contain letters, numbers, underscores, and hyphens'
        });
      }

      // Validate secret key format (hex string)
      if (!/^[a-fA-F0-9]{64}$/.test(secretKey)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid secret key format (expected 64 hex characters)'
        });
      }

      const identity = identityManager.importIdentity(name, secretKey, setDefault ?? false);

      res.json({
        success: true,
        data: {
          name: identity.name,
          publicKey: identity.publicKey,
          created: identity.created
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}
