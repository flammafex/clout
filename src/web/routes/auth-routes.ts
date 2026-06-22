/**
 * Auth Routes - Login, logout, session management
 *
 * Extracted from CloutWebServer as part of Tier 3 Phase 6.
 */

import { Router, type Request, type Response } from 'express';
import { Crypto } from '../../crypto.js';
import type { AuthManager } from '../auth.js';
import type { IdentityManager } from '../../cli/identity-manager.js';

export interface AuthRoutesConfig {
  readonly authManager: AuthManager;
  readonly identityManager: IdentityManager;
  readonly isInitialized: () => boolean;
}

export function createAuthRoutes(config: AuthRoutesConfig): Router {
  const router = Router();

  // Auth status (public) - check if auth is required
  router.get('/auth/status', (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: {
        authRequired: config.authManager.isAuthRequired(),
        activeSessions: config.authManager.getActiveSessionCount()
      }
    });
  });

  // Login with identity signature (public)
  // User proves they control the private key by signing a challenge
  router.post('/auth/login', (req: Request, res: Response) => {
    try {
      const { challenge, signature, publicKey } = req.body;

      // If not initialized, allow login without signature (will init with default identity)
      if (!config.isInitialized()) {
        // Just create a session - identity will be verified on init
        const token = config.authManager.createSession();
        return res.json({
          success: true,
          data: {
            token,
            message: 'Session created. Call /api/init to initialize Clout.'
          }
        });
      }

      // Verify the signature matches the current identity
      const identity = config.identityManager.getIdentity();

      // If no signature provided, require it
      if (!signature || !challenge) {
        // Generate a new challenge for the client to sign
        const newChallenge = Crypto.toHex(Crypto.randomBytes(32));
        return res.status(401).json({
          success: false,
          error: 'Signature required',
          challenge: newChallenge,
          expectedPublicKey: identity.publicKey
        });
      }

      // Verify the signature
      const challengeBytes = Crypto.fromHex(challenge);
      const signatureBytes = Crypto.fromHex(signature);
      const publicKeyBytes = Crypto.fromHex(publicKey || identity.publicKey);

      if (!Crypto.verify(challengeBytes, signatureBytes, publicKeyBytes)) {
        return res.status(401).json({
          success: false,
          error: 'Invalid signature'
        });
      }

      // Verify this is the same identity
      if (publicKey && publicKey !== identity.publicKey) {
        return res.status(401).json({
          success: false,
          error: 'Public key does not match current identity'
        });
      }

      // Create session
      const token = config.authManager.createSession();
      res.json({
        success: true,
        data: {
          token,
          publicKey: identity.publicKey
        }
      });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Logout - revoke current session
  router.post('/auth/logout', (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        config.authManager.revokeToken(token);
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Revoke all sessions (requires auth)
  router.post('/auth/revoke-all', (_req: Request, res: Response) => {
    try {
      config.authManager.revokeAllSessions();
      res.json({ success: true, message: 'All sessions revoked' });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  return router;
}
