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
import { UserDataStore } from '../store/user-data-store.js';
import { AuthManager, isPublicRoute } from './auth.js';
import {
  createFeedRoutes,
  createTrustRoutes,
  createMediaRoutes,
  createSlidesRoutes,
  createSettingsRoutes,
  createDataRoutes,
  createSubmitRoutes
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
  /** Allow visitors to view the feed without identity (default: true) */
  allowVisitors?: boolean;
}

export class CloutWebServer {
  private app: express.Application;
  private identityManager: IdentityManager;
  private infraManager: InfrastructureManager;
  private authManager: AuthManager;
  private clout?: Clout;
  private initialized = false;
  private port: number;
  private allowVisitors: boolean;
  // Per-user persistent data storage for browser-identity mode
  private userDataStore: UserDataStore;
  // Mapping from invitation codes to inviter public keys
  private invitationCodeToInviter: Map<string, string> = new Map();

  constructor(config: WebServerConfig = {}) {
    this.port = config.port ?? 3000;
    this.allowVisitors = config.allowVisitors ?? true; // Default: allow visitors
    this.app = express();
    this.identityManager = new IdentityManager();
    this.infraManager = new InfrastructureManager();
    this.authManager = new AuthManager({
      requireAuth: config.requireAuth
    });
    this.userDataStore = new UserDataStore();

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
  private areVisitorsAllowed = (): boolean => this.allowVisitors;

  // Per-user persistent data helpers for browser-identity mode
  private getUserTicket = async (publicKey: string): Promise<any> => {
    return await this.userDataStore.getTicket(publicKey);
  };
  private setUserTicket = async (publicKey: string, ticket: any): Promise<void> => {
    await this.userDataStore.setTicket(publicKey, ticket);
  };

  // Get the user data store for route modules
  private getUserDataStore = (): UserDataStore => this.userDataStore;

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

    // Decode an invitation code to get inviter info
    // This is called before redemption so the browser can create a trust signal
    this.app.post('/api/invitation/decode', async (req, res) => {
      try {
        const { code } = req.body;

        if (!code) {
          return res.status(400).json({
            success: false,
            error: 'Invitation code is required'
          });
        }

        // Look up the inviter from our local mapping
        // This mapping is populated when invitations are created
        const inviterKey = this.invitationCodeToInviter.get(code);

        if (!inviterKey) {
          // Code might be valid but we don't have the mapping
          // This can happen for codes created before this feature
          // Return success but without inviter info
          return res.json({
            success: true,
            data: {
              code,
              hasInviter: false,
              message: 'Invitation code format valid, but inviter unknown'
            }
          });
        }

        res.json({
          success: true,
          data: {
            code,
            hasInviter: true,
            inviter: inviterKey
          }
        });
      } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
      }
    });

    // Redeem an invitation code
    this.app.post('/api/invitation/redeem', async (req, res) => {
      try {
        const { code, publicKey } = req.body;

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

        // Get the inviter for this code (for response)
        const inviterKey = this.invitationCodeToInviter.get(code);

        res.json({
          success: true,
          data: {
            message: 'Invitation code set successfully',
            inviter: inviterKey || null
          }
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
    this.app.use('/api', createFeedRoutes(this.getClout, this.isInitialized, this.areVisitorsAllowed));
    this.app.use('/api', createTrustRoutes(this.getClout, this.isInitialized));
    this.app.use('/api/media', createMediaRoutes(this.getClout, this.isInitialized));
    this.app.use('/api/slides', createSlidesRoutes(this.getClout, this.isInitialized));
    this.app.use('/api/settings', createSettingsRoutes(this.getClout, this.isInitialized));
    this.app.use('/api/data', createDataRoutes(this.getClout, this.isInitialized, this.identityManager));

    // Mount browser-identity submit routes (pre-signed payloads)
    this.app.use('/api', createSubmitRoutes({
      getClout: this.getClout,
      isInitialized: this.isInitialized,
      getUserTicket: this.getUserTicket,
      setUserTicket: this.setUserTicket,
      getUserDataStore: this.getUserDataStore
    }));

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
    }
    const secretKey = this.identityManager.getSecretKey();

    // Register Self as Freebird owner and bootstrap invitations if needed
    await this.bootstrapFreebirdOwner(identity.publicKey);

    // Check if we're the instance owner (have admin key)
    const isOwner = !!process.env.FREEBIRD_ADMIN_KEY;

    // Initialize infrastructure (Freebird, Witness, Gossip)
    console.log('Initializing Clout infrastructure...');
    const infra = await this.infraManager.initialize({
      userPublicKey: identity.publicKey,
      isOwner
    });

    // Initialize persistent storage (path logged by FileStore)
    const store = new FileSystemStore();
    await store.init();

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
   * Register Self as Freebird owner and bootstrap invitations if needed
   *
   * Owner registration runs on every startup (Freebird handles idempotency).
   * Invitation bootstrap runs if no invitations exist yet.
   *
   * @param selfPublicKey The public key of the Self identity (hex string)
   */
  private async bootstrapFreebirdOwner(selfPublicKey: string): Promise<void> {
    const sybilMode = process.env.FREEBIRD_SYBIL_MODE || 'invitation';

    if (sybilMode !== 'invitation') {
      console.log('[Bootstrap] Skipping Freebird setup (not in invitation mode)');
      return;
    }

    const freebirdAdmin = createFreebirdAdminFromEnv();
    if (!freebirdAdmin) {
      console.warn('[Bootstrap] No admin key configured, skipping Freebird setup');
      return;
    }

    try {
      // Check if Freebird is accessible
      const isHealthy = await freebirdAdmin.healthCheck();
      if (!isHealthy) {
        console.warn('[Bootstrap] Freebird admin API not accessible, skipping setup');
        return;
      }

      // Always register Self as the Freebird owner (first registration wins)
      await freebirdAdmin.registerOwner(selfPublicKey);

      // Check if invitations already exist
      const existingInvites = await freebirdAdmin.listInvitations();

      // Only bootstrap if we successfully got an empty list (count === 0)
      // If listInvitations returned null (error), skip bootstrap to be safe
      if (existingInvites === null) {
        console.log(`[Bootstrap] Could not check existing invitations, skipping bootstrap`);
        return;
      }

      if (existingInvites.length > 0) {
        console.log(`[Bootstrap] ${existingInvites.length} invitations already exist, skipping bootstrap`);
        return;
      }

      // Create the Dunbar pool (50 invitations - within Freebird's 1-100 limit)
      const invitations = await freebirdAdmin.bootstrapDunbarPool(selfPublicKey, 50);

      // Store invitation-to-inviter mapping for mutual trust flow
      for (const inv of invitations) {
        this.invitationCodeToInviter.set(inv.code, selfPublicKey);
      }

      // Save invitation codes to a file for admin reference
      const dataDir = process.env.CLOUT_DATA_DIR || join(homedir(), '.clout');
      const invitesFile = join(dataDir, 'invitations.json');

      writeFileSync(invitesFile, JSON.stringify({
        created: new Date().toISOString(),
        count: invitations.length,
        codes: invitations.map(i => i.code),
        inviter: selfPublicKey,  // Include inviter for reference
        adminUrl: freebirdAdmin.getAdminUiUrl()
      }, null, 2));

      console.log(`[Bootstrap] ✅ Dunbar pool created!`);
      console.log(`[Bootstrap] 📝 ${invitations.length} invitation codes saved to: ${invitesFile}`);
      console.log(`[Bootstrap] 🔧 Admin UI: ${freebirdAdmin.getAdminUiUrl()}`);

    } catch (error: any) {
      console.warn(`[Bootstrap] Freebird setup failed: ${error.message}`);
      console.warn('[Bootstrap] You can configure via the Freebird Admin UI');
    }
  }

  /**
   * Load existing invitation-to-inviter mappings from file
   */
  private loadInvitationMappings(): void {
    try {
      const dataDir = process.env.CLOUT_DATA_DIR || join(homedir(), '.clout');
      const invitesFile = join(dataDir, 'invitations.json');

      if (existsSync(invitesFile)) {
        const data = JSON.parse(require('fs').readFileSync(invitesFile, 'utf-8'));
        const inviter = data.inviter;
        const codes = data.codes || [];

        if (inviter && codes.length > 0) {
          for (const code of codes) {
            this.invitationCodeToInviter.set(code, inviter);
          }
          console.log(`[Bootstrap] Loaded ${codes.length} invitation code mappings`);
        }
      }
    } catch (error) {
      // File doesn't exist or is invalid - not an error, just no mappings yet
    }
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    // Initialize WASM backend for Chronicle (7x performance boost)
    await tryLoadWasm();

    // Initialize per-user data store (persistent storage)
    await this.userDataStore.init();

    // Load existing invitation mappings
    this.loadInvitationMappings();

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
  const requireAuth = process.env.CLOUT_AUTH === 'true'; // Auth disabled by default for local use
  // Allow visitors by default, set CLOUT_PRIVATE=true to disable visitor mode
  const allowVisitors = process.env.CLOUT_PRIVATE !== 'true';
  const server = new CloutWebServer({ port, requireAuth, allowVisitors });
  server.start().catch(console.error);
}
