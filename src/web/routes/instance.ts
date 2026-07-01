/**
 * Instance Routes - Public health, instance info, and stats endpoints
 *
 * Extracted from CloutWebServer as part of Tier 3 Phase 6.
 */

import { Router, type Request, type Response } from 'express';
import type { Clout } from '../../clout.js';

export interface InstanceRoutesConfig {
  readonly getClout: () => Clout | undefined;
  readonly isInitialized: () => boolean;
  readonly getOwnerPublicKey: () => string | undefined;
}

export function createInstanceRoutes(config: InstanceRoutesConfig): Router {
  const router = Router();

  // Health check (public)
  router.get('/health', (_req: Request, res: Response) => {
    res.json({ success: true, status: 'online' });
  });

  // Instance info (public) - displayed to visitors
  router.get('/instance', (req: Request, res: Response) => {
    // Extract witness domain from gateway URL (removing subdomain)
    let witnessDomain = null;
    const witnessUrl = process.env.WITNESS_GATEWAY_URL;

    console.log('[Instance] WITNESS_GATEWAY_URL env var:', witnessUrl || '(not set)');

    if (witnessUrl) {
      try {
        const url = new URL(witnessUrl);
        const hostname = url.hostname;
        console.log('[Instance] Parsed hostname:', hostname);

        // Extract root domain (e.g., "witness1.metacan.org" -> "metacan.org")
        const parts = hostname.split('.');
        console.log('[Instance] Hostname parts:', parts, 'length:', parts.length);

        if (parts.length >= 2 && hostname !== 'localhost') {
          // Take last two parts for domain (handles .com, .org, etc.)
          witnessDomain = parts.slice(-2).join('.');
          console.log('[Instance] Extracted domain (from parts):', witnessDomain);
        } else {
          witnessDomain = hostname; // localhost or single-part hostname
          console.log('[Instance] Using hostname as domain:', witnessDomain);
        }
      } catch (err) {
        console.error('[Instance] Failed to parse WITNESS_GATEWAY_URL:', err);
      }
    } else {
      console.log('[Instance] No WITNESS_GATEWAY_URL configured');
    }

    console.log('[Instance] Final witnessDomain:', witnessDomain);

    // Check if the requesting browser user is the instance owner
    const browserUserKey = req.headers['x-user-publickey'] as string | undefined;
    const ownerKey = config.getOwnerPublicKey();
    const isOwner = browserUserKey && ownerKey && browserUserKey === ownerKey;

    res.json({
      success: true,
      data: {
        name: process.env.INSTANCE_NAME || 'Clout Instance',
        operator: process.env.INSTANCE_OPERATOR || null,
        description: process.env.INSTANCE_DESCRIPTION || 'An uncensorable social network instance',
        pgpKey: process.env.INSTANCE_PGP_KEY || null,
        contact: process.env.INSTANCE_CONTACT || null,
        icon: process.env.INSTANCE_ICON || '/church.svg',
        witnessDomain,
        isOwner,
        ownerPublicKey: ownerKey ? ownerKey.slice(0, 16) + '...' : null
      }
    });
  });

  // Instance stats (public) - "Clout" metrics visible to everyone
  router.get('/instance/stats', async (_req: Request, res: Response) => {
    try {
      const clout = config.getClout();
      if (!clout) {
        // Not initialized - return zeros
        return res.json({
          success: true,
          data: {
            posts: 0,
            authors: 0,
            reactions: 0,
            initialized: false
          }
        });
      }

      // Get clout stats from the feed module
      const cloutStats = await clout.getCloutStats();

      res.json({
        success: true,
        data: {
          posts: cloutStats.chronicleSize,
          authors: cloutStats.uniqueAuthors,
          reactions: cloutStats.reactionCount,
          peers: cloutStats.connectedPeers,
          initialized: true
        }
      });
    } catch (error: any) {
      console.error('[Instance Stats] Error:', error.message);
      res.json({
        success: true,
        data: {
          posts: 0,
          authors: 0,
          reactions: 0,
          initialized: false
        }
      });
    }
  });

  return router;
}
