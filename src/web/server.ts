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
import { tryLoadWasm } from '../vendor/hypertoken/WasmBridge.js';
import { FileSystemStore } from '../store/file-store.js';

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
      res.status(500).json({ success: false, error: err.message });
    });
  }

  /**
   * Setup API routes
   */
  private setupRoutes(): void {
    // Health check
    this.app.get('/api/health', (req, res) => {
      res.json({ success: true, status: 'online' });
    });

    // Initialize Clout
    this.app.post('/api/init', async (req, res) => {
      try {
        await this.initializeClout();
        res.json({ success: true });
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
        await this.ensureInitialized();

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

    // Get Feed
    this.app.get('/api/feed', async (req, res) => {
      try {
        if (!this.initialized) throw new Error('Not initialized');
        
        const feed = await this.clout!.getFeed();
        
        const limit = parseInt(req.query.limit as string) || 50;
        const posts = feed.posts.slice(0, limit);

        res.json({
          success: true,
          data: {
            posts: posts.map(post => ({
              ...post,
              authorShort: post.author.slice(0, 8)
            })),
            totalPosts: feed.posts.length
          }
        });
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Create Post
    this.app.post('/api/post', async (req, res) => {
      try {
        if (!this.initialized) throw new Error('Not initialized');
        const { content, replyTo } = req.body;
        
        // Auto-mint ticket if needed
        // Fix TS2339: use hasActiveTicket()
        if (!this.clout!.hasActiveTicket()) {
          const token = await this.clout!.obtainToken();
          await this.clout!.buyDayPass(token);
        }

        const post = await this.clout!.post(content, replyTo);
        res.json({ success: true, data: post.getPackage() });
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Trust User
    this.app.post('/api/trust', async (req, res) => {
      try {
        if (!this.initialized) throw new Error('Not initialized');
        const { publicKey } = req.body;
        await this.clout!.trust(publicKey);
        res.json({ success: true });
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get Thread
    this.app.get('/api/thread/:id', async (req, res) => {
      try {
        if (!this.initialized) throw new Error('Not initialized');
        const postId = req.params.id;
        
        const feed = await this.clout!.getFeed();
        
        const parentPost = feed.posts.find(p => p.id === postId);
        
        if (!parentPost) {
          return res.status(404).json({ success: false, error: 'Post not found' });
        }

        const replies = feed.posts
          .filter(p => p.replyTo === postId)
          .sort((a, b) => a.proof.timestamp - b.proof.timestamp);

        res.json({
          success: true,
          data: {
            parent: {
              ...parentPost,
              authorShort: parentPost.author.slice(0, 8)
            },
            replies: replies.map(post => ({
              ...post,
              authorShort: post.author.slice(0, 8)
            }))
          }
        });
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get Stats
    this.app.get('/api/stats', async (req, res) => {
      try {
        if (!this.initialized) throw new Error('Not initialized');
        const stats = await this.clout!.getStats();
        res.json({ success: true, data: stats });
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get Slides (Inbox)
    this.app.get('/api/slides', async (req, res) => {
      try {
        if (!this.initialized) throw new Error('Not initialized');
        
        const inbox = await this.clout!.getInbox();
        
        const limit = parseInt(req.query.limit as string) || 50;
        
        res.json({
          success: true,
          data: {
            slides: inbox.slides.map(slide => {
              let content = '[Encrypted]';
              try {
                content = this.clout!.decryptSlide(slide);
              } catch (e) {}
              
              return {
                ...slide,
                senderShort: slide.sender.slice(0, 8),
                decryptedContent: content
              };
            }).slice(0, limit),
            totalSlides: inbox.slides.length
          }
        });
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Send Slide
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

    // Load identity
    const identity = this.identityManager.getIdentity();
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

    this.initialized = true;
    console.log(`Clout initialized with identity: ${identity.publicKey.slice(0, 16)}...`);
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
  const server = new CloutWebServer();
  server.start().catch(console.error);
}