/**
 * Clout Web UI Server
 *
 * Simple web interface for viewing feeds and creating posts
 * Now with rich media support via WNFS-based storage
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { IdentityManager } from '../cli/identity-manager.js';
import { InfrastructureManager } from '../cli/infrastructure.js';
import { Clout } from '../clout.js';
import { Crypto } from '../crypto.js';
import { tryLoadWasm } from '../vendor/hypertoken/WasmBridge.js';
import { FileSystemStore } from '../store/file-store.js';
import { AuthManager, isPublicRoute } from './auth.js';
import {
  createFeedRoutes,
  createTrustRoutes,
  createMediaRoutes,
  createSlidesRoutes,
  createSettingsRoutes,
  createDataRoutes
} from './routes/index.js';
import { createFreebirdAdminFromEnv } from '../integrations/freebird-admin.js';
import { existsSync, writeFileSync } from 'fs';
import { homedir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface WebServerConfig {
  port?: number;
  /** Require authentication for API endpoints (default: true in production) */
  requireAuth?: boolean;
}

export class CloutWebServer {
  private app: express.Application;
  private identityManager: IdentityManager;
  private infraManager: InfrastructureManager;
  private authManager: AuthManager;
  private clout?: Clout;
  private initialized = false;
  private port: number;

  constructor(config: WebServerConfig = {}) {
    this.port = config.port ?? 3000;
    this.app = express();
    this.identityManager = new IdentityManager();
    this.infraManager = new InfrastructureManager();
    this.authManager = new AuthManager({
      requireAuth: config.requireAuth
    });

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());
    // Support raw binary uploads for media (up to 100MB)
    this.app.use('/api/media/upload', express.raw({
      type: ['image/*', 'video/*', 'audio/*', 'application/pdf'],
      limit: '100mb'
    }));
    this.app.use(express.static(join(__dirname, 'public')));

    // Authentication middleware - skip public routes
    this.app.use('/api', (req: Request, res: Response, next: NextFunction) => {
      const fullPath = '/api' + req.path;
      if (isPublicRoute(fullPath)) {
        return next();
      }
      return this.authManager.createMiddleware()(req, res, next);
    });

    // Error handler
    this.app.use((err: Error, req: Request, res: Response, next: any) => {
      console.error('Error:', err);
      res.status(500).json({ success: false, error: err.message });
    });
  }

  /**
   * Helper functions for route modules
   */
  private getClout = (): Clout | undefined => this.clout;
  private isInitialized = (): boolean => this.initialized;

  /**
   * Setup API routes
   */
  private setupRoutes(): void {
    // Health check (public)
    this.app.get('/api/health', (req, res) => {
      res.json({ success: true, status: 'online' });
    });

    // Auth status (public) - check if auth is required
    this.app.get('/api/auth/status', (req, res) => {
      res.json({
        success: true,
        data: {
          authRequired: this.authManager.isAuthRequired(),
          activeSessions: this.authManager.getActiveSessionCount()
        }
      });
    });

    // Login with identity signature (public)
    // User proves they control the private key by signing a challenge
    this.app.post('/api/auth/login', (req, res) => {
      try {
        const { challenge, signature, publicKey } = req.body;

        // If not initialized, allow login without signature (will init with default identity)
        if (!this.initialized) {
          // Just create a session - identity will be verified on init
          const token = this.authManager.createSession();
          return res.json({
            success: true,
            data: {
              token,
              message: 'Session created. Call /api/init to initialize Clout.'
            }
          });
        }

        // Verify the signature matches the current identity
        const identity = this.identityManager.getIdentity();

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
        const token = this.authManager.createSession();
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
    this.app.post('/api/auth/logout', (req, res) => {
      try {
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) {
          const token = authHeader.slice(7);
          this.authManager.revokeToken(token);
        }
        res.json({ success: true });
      } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
      }
    });

    // Revoke all sessions (requires auth)
    this.app.post('/api/auth/revoke-all', (req, res) => {
      try {
        this.authManager.revokeAllSessions();
        res.json({ success: true, message: 'All sessions revoked' });
      } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
      }
    });

    // Redeem an invitation code
    this.app.post('/api/invitation/redeem', async (req, res) => {
      try {
        const { code } = req.body;

        if (!code) {
          return res.status(400).json({
            success: false,
            error: 'Invitation code is required'
          });
        }

        // Get the Freebird adapter and set the invitation code
        const infra = this.infraManager.getInfrastructure();
        if (!infra) {
          return res.status(400).json({
            success: false,
            error: 'Clout not initialized'
          });
        }

        // Store the invitation code in the Freebird adapter
        infra.freebird.setInvitationCode(code);

        res.json({
          success: true,
          data: { message: 'Invitation code set successfully' }
        });
      } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
      }
    });

    // Initialize Clout
    this.app.post('/api/init', async (req, res) => {
      try {
        await this.initializeClout();
        const ticketInfo = this.clout?.getTicketInfo();
        res.json({
          success: true,
          data: {
            ticketInfo: ticketInfo || null
          }
        });
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get Identity
    this.app.get('/api/identity', (req, res) => {
      try {
        if (!this.initialized) throw new Error('Not initialized');
        const profile = this.clout!.getProfile();
        res.json({ success: true, data: profile });
      } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
      }
    });

    // Update Profile
    this.app.post('/api/profile', async (req, res) => {
      try {
        if (!this.initialized) throw new Error('Not initialized');

        const { displayName, bio, avatar } = req.body;
        const metadata: any = {};

        if (displayName !== undefined) metadata.displayName = displayName;
        if (bio !== undefined) metadata.bio = bio;
        if (avatar !== undefined) metadata.avatar = avatar;

        if (Object.keys(metadata).length === 0) {
          return res.status(400).json({
            success: false,
            error: 'No metadata provided'
          });
        }

        await this.clout!.setProfileMetadata(metadata);

        const updatedProfile = this.clout!.getProfile();
        res.json({
          success: true,
          data: updatedProfile
        });
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Mount route modules
    this.app.use('/api', createFeedRoutes(this.getClout, this.isInitialized));
    this.app.use('/api', createTrustRoutes(this.getClout, this.isInitialized));
    this.app.use('/api/media', createMediaRoutes(this.getClout, this.isInitialized));
    this.app.use('/api/slides', createSlidesRoutes(this.getClout, this.isInitialized));
    this.app.use('/api/settings', createSettingsRoutes(this.getClout, this.isInitialized));
    this.app.use('/api/data', createDataRoutes(this.getClout, this.isInitialized, this.identityManager));

    // Legacy slide endpoints (for backwards compatibility)
    this.app.get('/api/slides', (req, res, next) => {
      req.url = '/';
      this.app._router.handle(req, res, next);
    });
    this.app.post('/api/slide', async (req, res) => {
      try {
        if (!this.initialized) throw new Error('Not initialized');
        const { recipient, message } = req.body;
        const slide = await this.clout!.slide(recipient, message);
        res.json({ success: true, data: slide });
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    });
  }

  /**
   * Initialize Clout instance
   */
  private async initializeClout(): Promise<void> {
    if (this.initialized) return;

    // Load or create identity
    let identity;
    try {
      identity = this.identityManager.getIdentity();
    } catch (error) {
      // No identity exists - create a default one
      console.log('No identity found, creating default identity...');
      identity = this.identityManager.createIdentity('default', true);
      console.log(`Created new identity: ${identity.publicKey.slice(0, 16)}...`);

      // Bootstrap Dunbar pool on first init (invitation mode only)
      await this.bootstrapDunbarPool();
    }
    const secretKey = this.identityManager.getSecretKey();

    // Initialize infrastructure (Freebird, Witness, Gossip)
    console.log('Initializing Clout infrastructure...');
    const infra = await this.infraManager.initialize();

    // Initialize persistent storage
    const store = new FileSystemStore();
    await store.init();
    console.log('Persistent storage initialized at ~/.clout/local-data.json');

    this.clout = new Clout({
      publicKey: identity.publicKey,
      privateKey: secretKey,
      freebird: infra.freebird,
      witness: infra.witness,
      gossip: infra.gossip,
      store
    });

    // Load persisted ticket if available (survives Docker restarts)
    await this.clout.loadSavedTicket();

    this.initialized = true;
    console.log(`Clout initialized with identity: ${identity.publicKey.slice(0, 16)}...`);
  }

  /**
   * Bootstrap the Dunbar pool with initial invitations
   *
   * Called on first initialization when running in 'invitation' mode.
   * Creates 150 invitation codes (Dunbar's number) for the admin to distribute.
   */
  private async bootstrapDunbarPool(): Promise<void> {
    const sybilMode = process.env.FREEBIRD_SYBIL_MODE || 'invitation';

    if (sybilMode !== 'invitation') {
      console.log('[Bootstrap] Skipping Dunbar pool (not in invitation mode)');
      return;
    }

    const freebirdAdmin = createFreebirdAdminFromEnv();
    if (!freebirdAdmin) {
      console.warn('[Bootstrap] Cannot bootstrap Dunbar pool: no admin key configured');
      return;
    }

    try {
      // Check if Freebird is accessible
      const isHealthy = await freebirdAdmin.healthCheck();
      if (!isHealthy) {
        console.warn('[Bootstrap] Freebird admin API not accessible, skipping bootstrap');
        return;
      }

      // Check if invitations already exist
      const existingInvites = await freebirdAdmin.listInvitations();
      if (existingInvites.length > 0) {
        console.log(`[Bootstrap] ${existingInvites.length} invitations already exist, skipping bootstrap`);
        return;
      }

      // Create the Dunbar pool
      const invitations = await freebirdAdmin.bootstrapDunbarPool(150);

      // Save invitation codes to a file for admin reference
      const dataDir = process.env.CLOUT_DATA_DIR || join(homedir(), '.clout');
      const invitesFile = join(dataDir, 'invitations.json');

      writeFileSync(invitesFile, JSON.stringify({
        created: new Date().toISOString(),
        count: invitations.length,
        codes: invitations.map(i => i.code),
        adminUrl: freebirdAdmin.getAdminUiUrl()
      }, null, 2));

      console.log(`[Bootstrap] ✅ Dunbar pool created!`);
      console.log(`[Bootstrap] 📝 ${invitations.length} invitation codes saved to: ${invitesFile}`);
      console.log(`[Bootstrap] 🔧 Admin UI: ${freebirdAdmin.getAdminUiUrl()}`);

    } catch (error: any) {
      console.warn(`[Bootstrap] Failed to create Dunbar pool: ${error.message}`);
      console.warn('[Bootstrap] You can create invitations manually via the Freebird Admin UI');
    }
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    // Initialize WASM backend for Chronicle (7x performance boost)
    await tryLoadWasm();

    return new Promise((resolve) => {
      this.app.listen(this.port, () => {
        console.log(`\n🌐 Clout Web UI`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`Server running at http://localhost:${this.port}`);
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
  const requireAuth = process.env.CLOUT_AUTH === 'true'; // Auth disabled by default for local use
  const server = new CloutWebServer({ port, requireAuth });
  server.start().catch(console.error);
}
