/**
 * Clout Web UI Server
 *
 * Simple web interface for viewing feeds and creating posts
 * Now with rich media support via WNFS-based storage
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
import { StorageManager } from '../storage/wnfs-manager.js';

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
    // Support raw binary uploads for media (up to 100MB)
    this.app.use('/api/media/upload', express.raw({
      type: ['image/*', 'video/*', 'audio/*', 'application/pdf'],
      limit: '100mb'
    }));
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

    // Get Feed
    this.app.get('/api/feed', async (req, res) => {
      try {
        if (!this.initialized) throw new Error('Not initialized');

        const allPosts = await this.clout!.getFeed();

        const limit = parseInt(req.query.limit as string) || 50;
        const posts = allPosts.slice(0, limit);

        res.json({
          success: true,
          data: {
            posts: posts.map((post: any) => ({
              ...post,
              authorShort: post.author.slice(0, 8)
            })),
            totalPosts: allPosts.length
          }
        });
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Create Post (with optional media CID)
    this.app.post('/api/post', async (req, res) => {
      try {
        if (!this.initialized) throw new Error('Not initialized');
        const { content, replyTo, mediaCid } = req.body;

        // Auto-mint ticket if needed
        if (!this.clout!.hasActiveTicket()) {
          const token = await this.clout!.obtainToken();
          await this.clout!.buyDayPass(token);
        }

        // Build post options
        const options: { replyTo?: string; media?: { data: Uint8Array; mimeType: string; filename?: string } } = {};
        if (replyTo) options.replyTo = replyTo;

        // If mediaCid provided, retrieve media data to attach to post
        if (mediaCid) {
          const mediaData = await this.clout!.resolveMedia(mediaCid);
          const metadata = this.clout!.getMediaMetadata(mediaCid);
          if (mediaData && metadata) {
            options.media = {
              data: mediaData,
              mimeType: metadata.mimeType,
              filename: metadata.filename
            };
          }
        }

        const post = await this.clout!.post(content || '', options);
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

        const allPosts = await this.clout!.getFeed();

        const parentPost = allPosts.find((p: any) => p.id === postId);

        if (!parentPost) {
          return res.status(404).json({ success: false, error: 'Post not found' });
        }

        const replies = allPosts
          .filter((p: any) => p.replyTo === postId)
          .sort((a: any, b: any) => a.proof.timestamp - b.proof.timestamp);

        res.json({
          success: true,
          data: {
            parent: {
              ...parentPost,
              authorShort: parentPost.author.slice(0, 8)
            },
            replies: replies.map((post: any) => ({
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

    // =========================================================================
    // MEDIA ROUTES (WNFS-based content-addressed storage)
    // =========================================================================

    // Upload Media - returns CID for later use in posts
    this.app.post('/api/media/upload', async (req, res) => {
      try {
        if (!this.initialized) throw new Error('Not initialized');

        const contentType = req.headers['content-type'] || 'application/octet-stream';
        const filename = req.headers['x-filename'] as string | undefined;
        const data = req.body as Buffer;

        if (!data || data.length === 0) {
          return res.status(400).json({
            success: false,
            error: 'No file data received'
          });
        }

        // Store in WNFS blockstore
        const metadata = await this.clout!.storage.store(
          new Uint8Array(data),
          contentType,
          filename
        );

        console.log(`[WebServer] Media uploaded: ${metadata.cid.slice(0, 12)}... (${contentType}, ${data.length} bytes)`);

        res.json({
          success: true,
          data: metadata
        });
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get Media by CID
    this.app.get('/api/media/:cid', async (req, res) => {
      try {
        if (!this.initialized) throw new Error('Not initialized');

        const cid = req.params.cid;
        const data = await this.clout!.resolveMedia(cid);

        if (!data) {
          return res.status(404).json({
            success: false,
            error: 'Media not found'
          });
        }

        // Get metadata for content-type
        const metadata = this.clout!.getMediaMetadata(cid);
        const contentType = metadata?.mimeType || 'application/octet-stream';

        // Set appropriate headers
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', data.length);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // CIDs are immutable
        if (metadata?.filename) {
          res.setHeader('Content-Disposition', `inline; filename="${metadata.filename}"`);
        }

        res.send(Buffer.from(data));
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get Media Metadata
    this.app.get('/api/media/:cid/info', async (req, res) => {
      try {
        if (!this.initialized) throw new Error('Not initialized');

        const cid = req.params.cid;
        const metadata = this.clout!.getMediaMetadata(cid);

        if (!metadata) {
          return res.status(404).json({
            success: false,
            error: 'Media metadata not found'
          });
        }

        res.json({ success: true, data: metadata });
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get Media Stats
    this.app.get('/api/media/stats', async (req, res) => {
      try {
        if (!this.initialized) throw new Error('Not initialized');

        const stats = await this.clout!.getMediaStats();
        res.json({ success: true, data: stats });
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Check if Media Exists
    this.app.head('/api/media/:cid', async (req, res) => {
      try {
        if (!this.initialized) throw new Error('Not initialized');

        const cid = req.params.cid;
        const exists = await this.clout!.hasMedia(cid);

        if (!exists) {
          return res.status(404).end();
        }

        const metadata = this.clout!.getMediaMetadata(cid);
        if (metadata) {
          res.setHeader('Content-Type', metadata.mimeType);
          res.setHeader('Content-Length', metadata.size);
        }

        res.status(200).end();
      } catch (error: any) {
        res.status(500).end();
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
  const server = new CloutWebServer();
  server.start().catch(console.error);
}