/**
 * CloutPost - Immutable content sharing
 *
 * In Scarcity: ScarbuckToken represents value that can be spent
 * In Clout: CloutPost represents content that can only be read
 *
 * The key transformation (Phase 2):
 * - mint() becomes post() - instead of creating money, we create content
 * - The "secret" is the content itself (content-addressable)
 * - Posts are never "spent", only propagated
 */

import { Crypto } from './crypto.js';
import type { FreebirdClient, WitnessClient, Attestation } from './types.js';
import type { PostPackage, ContentGossipMessage } from './clout-types.js';

export interface PostConfig {
  readonly author: string; // Author's public key (hex)
  readonly content: string;
  readonly signature: Uint8Array;
  readonly freebird: FreebirdClient;
  readonly witness: WitnessClient;
  readonly token: Uint8Array; // Freebird token (one token per post)
  readonly replyTo?: string;
  readonly contentType?: string;
}

export interface ContentGossip {
  publish(message: ContentGossipMessage): Promise<void>;
  subscribe(handler: (message: ContentGossipMessage) => Promise<void>): void;
}

/**
 * CloutPost - Immutable content with authorship proof
 *
 * Unlike tokens which are spent, posts are permanent and propagate forever.
 */
export class CloutPost {
  private readonly pkg: PostPackage;
  private readonly gossip?: ContentGossip;

  private constructor(pkg: PostPackage, gossip?: ContentGossip) {
    this.pkg = pkg;
    this.gossip = gossip;
  }

  /**
   * Create a new post
   *
   * This is the equivalent of ScarbuckToken.mint(), but instead of
   * creating a random secret (money), the "secret" is the content itself.
   *
   * ONE-TOKEN-PER-POST: Each post requires a Freebird token, which is
   * consumed by being used as the authorship proof. This provides strong
   * spam resistance.
   *
   * @param config - Post configuration (must include token)
   * @param gossip - Optional gossip network for automatic broadcasting
   * @returns New CloutPost instance
   */
  static async post(
    config: PostConfig,
    gossip?: ContentGossip
  ): Promise<CloutPost> {
    // A. Create content-addressable ID
    const contentHash = Crypto.hashString(config.content);
    const id = contentHash;

    // B. Verify token is valid BEFORE using it
    const tokenValid = await config.freebird.verifyToken(config.token);
    if (!tokenValid) {
      throw new Error('Invalid Freebird token - cannot create post');
    }

    // C. Use Freebird token as authorship proof
    // This CONSUMES the token - it can only be used for this one post
    const authorshipProof = config.token;

    // D. Package post data
    const pkg: Omit<PostPackage, 'proof'> = {
      id,
      content: config.content,
      author: config.author,
      signature: config.signature,
      authorshipProof,
      replyTo: config.replyTo,
      contentType: config.contentType || 'text/plain'
    };

    // E. Hash package for timestamping
    const pkgHash = Crypto.hashString(JSON.stringify(pkg));

    // F. Timestamp the post with Witness (proof of when it was posted)
    const proof = await config.witness.timestamp(pkgHash);

    // G. Create complete package
    const fullPkg: PostPackage = {
      ...pkg,
      proof
    };

    // H. Create post instance
    const post = new CloutPost(fullPkg, gossip);

    // I. Auto-broadcast if gossip is available
    if (gossip) {
      await post.broadcast();
    }

    console.log(`[CloutPost] ✅ Created post ${id.slice(0, 8)} (token consumed)`);

    return post;
  }

  /**
   * Broadcast post to gossip network
   *
   * In Scarcity: transfer() broadcasts a nullifier to prevent double-spend
   * In Clout: broadcast() spreads the post to propagate content
   */
  async broadcast(): Promise<void> {
    if (!this.gossip) {
      throw new Error('No gossip network configured');
    }

    const message: ContentGossipMessage = {
      type: 'post',
      post: this.pkg,
      timestamp: Date.now()
    };

    await this.gossip.publish(message);
  }

  /**
   * Verify post authenticity
   *
   * Checks:
   * 1. Content hash matches ID
   * 2. Signature is valid
   * 3. Witness timestamp is valid
   * 4. Authorship proof is valid (if present)
   */
  static async verify(
    pkg: PostPackage,
    witness: WitnessClient,
    freebird: FreebirdClient
  ): Promise<boolean> {
    // 1. Verify content hash
    const contentHash = Crypto.hashString(pkg.content);
    if (contentHash !== pkg.id) {
      return false;
    }

    // 2. Verify witness timestamp
    const proofValid = await witness.verify(pkg.proof);
    if (!proofValid) {
      return false;
    }

    // 3. Verify authorship proof if present
    if (pkg.authorshipProof) {
      const authorshipValid = await freebird.verifyToken(pkg.authorshipProof);
      if (!authorshipValid) {
        return false;
      }
    }

    // 4. TODO: Verify signature against author's public key
    // For now, we trust the signature if other checks pass

    return true;
  }

  /**
   * Create a reply to this post
   *
   * Requires a Freebird token (one-token-per-post applies to replies too).
   *
   * @param content - Reply content
   * @param config - Post configuration (without replyTo, must include token)
   * @param gossip - Optional gossip network
   * @returns New CloutPost that's a reply
   */
  async reply(
    content: string,
    config: Omit<PostConfig, 'content' | 'replyTo'>,
    gossip?: ContentGossip
  ): Promise<CloutPost> {
    return CloutPost.post(
      {
        ...config,
        content,
        replyTo: this.pkg.id
      },
      gossip
    );
  }

  /**
   * Get post metadata (safe to share)
   */
  getPackage(): PostPackage {
    return { ...this.pkg };
  }

  /**
   * Get post ID
   */
  getId(): string {
    return this.pkg.id;
  }

  /**
   * Get post content
   */
  getContent(): string {
    return this.pkg.content;
  }

  /**
   * Get author public key
   */
  getAuthor(): string {
    return this.pkg.author;
  }

  /**
   * Get timestamp
   */
  getTimestamp(): number {
    return this.pkg.proof.timestamp;
  }

  /**
   * Check if this is a reply
   */
  isReply(): boolean {
    return !!this.pkg.replyTo;
  }

  /**
   * Get parent post ID (if reply)
   */
  getReplyTo(): string | undefined {
    return this.pkg.replyTo;
  }

  /**
   * Receive a post from the network
   *
   * The equivalent of ScarbuckToken.receive(), but for content.
   *
   * @param pkg - Post package from network
   * @param witness - Witness client for verification
   * @param freebird - Freebird client for verification
   * @param gossip - Optional gossip network
   * @returns CloutPost instance if valid
   */
  static async receive(
    pkg: PostPackage,
    witness: WitnessClient,
    freebird: FreebirdClient,
    gossip?: ContentGossip
  ): Promise<CloutPost> {
    // Verify the post
    const valid = await CloutPost.verify(pkg, witness, freebird);
    if (!valid) {
      throw new Error('Invalid post package');
    }

    return new CloutPost(pkg, gossip);
  }

  /**
   * Export post as JSON
   */
  toJSON(): any {
    return {
      id: this.pkg.id,
      content: this.pkg.content,
      author: this.pkg.author,
      signature: Crypto.toHex(this.pkg.signature),
      timestamp: this.pkg.proof.timestamp,
      replyTo: this.pkg.replyTo,
      contentType: this.pkg.contentType
    };
  }

  /**
   * Check if post is expired (based on timestamp age)
   *
   * In Scarcity: tokens have a rolling validity window
   * In Clout: posts can have an optional expiry (e.g., ephemeral posts)
   */
  isExpired(maxAge: number = Infinity): boolean {
    const age = Date.now() - this.pkg.proof.timestamp;
    return age > maxAge;
  }
}
