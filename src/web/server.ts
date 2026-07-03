/**
 * Clout Web UI Server
 *
 * Primary runtime entrypoint. Now a thin composition root that wires
 * together the extracted modules:
 * - CloutRuntime (initialization lifecycle)
 * - OwnerRegistry (instance owner management)
 * - InvitationRedemption (invitation state machine)
 * - InvitationRedemptionStore (invitations.json persistence)
 * - FreebirdBootstrap (Dunbar pool creation)
 * - Middleware setup (security headers, CORS, rate limiting)
 * - Route factories (feed, trust, media, slides, etc.)
 *
 * Extracted modules (Tier 3 Phases 1-8):
 * - src/web/owner-registry.ts
 * - src/web/invitation-redemption.ts
 * - src/web/freebird-bootstrap.ts
 * - src/web/clout-runtime.ts
 * - src/web/middleware.ts
 * - src/store/invitation-redemption-store.ts
 * - src/web/routes/instance.ts
 * - src/web/routes/auth-routes.ts
 * - src/web/routes/invitation.ts
 * - src/web/routes/server-trust-graph.ts
 */

import 'dotenv/config';
import express from 'express';
import { IdentityManager } from '../cli/identity-manager.js';
import { InfrastructureManager } from '../cli/infrastructure.js';
import { Clout } from '../clout.js';
import { UserDataStore } from '../store/user-data-store.js';
import { InvitationRedemptionStore } from '../store/invitation-redemption-store.js';
import { AuthManager } from './auth.js';
import { OwnerRegistry } from './owner-registry.js';
import { InvitationRedemption } from './invitation-redemption.js';
import { CloutRuntime } from './clout-runtime.js';
import { setupMiddleware } from './middleware.js';
import {
  createFeedRoutes,
  createTrustRoutes,
  createMediaRoutes,
  createSlidesRoutes,
  createSettingsRoutes,
  createDataRoutes,
  createSubmitRoutes,
  createAdminRoutes,
  createOpenGraphRoutes
} from './routes/index.js';
import { createInstanceRoutes } from './routes/instance.js';
import { createAuthRoutes } from './routes/auth-routes.js';
import { createInvitationRoutes } from './routes/invitation.js';
import { createServerTrustGraphRoutes } from './routes/server-trust-graph.js';
import { createFreebirdProxyRoutes } from './routes/freebird-proxy.js';
import type { FreebirdAdapter } from '../integrations/freebird.js';

export interface WebServerConfig {
  port?: number;
  /** Require authentication for API endpoints (default: true in production) */
  requireAuth?: boolean;
  /** Allow visitors to view the feed without identity (default: true) */
  allowVisitors?: boolean;
}

export class CloutWebServer {
  private app: express.Application;
  private identityManager: IdentityManager;
  private infraManager: InfrastructureManager;
  private authManager: AuthManager;
  private port: number;
  private allowVisitors: boolean;
  private userDataStore: UserDataStore;
  private invitationRedemption: InvitationRedemption;
  private ownerRegistry: OwnerRegistry = new OwnerRegistry();
  private invitationStore: InvitationRedemptionStore = new InvitationRedemptionStore();
  private runtime: CloutRuntime;

  constructor(config: WebServerConfig = {}) {
    this.port = config.port ?? 3000;
    this.allowVisitors = config.allowVisitors ?? true;
    this.app = express();
    this.identityManager = new IdentityManager();
    this.infraManager = new InfrastructureManager();
    this.authManager = new AuthManager({ requireAuth: config.requireAuth });
    this.userDataStore = new UserDataStore();
    this.invitationRedemption = new InvitationRedemption({
      store: this.invitationStore,
      ownerRegistry: this.ownerRegistry,
      userDataStore: this.userDataStore,
      getFileSystemStore: () => this.runtime.getStore(),
      getServerPublicKey: () => this.identityManager.getIdentity()?.publicKey,
      isInitialized: () => this.runtime.isInitialized()
    });
    this.runtime = new CloutRuntime({
      identityManager: this.identityManager,
      infraManager: this.infraManager,
      ownerRegistry: this.ownerRegistry,
      invitationRedemption: this.invitationRedemption,
      invitationStore: this.invitationStore
    });

    setupMiddleware(this.app, { authManager: this.authManager });
    this.setupRoutes();
  }

  /**
   * Setup API routes — mount all route factory modules.
   */
  private setupRoutes(): void {
    // Public routes (instance, auth, invitation)
    this.app.use('/api', createInstanceRoutes({
      getClout: () => this.runtime.getClout(),
      isInitialized: () => this.runtime.isInitialized(),
      getOwnerPublicKey: () => this.ownerRegistry.get()
    }));
    this.app.use('/api', createAuthRoutes({
      authManager: this.authManager,
      identityManager: this.identityManager,
      isInitialized: () => this.runtime.isInitialized()
    }));
    this.app.use('/api', createInvitationRoutes({
      invitationRedemption: this.invitationRedemption
    }));

    // Init route (requires server internals)
    this.app.post('/api/init', async (_req, res) => {
      try {
        await this.runtime.initialize();
        const clout = this.runtime.getClout();
        const ticketInfo = clout?.getTicketInfo();
        res.json({ success: true, data: { ticketInfo: ticketInfo || null } });
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Identity/profile routes (require server internals)
    this.app.get('/api/identity', (_req, res) => {
      try {
        if (!this.runtime.isInitialized()) throw new Error('Not initialized');
        const profile = this.runtime.getClout()!.getProfile();
        res.json({ success: true, data: profile });
      } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
      }
    });
    this.app.post('/api/profile', async (req, res) => {
      try {
        if (!this.runtime.isInitialized()) throw new Error('Not initialized');
        const { displayName, bio, avatar } = req.body;
        const metadata: any = {};
        if (displayName !== undefined) metadata.displayName = displayName;
        if (bio !== undefined) metadata.bio = bio;
        if (avatar !== undefined) metadata.avatar = avatar;
        if (Object.keys(metadata).length === 0) {
          return res.status(400).json({ success: false, error: 'No metadata provided' });
        }
        await this.runtime.getClout()!.setProfileMetadata(metadata);
        const updatedProfile = this.runtime.getClout()!.getProfile();
        res.json({ success: true, data: updatedProfile });
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Domain route modules
    this.app.use('/api', createFeedRoutes(
      () => this.runtime.getClout(),
      () => this.runtime.isInitialized(),
      () => this.allowVisitors,
      () => this.ownerRegistry.get()
    ));
    this.app.use('/api', createTrustRoutes(
      () => this.runtime.getClout(),
      () => this.runtime.isInitialized()
    ));
    this.app.use('/api/media', createMediaRoutes(
      () => this.runtime.getClout(),
      () => this.runtime.isInitialized()
    ));
    this.app.use('/api/slides', createSlidesRoutes(
      () => this.runtime.getClout(),
      () => this.runtime.isInitialized()
    ));
    this.app.use('/api/settings', createSettingsRoutes(
      () => this.runtime.getClout(),
      () => this.runtime.isInitialized(),
      () => this.ownerRegistry.get()
    ));
    this.app.use('/api/data', createDataRoutes(
      () => this.runtime.getClout(),
      () => this.runtime.isInitialized(),
      this.identityManager
    ));
    this.app.use('/api/opengraph', createOpenGraphRoutes());

    // Server-side trust graph sync
    this.app.use('/api', createServerTrustGraphRoutes({ userDataStore: this.userDataStore }));

    // Browser-identity submit routes (pre-signed payloads)
    this.app.use('/api', createSubmitRoutes({
      getClout: () => this.runtime.getClout(),
      isInitialized: () => this.runtime.isInitialized(),
      getUserTicket: async (publicKey: string) => this.userDataStore.getTicket(publicKey),
      setUserTicket: async (publicKey: string, ticket: any) => this.userDataStore.setTicket(publicKey, ticket),
      clearUserTicket: async (publicKey: string) => this.userDataStore.clearTicket(publicKey),
      isUserRegistered: async (publicKey: string) => this.userDataStore.isFreebirdRegistered(publicKey),
      setUserRegistered: async (publicKey: string, registered: boolean) => this.userDataStore.setFreebirdRegistered(publicKey, registered),
      getOwnerPublicKey: () => this.ownerRegistry.get(),
      consumeInvitationCode: async (code: string, publicKey: string) => this.invitationRedemption.consume(code, publicKey)
    }));

    // Freebird proxy routes (browser VOPRF blinding)
    this.app.use('/api/freebird', createFreebirdProxyRoutes({
      getFreebirdAdapter: () => this.runtime.getFreebirdAdapter(),
      isInitialized: () => this.runtime.isInitialized(),
      isUserRegistered: async (publicKey: string) => this.userDataStore.isFreebirdRegistered(publicKey),
      setUserRegistered: async (publicKey: string, registered: boolean) => this.userDataStore.setFreebirdRegistered(publicKey, registered),
      getFreebirdUserId: async (publicKey: string) => this.userDataStore.getFreebirdUserId(publicKey),
      setFreebirdUserId: async (publicKey: string, freebirdUserId: string) => this.userDataStore.setFreebirdUserId(publicKey, freebirdUserId),
      getRedeemedInvitationCode: async (publicKey: string) => this.invitationRedemption.getRedeemedInvitationCodeForUser(publicKey),
      getReservedInvitationSignature: async (code: string, publicKey: string) => this.invitationRedemption.getReservedSignature(code, publicKey),
      getOwnerPublicKey: () => this.ownerRegistry.get()
    }));

    // Admin routes (invitation quota management)
    this.app.use('/api', createAdminRoutes({
      getClout: () => this.runtime.getClout(),
      isInitialized: () => this.runtime.isInitialized(),
      getStore: () => this.runtime.getStore(),
      getOwnerPublicKey: () => this.ownerRegistry.get(),
      findBootstrapInvitationByRedeemer: this.invitationRedemption.findBootstrapInvitationByRedeemer.bind(this.invitationRedemption),
      getFreebirdUserId: async (publicKey: string) => this.userDataStore.getFreebirdUserId(publicKey),
      onInvitationCreated: (code: string, inviterPublicKey: string, signature?: string) => {
        this.invitationRedemption.registerInvitation(code, inviterPublicKey, signature);
      }
    }));

    // Legacy slide endpoints (for backwards compatibility)
    this.app.get('/api/slides', (req, res, next) => {
      req.url = '/';
      this.app._router.handle(req, res, next);
    });
    this.app.post('/api/slide', async (req, res) => {
      try {
        if (!this.runtime.isInitialized()) throw new Error('Not initialized');
        const { recipient, message } = req.body;
        const slide = await this.runtime.getClout()!.slide(recipient, message);
        res.json({ success: true, data: slide });
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    });
  }

  /**
   * Start the server.
   */
  async start(): Promise<void> {
    // Initialize per-user data store (persistent storage)
    await this.userDataStore.init();

    // Auto-initialize Clout on startup (creates bootstrap invitations if needed)
    try {
      await this.runtime.initialize();
      console.log('[Startup] ✅ Clout auto-initialized successfully');
    } catch (error: any) {
      console.error('[Startup] ❌ Auto-initialization failed:', error.message);
      console.log('[Startup] Manual initialization via /api/init may be required');
    }

    // Load existing invitation mappings (after bootstrap may have created them)
    this.invitationRedemption.loadMappings();

    return new Promise((resolve) => {
      this.app.listen(this.port, () => {
        console.log(`\n🌐 Clout Web UI`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`Server running at http://localhost:${this.port}`);
        console.log(`Mode: ${this.allowVisitors ? '🌍 Public (visitors allowed)' : '🔒 Private (identity required)'}`);
        console.log(`\nAPI Endpoints:`);
        console.log(`  GET  /api/health       - Health check`);
        console.log(`  POST /api/init         - Initialize Clout`);
        console.log(`  GET  /api/identity     - Get identity`);
        console.log(`  GET  /api/feed         - Get feed`);
        console.log(`  POST /api/post         - Create post (with media)`);
        console.log(`  POST /api/trust        - Trust user`);
        console.log(`  GET  /api/stats        - Get stats`);
        console.log(`\nMedia Endpoints:`);
        console.log(`  POST /api/media/upload - Upload media file`);
        console.log(`  GET  /api/media/:cid   - Retrieve media by CID`);
        console.log(`  GET  /api/media/stats  - Media storage stats`);
        console.log(`\nOpen http://localhost:${this.port} in your browser`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
        resolve();
      });
    });
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.env.PORT || '3000', 10);
  const requireAuth = process.env.CLOUT_AUTH === 'true';
  const allowVisitors = process.env.CLOUT_PRIVATE !== 'true';
  const server = new CloutWebServer({ port, requireAuth, allowVisitors });
  server.start().catch(console.error);
}
