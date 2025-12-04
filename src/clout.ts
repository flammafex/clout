/**
 * Clout - Uncensorable Reputation Protocol
 *
 * The complete protocol assembled from all 5 phases:
 * 1. Trust (Identity)
 * 2. Post (Content)
 * 3. ContentGossip (Propagation)
 * 4. Reputation (Filtering)
 * 5. State Sync (CRDT)
 *
 * This is the inversion of Scarcity:
 * - Scarcity: Gossip to STOP data (prevent double-spends)
 * - Clout: Gossip to SPREAD data (propagate posts)
 */

import { CloutIdentity } from './identity.js';
import { CloutPost } from './post.js';
import { ContentGossip } from './content-gossip.js';
import { ReputationValidator } from './reputation.js';
import { CloutStateManager } from './chronicle/clout-state.js';
import { CloutNode } from './network/clout-node.js';
import { Crypto } from './crypto.js';

import type { FreebirdClient, WitnessClient, PublicKey } from './types.js';
import type {
  CloutProfile,
  PostPackage,
  TrustSignal,
  ContentGossipMessage,
  Feed
} from './clout-types.js';
import type { NodeType } from './network-types.js';

export interface CloutConfig {
  readonly publicKey: PublicKey;
  readonly privateKey: Uint8Array;
  readonly freebird: FreebirdClient;
  readonly witness: WitnessClient;
  readonly maxHops?: number;
  readonly minReputation?: number;

  /** Network configuration (optional - for P2P networking) */
  readonly network?: {
    readonly nodeType?: NodeType;
    readonly relayServers?: string[];
    readonly enableDHT?: boolean;
    readonly maxPeers?: number;
    readonly listenPort?: number;
  };
}

/**
 * Clout - The main protocol class
 *
 * Combines all phases into a unified uncensorable social protocol.
 */
export class Clout {
  private readonly identity: CloutIdentity;
  private readonly gossip: ContentGossip;
  private readonly validator: ReputationValidator;
  private readonly state: CloutStateManager;
  private readonly witness: WitnessClient;
  private readonly freebird: FreebirdClient;
  private readonly node?: CloutNode;
  private readonly publicKeyHex: string;

  constructor(config: CloutConfig) {
    this.freebird = config.freebird;
    this.witness = config.witness;
    this.publicKeyHex = Crypto.toHex(config.publicKey.bytes);

    // Phase 1: Identity & Trust
    this.identity = new CloutIdentity({
      publicKey: config.publicKey,
      privateKey: config.privateKey,
      freebird: config.freebird
    });

    // Phase 5: State Management
    this.state = new CloutStateManager();

    // Initialize with identity profile
    this.state.updateProfile(this.identity.getProfile());

    // Phase 3: Content Gossip
    this.gossip = new ContentGossip({
      witness: config.witness,
      freebird: config.freebird,
      trustGraph: this.identity.getProfile().trustGraph,
      maxHops: config.maxHops
    });

    // Phase 4: Reputation Validator
    this.validator = new ReputationValidator({
      trustGraph: this.identity.getProfile().trustGraph,
      witness: config.witness,
      maxHops: config.maxHops,
      minReputation: config.minReputation
    });

    // Set up gossip message handler
    this.gossip.setReceiveHandler(async (message) => {
      await this.handleGossipMessage(message);
    });

    // Phase 6: P2P Network (optional)
    if (config.network) {
      this.node = new CloutNode({
        publicKey: this.publicKeyHex,
        trustGraph: this.identity.getProfile().trustGraph,
        nodeType: config.network.nodeType || 'light' as NodeType,
        relayServers: config.network.relayServers,
        enableDHT: config.network.enableDHT,
        maxPeers: config.network.maxPeers,
        listenPort: config.network.listenPort,
        onMessage: async (peer, message) => {
          // Messages from P2P network flow into gossip layer
          await this.gossip.onReceive(message, peer.id);
        }
      });
    }
  }

  /**
   * Start P2P networking
   */
  async startNetwork(): Promise<void> {
    if (!this.node) {
      console.warn('[Clout] No network configuration provided');
      return;
    }

    await this.node.start();
    console.log('[Clout] Network started');
  }

  /**
   * Stop P2P networking
   */
  async stopNetwork(): Promise<void> {
    if (this.node) {
      await this.node.stop();
    }
  }

  /**
   * Post content to the network
   *
   * Phase 2: Create and broadcast a post
   */
  async post(content: string, replyTo?: string): Promise<CloutPost> {
    const publicKeyHex = this.identity.getPublicKeyHex();

    // Sign content
    const contentHash = Crypto.hashString(content);
    const signature = await this.identity.signContent(contentHash);

    // Create post
    const post = await CloutPost.post(
      {
        author: publicKeyHex,
        content,
        signature,
        freebird: this.freebird,
        witness: this.witness,
        replyTo
      },
      this.gossip
    );

    // Add to state
    this.state.addPost(post.getPackage());

    return post;
  }

  /**
   * Trust another user
   *
   * Phase 1: Add to trust graph and broadcast trust signal
   */
  async trust(publicKey: string): Promise<void> {
    // Update local trust graph
    this.identity.trust(publicKey);

    // Update profile in state
    this.state.updateProfile(this.identity.getProfile());

    // Update gossip and validator
    this.gossip.updateTrustGraph(this.identity.getProfile().trustGraph);
    this.validator.updateTrustGraph(this.identity.getProfile().trustGraph);

    // Update P2P network (connect to newly trusted peer)
    if (this.node) {
      await this.node.updateTrustGraph(this.identity.getProfile().trustGraph);
    }

    // Create trust signal
    const signal: TrustSignal = {
      truster: this.identity.getPublicKeyHex(),
      trustee: publicKey,
      signature: new Uint8Array(), // TODO: Implement proper signature
      proof: await this.witness.timestamp(
        Crypto.hashString(`${this.identity.getPublicKeyHex()}:${publicKey}`)
      )
    };

    // Add to state
    this.state.addTrustSignal(signal);

    // Broadcast trust signal via gossip
    await this.gossip.publish({
      type: 'trust',
      trustSignal: signal,
      timestamp: Date.now()
    });

    // Broadcast via P2P network if available
    if (this.node) {
      await this.node.broadcast({
        type: 'trust',
        trustSignal: signal,
        timestamp: Date.now()
      });
    }

    // Add to validator's trust signal cache
    this.validator.addTrustSignal(signal);
  }

  /**
   * Untrust a user
   */
  async untrust(publicKey: string): Promise<void> {
    this.identity.untrust(publicKey);

    // Update state
    this.state.updateProfile(this.identity.getProfile());

    // Update gossip and validator
    this.gossip.updateTrustGraph(this.identity.getProfile().trustGraph);
    this.validator.updateTrustGraph(this.identity.getProfile().trustGraph);

    // Update P2P network (disconnect from untrusted peer)
    if (this.node) {
      await this.node.updateTrustGraph(this.identity.getProfile().trustGraph);
    }

    // Broadcast revocation
    const signal: TrustSignal = {
      truster: this.identity.getPublicKeyHex(),
      trustee: publicKey,
      signature: new Uint8Array(),
      proof: await this.witness.timestamp(
        Crypto.hashString(`${this.identity.getPublicKeyHex()}:REVOKE:${publicKey}`)
      ),
      revoked: true
    };

    await this.gossip.publish({
      type: 'revoke',
      trustSignal: signal,
      timestamp: Date.now()
    });
  }

  /**
   * Get your feed
   *
   * Phase 3 & 4: Retrieve posts filtered by trust graph
   */
  getFeed(): Feed {
    const posts = this.gossip.getFeed();

    return {
      posts,
      maxHops: this.validator.getConfig().maxHops,
      lastUpdated: Date.now()
    };
  }

  /**
   * Get posts by a specific author
   */
  getPostsByAuthor(author: string): PostPackage[] {
    return this.gossip.getPostsByAuthor(author);
  }

  /**
   * Get a specific post by ID
   */
  getPost(id: string): PostPackage | undefined {
    return this.gossip.getPost(id);
  }

  /**
   * Get current profile
   */
  getProfile(): CloutProfile {
    return this.identity.getProfile();
  }

  /**
   * Update profile metadata
   */
  updateProfile(metadata: { displayName?: string; bio?: string; avatar?: string }): void {
    this.identity.updateMetadata(metadata);
    this.state.updateProfile(this.identity.getProfile());
  }

  /**
   * Get reputation for a user
   */
  getReputation(publicKey: string) {
    return this.validator.computeReputation(publicKey);
  }

  /**
   * Validate a post
   */
  async validatePost(post: PostPackage) {
    return await this.validator.validatePost(post);
  }

  /**
   * Handle incoming gossip messages
   *
   * Validates and processes posts/trust signals from the network.
   */
  private async handleGossipMessage(message: ContentGossipMessage): Promise<void> {
    if (message.type === 'post' && message.post) {
      // Validate post
      const validation = await this.validator.validatePost(message.post);

      if (validation.valid) {
        console.log(
          `[Clout] ✅ Accepted post from ${message.post.author.slice(0, 8)} ` +
          `(reputation: ${validation.reputation.score.toFixed(2)})`
        );
      } else {
        console.log(
          `[Clout] ❌ Rejected post from ${message.post.author.slice(0, 8)} ` +
          `(${validation.reason})`
        );
      }
    } else if (message.type === 'trust' && message.trustSignal) {
      // Add trust signal to validator
      this.validator.addTrustSignal(message.trustSignal);

      console.log(
        `[Clout] Trust signal: ${message.trustSignal.truster.slice(0, 8)} -> ` +
        `${message.trustSignal.trustee.slice(0, 8)}`
      );
    }
  }

  /**
   * Export state for backup/sync
   */
  exportState(): string {
    return this.state.toJSON();
  }

  /**
   * Import state from backup/sync
   */
  importState(json: string): void {
    const imported = CloutStateManager.fromJSON(json);
    this.state.import(imported.export());
  }

  /**
   * Merge state from another peer
   */
  mergeState(remoteState: any): void {
    this.state.merge(remoteState.state, remoteState.version);
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      identity: {
        publicKey: this.identity.getPublicKeyHex(),
        trustCount: this.identity.getTrustCount()
      },
      gossip: this.gossip.getStats(),
      validator: this.validator.getConfig(),
      state: {
        version: this.state.getVersion(),
        postCount: this.state.getState().myPosts.length,
        trustSignalCount: this.state.getState().myTrustSignals.length
      }
    };
  }

  /**
   * Add peer connection
   */
  addPeer(peer: any): void {
    this.gossip.addPeer(peer);
  }

  /**
   * Remove peer connection
   */
  removePeer(peerId: string): void {
    this.gossip.removePeer(peerId);
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.gossip.destroy();
  }
}

// Export all types and classes
export { CloutIdentity } from './identity.js';
export { CloutPost } from './post.js';
export { ContentGossip } from './content-gossip.js';
export { ReputationValidator } from './reputation.js';
export { CloutStateManager } from './chronicle/clout-state.js';
export * from './clout-types.js';
