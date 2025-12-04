/**
 * Clout Web UI Server
 *
 * Simple web interface for viewing feeds and creating posts
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { IdentityManager } from '../cli/identity-manager.js';
import { InfrastructureManager } from '../cli/infrastructure.js';
import { Clout } from '../clout.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export class CloutWebServer {
  private app: express.Application;
  private identityManager: IdentityManager;
  private infraManager: InfrastructureManager;
  private clout?: Clout;
  private initialized = false;

  constructor(private port = 3000) {
    this.app = express();
    this.identityManager = new IdentityManager();
    this.infraManager = new InfrastructureManager();

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static(join(__dirname, 'public')));

    // Error handler
    this.app.use((err: Error, req: Request, res: Response, next: any) => {
      console.error('Error:', err);
      res.status(500).json({
        success: false,
        error: err.message
      });
    });
  }

  /**
   * Setup API routes
   */
  private setupRoutes(): void {
    // Health check
    this.app.get('/api/health', (req, res) => {
      res.json({
        success: true,
        data: {
          initialized: this.initialized,
          version: '0.1.0'
        }
      });
    });

    // Initialize Clout instance
    this.app.post('/api/init', async (req, res) => {
      try {
        await this.initializeClout();
        res.json({ success: true });
      } catch (error: any) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Get identity
    this.app.get('/api/identity', async (req, res) => {
      try {
        await this.ensureInitialized();

        const defaultIdentity = this.identityManager.getDefaultWalletName();
        const identity = this.identityManager.getWallet(defaultIdentity!);

        res.json({
          success: true,
          data: {
            publicKey: identity.publicKey,
            name: defaultIdentity,
            created: identity.created
          }
        });
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get feed
    this.app.get('/api/feed', async (req, res) => {
      try {
        await this.ensureInitialized();

        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
        const feed = this.clout!.getFeed();
        const posts = feed.posts.slice(0, limit);

        res.json({
          success: true,
          data: {
            posts: posts.map(post => ({
              id: post.id,
              content: post.content,
              author: post.author,
              timestamp: post.proof.timestamp,
              contentType: post.contentType
            })),
            totalPosts: feed.posts.length
          }
        });
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Create post
    this.app.post('/api/post', async (req, res) => {
      try {
        await this.ensureInitialized();

        const { content } = req.body;
        if (!content) {
          return res.status(400).json({ success: false, error: 'Content required' });
        }

        // Get or create day pass
        try {
          const token = await this.clout!.obtainToken();
          await this.clout!.buyDayPass(token);
        } catch (error: any) {
          console.log('Day pass already obtained or error:', error.message);
        }

        // Create post
        const post = await this.clout!.post(content);
        const pkg = post.getPackage();

        res.json({
          success: true,
          data: {
            id: pkg.id,
            content: pkg.content,
            author: pkg.author,
            timestamp: pkg.proof.timestamp
          }
        });
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Trust/follow a user
    this.app.post('/api/trust', async (req, res) => {
      try {
        await this.ensureInitialized();

        const { publicKey } = req.body;
        if (!publicKey) {
          return res.status(400).json({ success: false, error: 'Public key required' });
        }

        await this.clout!.trust(publicKey);

        res.json({
          success: true,
          data: { publicKey }
        });
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get stats
    this.app.get('/api/stats', async (req, res) => {
      try {
        await this.ensureInitialized();

        const stats = this.clout!.getStats();

        res.json({
          success: true,
          data: stats
        });
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    });
  }

  /**
   * Ensure Clout is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initializeClout();
    }
  }

  /**
   * Initialize Clout instance
   */
  private async initializeClout(): Promise<void> {
    // Get or create default identity
    let defaultIdentity = this.identityManager.getDefaultWalletName();
    if (!defaultIdentity) {
      console.log('No default identity found, creating one...');
      const identity = this.identityManager.createWallet('default', true);
      defaultIdentity = identity.name;
    }

    const identity = this.identityManager.getWallet(defaultIdentity);
    const secretKey = this.identityManager.getSecretKey(defaultIdentity);

    // Initialize infrastructure
    console.log('Initializing Clout infrastructure...');
    const infra = await this.infraManager.initialize();

    // Create Clout instance
    this.clout = new Clout({
      publicKey: identity.publicKey,
      privateKey: secretKey,
      freebird: infra.freebird,
      witness: infra.witness,
      gossip: infra.gossip
    });

    this.initialized = true;
    console.log(`Clout initialized with identity: ${identity.publicKey.slice(0, 16)}...`);
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(this.port, () => {
        console.log(`\n🌐 Clout Web UI`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`Server running at http://localhost:${this.port}`);
        console.log(`\nAPI Endpoints:`);
        console.log(`  GET  /api/health    - Health check`);
        console.log(`  POST /api/init      - Initialize Clout`);
        console.log(`  GET  /api/identity  - Get identity`);
        console.log(`  GET  /api/feed      - Get feed`);
        console.log(`  POST /api/post      - Create post`);
        console.log(`  POST /api/trust     - Trust user`);
        console.log(`  GET  /api/stats     - Get stats`);
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
  const server = new CloutWebServer(port);
  server.start().catch(console.error);
}
