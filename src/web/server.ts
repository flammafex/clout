/**
 * Clout Web UI Server
 *
 * Simple web interface for viewing feeds and creating posts
 * Now with rich media support via WNFS-based storage
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
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
  createSubmitRoutes,
  createAdminRoutes,
  createOpenGraphRoutes
} from './routes/index.js';
import { createFreebirdProxyRoutes } from './routes/freebird-proxy.js';
import { createFreebirdAdminFromEnv } from '../integrations/freebird-admin.js';
import type { FreebirdAdapter } from '../integrations/freebird.js';
import { existsSync, writeFileSync, readFileSync } from 'fs';
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
  private invitationCodeToSignature: Map<string, string> = new Map();
  // Track invitation codes that have been used (prevent double-spending)
  private usedInvitationCodes: Set<string> = new Set();
  // Pending claims reserved during /invitation/redeem, consumed on successful /daypass/mint
  private pendingInvitationClaims: Map<string, { publicKey: string; signature: string; claimedAt: number }> = new Map();
  // Freebird adapter for browser VOPRF proxy
  private freebirdAdapter?: FreebirdAdapter;
  // File system store for quota tracking
  private store?: FileSystemStore;
  // Instance owner public key (has admin privileges)
  // This is the BROWSER USER's public key who has admin rights, NOT the server identity
  private ownerPublicKey?: string;

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
    // Trust proxy - required when running behind nginx/reverse proxy
    // This ensures rate limiting uses the real client IP from X-Forwarded-For
    // Set to 1 to trust the first proxy (typical for nginx -> node setup)
    if (process.env.TRUST_PROXY === 'true' || process.env.NODE_ENV === 'production') {
      this.app.set('trust proxy', 1);
    }

    // Security headers - protect against common attacks
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
      if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      }
      next();
    });

    // CORS - restrict to allowed origins
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
    this.app.use(cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (same-origin, Postman, etc.)
        if (!origin) return callback(null, true);
        // In development, allow localhost
        if (process.env.NODE_ENV !== 'production') {
          if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
            return callback(null, true);
          }
        }
        // Check against allowed origins
        if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        callback(new Error('CORS not allowed'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
    }));

    // Rate limiting - protect against brute force and DoS
    const authLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 10, // 10 attempts per window
      message: { success: false, error: 'Too many attempts, please try again later' },
      standardHeaders: true,
      legacyHeaders: false
    });
    const postLimiter = rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 10, // 10 posts per minute
      message: { success: false, error: 'Too many posts, please slow down' },
      standardHeaders: true,
      legacyHeaders: false
    });
    const apiLimiter = rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 100, // 100 requests per minute
      message: { success: false, error: 'Too many requests, please slow down' },
      standardHeaders: true,
      legacyHeaders: false
    });

    // Apply rate limiters to specific paths
    this.app.use('/api/auth/', authLimiter);
    this.app.use('/api/invitation/', authLimiter);
    this.app.use('/api/post/', postLimiter);
    this.app.use('/api/', apiLimiter);

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

    // Error handler - don't expose internal details in production
    this.app.use((err: Error, req: Request, res: Response, next: any) => {
      console.error('Error:', err);
      const message = process.env.NODE_ENV === 'production'
        ? 'Internal server error'
        : err.message;
      res.status(500).json({ success: false, error: message });
    });
  }

  /**
   * Helper functions for route modules
   */
  private getClout = (): Clout | undefined => this.clout;
  private isInitialized = (): boolean => this.initialized;
  private areVisitorsAllowed = (): boolean => this.allowVisitors;
  private getFreebirdAdapter = (): FreebirdAdapter | undefined => this.freebirdAdapter;
  private getStore = (): FileSystemStore | undefined => this.store;
  private getOwnerPublicKey = (): string | undefined => this.ownerPublicKey;

  // Day Pass ticket storage helpers (only per-user data server stores)
  // All other user data (trust graph, nicknames, etc.) lives in browser IndexedDB
  private getUserTicket = async (publicKey: string): Promise<any> => {
    return await this.userDataStore.getTicket(publicKey);
  };
  private setUserTicket = async (publicKey: string, ticket: any): Promise<void> => {
    await this.userDataStore.setTicket(publicKey, ticket);
  };
  private clearUserTicket = async (publicKey: string): Promise<void> => {
    await this.userDataStore.clearTicket(publicKey);
  };

  /**
   * Setup API routes
   */
  private setupRoutes(): void {
    // Health check (public)
    this.app.get('/api/health', (req, res) => {
      res.json({ success: true, status: 'online' });
    });

    // Instance info (public) - displayed to visitors
    this.app.get('/api/instance', (req, res) => {
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
      const isOwner = browserUserKey && this.ownerPublicKey && browserUserKey === this.ownerPublicKey;

      res.json({
        success: true,
        data: {
          name: process.env.INSTANCE_NAME || 'Clout Instance',
          operator: process.env.INSTANCE_OPERATOR || null,
          description: process.env.INSTANCE_DESCRIPTION || 'An uncensorable social network instance',
          pgpKey: process.env.INSTANCE_PGP_KEY || null,
          contact: process.env.INSTANCE_CONTACT || null,
          witnessDomain,
          isOwner,
          ownerPublicKey: this.ownerPublicKey ? this.ownerPublicKey.slice(0, 16) + '...' : null
        }
      });
    });

    // Instance stats (public) - "Clout" metrics visible to everyone
    this.app.get('/api/instance/stats', async (req, res) => {
      try {
        if (!this.clout) {
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
        const cloutStats = await this.clout.getCloutStats();

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

        if (!publicKey || typeof publicKey !== 'string' || !Crypto.isValidPublicKeyHex(publicKey)) {
          return res.status(400).json({
            success: false,
            error: 'Valid publicKey is required'
          });
        }

        // Check if this invitation code has already been used
        if (this.usedInvitationCodes.has(code)) {
          console.warn(`[Server] Invitation ${code.slice(0, 8)}... already used, rejecting`);
          return res.status(400).json({
            success: false,
            error: 'This invitation code has already been used'
          });
        }

        // Enforce a single pending claimant per invitation code
        this.cleanupExpiredPendingInvitationClaims();
        const existingClaim = this.pendingInvitationClaims.get(code);
        if (existingClaim && existingClaim.publicKey !== publicKey) {
          return res.status(409).json({
            success: false,
            error: 'This invitation code is currently being redeemed by another user'
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

        // Get the signature for this code
        const signature = this.invitationCodeToSignature.get(code);
        if (!signature) {
          console.warn(`[Server] No signature found for invitation code ${code.slice(0, 8)}...`);
        }

        if (!signature) {
          return res.status(400).json({
            success: false,
            error: 'Invitation signature is missing for this code'
          });
        }

        this.pendingInvitationClaims.set(code, {
          publicKey,
          signature,
          claimedAt: Date.now()
        });
        console.log(`[Server] Invitation ${code.slice(0, 8)}... reserved by ${publicKey.slice(0, 16)}...`);

        // Get the inviter for this code (for response)
        const inviterKey = this.invitationCodeToInviter.get(code);

        res.json({
          success: true,
          data: {
            message: 'Invitation code accepted. Complete Day Pass mint to finalize redemption.',
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
    this.app.use('/api/opengraph', createOpenGraphRoutes());

    // Mount browser-identity submit routes (pre-signed payloads)
    // Note: Server only stores Day Pass tickets. All social graph data
    // lives in browser IndexedDB (Dark Social Graph architecture)
    this.app.use('/api', createSubmitRoutes({
      getClout: this.getClout,
      isInitialized: this.isInitialized,
      getUserTicket: this.getUserTicket,
      setUserTicket: this.setUserTicket,
      clearUserTicket: this.clearUserTicket,
      // Check if user is registered with Freebird (can renew Day Pass without invitation)
      isUserRegistered: async (publicKey: string) => {
        return this.userDataStore.isFreebirdRegistered(publicKey);
      },
      setUserRegistered: async (publicKey: string, registered: boolean) => {
        await this.userDataStore.setFreebirdRegistered(publicKey, registered);
      },
      getOwnerPublicKey: this.getOwnerPublicKey,
      consumeInvitationCode: async (code: string, publicKey: string) => {
        return this.consumeInvitationCode(code, publicKey);
      }
    }));

    // Mount Freebird proxy routes (for browser VOPRF blinding)
    // Browser does blinding locally, server proxies to Freebird (no CORS)
    this.app.use('/api/freebird', createFreebirdProxyRoutes({
      getFreebirdAdapter: this.getFreebirdAdapter,
      isInitialized: this.isInitialized,
      // Check if user is registered with Freebird (can renew Day Pass without invitation)
      isUserRegistered: async (publicKey: string) => {
        return this.userDataStore.isFreebirdRegistered(publicKey);
      },
      // Mark user as registered with Freebird after successful token issuance
      setUserRegistered: async (publicKey: string, registered: boolean) => {
        await this.userDataStore.setFreebirdRegistered(publicKey, registered);
      },
      getReservedInvitationSignature: async (code: string, publicKey: string) => {
        return this.getReservedInvitationSignature(code, publicKey);
      },
      getOwnerPublicKey: this.getOwnerPublicKey
    }));

    // Mount admin routes for invitation quota management
    // Owner routes: /api/admin/* (require admin key)
    // Member routes: /api/invitations/* (for users with quota)
    this.app.use('/api', createAdminRoutes({
      getClout: this.getClout,
      isInitialized: this.isInitialized,
      getStore: this.getStore,
      getOwnerPublicKey: this.getOwnerPublicKey,
      findBootstrapInvitationByRedeemer: this.findBootstrapInvitationByRedeemer.bind(this)
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

    // Check if we have admin capabilities (have admin key)
    const hasAdminKey = !!process.env.FREEBIRD_ADMIN_KEY;

    // Load owner public key from environment or file
    // The owner is a BROWSER USER's public key, not the server identity
    this.loadOwnerPublicKey();

    // Initialize infrastructure (Freebird, Witness, Gossip)
    console.log('Initializing Clout infrastructure...');
    const infra = await this.infraManager.initialize({
      userPublicKey: identity.publicKey,
      isOwner: hasAdminKey
    });

    // Store Freebird adapter for browser VOPRF proxy
    this.freebirdAdapter = infra.freebird;

    // Initialize persistent storage (path logged by FileStore)
    this.store = new FileSystemStore();
    await this.store.init();

    this.clout = new Clout({
      publicKey: identity.publicKey,
      privateKey: secretKey,
      freebird: infra.freebird,
      witness: infra.witness,
      gossip: infra.gossip,
      store: this.store
    });

    // Load persisted ticket if available (survives Docker restarts)
    await this.clout.loadSavedTicket();

    this.initialized = true;
    console.log(`Clout initialized with identity: ${identity.publicKey.slice(0, 16)}...`);
    if (hasAdminKey) {
      console.log(`Admin key configured (admin API enabled)`);
      if (this.ownerPublicKey) {
        console.log(`Instance owner: ${this.ownerPublicKey.slice(0, 16)}...`);
      } else {
        console.log(`No instance owner set - first bootstrap invitation redeemer will become owner`);
      }
    }
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

      // Store invitation-to-inviter and invitation-to-signature mappings
      for (const inv of invitations) {
        this.invitationCodeToInviter.set(inv.code, selfPublicKey);
        this.invitationCodeToSignature.set(inv.code, inv.signature);
      }

      // Save invitation codes AND signatures to a file for admin reference
      const dataDir = process.env.CLOUT_DATA_DIR || join(homedir(), '.clout');
      const invitesFile = join(dataDir, 'invitations.json');

      writeFileSync(invitesFile, JSON.stringify({
        created: new Date().toISOString(),
        count: invitations.length,
        codes: invitations.map(i => i.code),
        // Store full invitation data including signatures for redemption
        invitations: invitations.map(i => ({ code: i.code, signature: i.signature })),
        inviter: selfPublicKey,
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
   * Load existing invitation-to-inviter and invitation-to-signature mappings from file
   */
  private loadInvitationMappings(): void {
    try {
      const dataDir = process.env.CLOUT_DATA_DIR || join(homedir(), '.clout');
      const invitesFile = join(dataDir, 'invitations.json');

      console.log(`[Bootstrap] Looking for invitations at: ${invitesFile}`);

      if (existsSync(invitesFile)) {
        const data = JSON.parse(readFileSync(invitesFile, 'utf-8'));
        const inviter = data.inviter;
        const invitations = data.invitations || [];
        const codes = data.codes || [];
        const usedCodes = data.usedCodes || [];

        console.log(`[Bootstrap] Found invitations.json: inviter=${inviter ? 'present' : 'MISSING'}, invitations=${invitations.length}, codes=${codes.length}, usedCodes=${usedCodes.length}`);

        // Load used codes
        for (const code of usedCodes) {
          this.usedInvitationCodes.add(code);
        }
        if (usedCodes.length > 0) {
          console.log(`[Bootstrap] Loaded ${usedCodes.length} previously used invitation codes`);
        }

        // Load from new format (with signatures)
        if (invitations.length > 0) {
          let withSig = 0;
          let withoutSig = 0;
          for (const inv of invitations) {
            if (inv.code && inviter) {
              this.invitationCodeToInviter.set(inv.code, inviter);
            }
            if (inv.code && inv.signature) {
              this.invitationCodeToSignature.set(inv.code, inv.signature);
              withSig++;
            } else {
              withoutSig++;
            }
          }
          console.log(`[Bootstrap] Loaded ${invitations.length} invitation code mappings (${withSig} with signatures, ${withoutSig} without)`);
        } else if (inviter && codes.length > 0) {
          // Fallback to old format (without signatures) - signatures won't work
          for (const code of codes) {
            this.invitationCodeToInviter.set(code, inviter);
          }
          console.log(`[Bootstrap] Loaded ${codes.length} invitation code mappings (legacy format, no signatures)`);
          console.warn(`[Bootstrap] ⚠️ Invitations were stored without signatures. They may not work with Freebird.`);
          console.warn(`[Bootstrap] ⚠️ Delete invitations.json and restart to regenerate with signatures.`);
        }
      } else {
        console.warn(`[Bootstrap] ⚠️ invitations.json not found at ${invitesFile}`);
        console.warn(`[Bootstrap] ⚠️ Set CLOUT_DATA_DIR to the correct directory or regenerate invitations`);
      }
    } catch (error: any) {
      console.error(`[Bootstrap] Error loading invitations.json: ${error.message}`);
    }
  }

  /**
   * Remove stale pending invitation claims
   */
  private cleanupExpiredPendingInvitationClaims(): void {
    const now = Date.now();
    const maxPendingMs = 15 * 60 * 1000; // 15 minutes

    for (const [code, claim] of this.pendingInvitationClaims.entries()) {
      if (now - claim.claimedAt > maxPendingMs) {
        this.pendingInvitationClaims.delete(code);
      }
    }
  }

  /**
   * Get invitation signature only if the code is reserved for this user.
   */
  private getReservedInvitationSignature(code: string, publicKey: string): string | null {
    this.cleanupExpiredPendingInvitationClaims();
    const claim = this.pendingInvitationClaims.get(code);
    if (!claim || claim.publicKey !== publicKey) {
      return null;
    }
    return claim.signature;
  }

  /**
   * Consume an invitation code after successful token issuance + Day Pass mint.
   * This is the final redemption step that prevents code burn on failed onboarding.
   */
  private async consumeInvitationCode(code: string, redeemerPublicKey: string): Promise<boolean> {
    if (!code || !redeemerPublicKey) {
      return false;
    }

    if (this.usedInvitationCodes.has(code)) {
      return false;
    }

    this.cleanupExpiredPendingInvitationClaims();
    const claim = this.pendingInvitationClaims.get(code);
    if (!claim || claim.publicKey !== redeemerPublicKey) {
      return false;
    }

    this.usedInvitationCodes.add(code);
    this.pendingInvitationClaims.delete(code);
    this.saveUsedInvitationCode(code, redeemerPublicKey);
    console.log(`[Server] Invitation ${code.slice(0, 8)}... finalized by ${redeemerPublicKey.slice(0, 16)}...`);

    if (this.store) {
      this.store.markInvitationRedeemed(code, redeemerPublicKey);
    }

    // If no owner is set yet and this is a bootstrap invitation, set the redeemer as owner
    const isBootstrapInvitation = this.invitationCodeToInviter.has(code);
    if (isBootstrapInvitation && !this.ownerPublicKey) {
      this.setOwnerPublicKey(redeemerPublicKey);
    }

    // Auto-trust inviter after successful redemption
    const inviterKey = this.invitationCodeToInviter.get(code);
    const serverIdentity = this.identityManager.getIdentity()?.publicKey;
    const isBootstrapInviter = inviterKey === serverIdentity;

    if (inviterKey && redeemerPublicKey !== inviterKey && !isBootstrapInviter) {
      try {
        await this.userDataStore.trust(redeemerPublicKey, inviterKey);
        console.log(`[Server] 🤝 Auto-trusted inviter ${inviterKey.slice(0, 8)}... for new user ${redeemerPublicKey.slice(0, 8)}...`);
      } catch (trustError: any) {
        console.warn(`[Server] Failed to auto-trust inviter: ${trustError.message}`);
      }
    }

    return true;
  }

  /**
   * Save a used invitation code to invitations.json for persistence
   * Also tracks which public key redeemed the code for admin lookup
   */
  private saveUsedInvitationCode(code: string, redeemerPublicKey?: string): void {
    try {
      const dataDir = process.env.CLOUT_DATA_DIR || join(homedir(), '.clout');
      const invitesFile = join(dataDir, 'invitations.json');

      if (existsSync(invitesFile)) {
        const data = JSON.parse(readFileSync(invitesFile, 'utf-8'));

        // Legacy array format for backwards compatibility
        const usedCodes = data.usedCodes || [];
        if (!usedCodes.includes(code)) {
          usedCodes.push(code);
          data.usedCodes = usedCodes;
        }

        // New object format mapping code -> redeemer info
        const redemptions = data.redemptions || {};
        if (!redemptions[code] && redeemerPublicKey) {
          redemptions[code] = {
            redeemedBy: redeemerPublicKey,
            redeemedAt: Date.now()
          };
          data.redemptions = redemptions;
        }

        writeFileSync(invitesFile, JSON.stringify(data, null, 2));
        console.log(`[Server] Persisted used invitation code ${code.slice(0, 8)}... to invitations.json`);
      }
    } catch (error: any) {
      console.error(`[Server] Error saving used invitation code: ${error.message}`);
    }
  }

  /**
   * Get the redeemer public key for a bootstrap invitation code
   */
  getBootstrapInvitationRedeemer(code: string): { redeemedBy: string; redeemedAt: number } | null {
    try {
      const dataDir = process.env.CLOUT_DATA_DIR || join(homedir(), '.clout');
      const invitesFile = join(dataDir, 'invitations.json');

      if (existsSync(invitesFile)) {
        const data = JSON.parse(readFileSync(invitesFile, 'utf-8'));
        const redemptions = data.redemptions || {};
        return redemptions[code] || null;
      }
    } catch (error: any) {
      console.error(`[Server] Error reading invitation redemptions: ${error.message}`);
    }
    return null;
  }

  /**
   * Find which bootstrap invitation code a public key used
   */
  findBootstrapInvitationByRedeemer(redeemerPublicKey: string): { code: string; redeemedAt: number } | null {
    try {
      const dataDir = process.env.CLOUT_DATA_DIR || join(homedir(), '.clout');
      const invitesFile = join(dataDir, 'invitations.json');

      if (existsSync(invitesFile)) {
        const data = JSON.parse(readFileSync(invitesFile, 'utf-8'));
        const redemptions = data.redemptions || {};

        for (const [code, info] of Object.entries(redemptions)) {
          const redemption = info as { redeemedBy: string; redeemedAt: number };
          if (redemption.redeemedBy === redeemerPublicKey) {
            return { code, redeemedAt: redemption.redeemedAt };
          }
        }
      }
    } catch (error: any) {
      console.error(`[Server] Error searching invitation redemptions: ${error.message}`);
    }
    return null;
  }

  /**
   * Load the instance owner public key from environment or file
   * The owner is a BROWSER USER's public key, not the server identity
   */
  private loadOwnerPublicKey(): void {
    // First check environment variable
    const envOwner = process.env.INSTANCE_OWNER_PUBLIC_KEY;
    if (envOwner && envOwner.length === 64 && /^[a-fA-F0-9]+$/.test(envOwner)) {
      this.ownerPublicKey = envOwner;
      console.log(`[Owner] Loaded from INSTANCE_OWNER_PUBLIC_KEY: ${envOwner.slice(0, 16)}...`);
      return;
    }

    // Then check persisted file
    try {
      const dataDir = process.env.CLOUT_DATA_DIR || join(homedir(), '.clout');
      const ownerFile = join(dataDir, 'owner.json');

      if (existsSync(ownerFile)) {
        const data = JSON.parse(readFileSync(ownerFile, 'utf-8'));
        if (data.publicKey && data.publicKey.length === 64) {
          this.ownerPublicKey = data.publicKey;
          console.log(`[Owner] Loaded from owner.json: ${data.publicKey.slice(0, 16)}...`);
          console.log(`[Owner] Set at: ${new Date(data.setAt).toISOString()}`);
          return;
        }
      }
    } catch (error: any) {
      console.warn(`[Owner] Error loading owner.json: ${error.message}`);
    }

    // No owner set yet
    this.ownerPublicKey = undefined;
  }

  /**
   * Set the instance owner public key (persists to file)
   * Called when the first bootstrap invitation is redeemed
   */
  setOwnerPublicKey(publicKey: string): void {
    if (this.ownerPublicKey) {
      console.log(`[Owner] Owner already set to ${this.ownerPublicKey.slice(0, 16)}..., ignoring new owner ${publicKey.slice(0, 16)}...`);
      return;
    }

    this.ownerPublicKey = publicKey;

    try {
      const dataDir = process.env.CLOUT_DATA_DIR || join(homedir(), '.clout');
      const ownerFile = join(dataDir, 'owner.json');

      writeFileSync(ownerFile, JSON.stringify({
        publicKey,
        setAt: Date.now(),
        source: 'first_bootstrap_redeemer'
      }, null, 2));

      console.log(`[Owner] ✅ Set instance owner: ${publicKey.slice(0, 16)}...`);
      console.log(`[Owner] Saved to: ${ownerFile}`);
    } catch (error: any) {
      console.error(`[Owner] Error saving owner.json: ${error.message}`);
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

    // Auto-initialize Clout on startup (creates bootstrap invitations if needed)
    // This ensures invitations exist before any user visits
    try {
      await this.initializeClout();
      console.log('[Startup] ✅ Clout auto-initialized successfully');
    } catch (error: any) {
      console.error('[Startup] ❌ Auto-initialization failed:', error.message);
      console.log('[Startup] Manual initialization via /api/init may be required');
    }

    // Load existing invitation mappings (after bootstrap may have created them)
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
