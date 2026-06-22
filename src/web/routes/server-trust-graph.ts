/**
 * Server Trust Graph Routes - Server-side trust graph sync
 *
 * Returns trust relationships created server-side (e.g., from invitation auto-trust)
 * so the browser can merge them into its local IndexedDB trust graph.
 *
 * Extracted from CloutWebServer as part of Tier 3 Phase 6.
 */

import { Router, type Request, type Response } from 'express';
import type { UserDataStore } from '../../store/user-data-store.js';

export interface ServerTrustGraphRoutesConfig {
  readonly userDataStore: UserDataStore;
}

export function createServerTrustGraphRoutes(config: ServerTrustGraphRoutesConfig): Router {
  const router = Router();

  router.get('/trust/server-graph', async (req: Request, res: Response) => {
    try {
      const publicKey = req.query.publicKey as string;
      const hops = Math.min(parseInt(req.query.hops as string) || 1, 3);
      if (!publicKey || typeof publicKey !== 'string') {
        return res.status(400).json({ success: false, error: 'publicKey query param required' });
      }

      // Hop 1: user's direct trust
      const hop1Keys = await config.userDataStore.getTrustGraph(publicKey);
      const trustedKeys = [...hop1Keys];

      // Hop 2+: friends-of-friends
      const hopMap: Record<string, number> = {};
      for (const k of hop1Keys) hopMap[k] = 1;

      if (hops >= 2) {
        const hop2AllKeys: string[] = [];
        for (const hop1Key of hop1Keys) {
          const hop2Keys = await config.userDataStore.getTrustGraph(hop1Key);
          for (const k of hop2Keys) {
            if (k !== publicKey && !hopMap[k]) {
              hopMap[k] = 2;
              trustedKeys.push(k);
              hop2AllKeys.push(k);
            }
          }
        }

        if (hops >= 3) {
          for (const hop2Key of hop2AllKeys) {
            const hop3Keys = await config.userDataStore.getTrustGraph(hop2Key);
            for (const k of hop3Keys) {
              if (k !== publicKey && !hopMap[k]) {
                hopMap[k] = 3;
                trustedKeys.push(k);
              }
            }
          }
        }
      }

      res.json({ success: true, data: { trustedKeys, hopMap } });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}
