import { Crypto } from './crypto.js';
import type { FreebirdClient, WitnessClient, Attestation } from './types.js';
import type { PostPackage, ContentGossipMessage, MediaMetadata } from './clout-types.js';
import type { CloutTicket } from './ticket-booth.js';

export interface PostConfig {
  readonly author: string;
  readonly content: string;
  readonly signature: Uint8Array;
  readonly freebird: FreebirdClient;
  readonly witness: WitnessClient;
  readonly replyTo?: string;
  readonly contentType?: string;
  readonly ephemeralPublicKey?: Uint8Array;
  readonly ephemeralKeyProof?: Uint8Array;
  /** Optional: Media metadata for posts with attached media */
  readonly media?: MediaMetadata;
  /** NSFW flag - marks content as Not Safe For Work */
  readonly nsfw?: boolean;
  /** Custom content warning text (e.g., "spoilers", "politics") */
  readonly contentWarning?: string;
  /** Public keys of users mentioned in this post */
  readonly mentions?: string[];
  /** Author's display name at time of posting */
  readonly authorDisplayName?: string;
  /** Author's avatar emoji at time of posting */
  readonly authorAvatar?: string;
}

export interface ContentGossip {
  publish(message: ContentGossipMessage): Promise<void>;
  subscribe(handler: (message: ContentGossipMessage) => Promise<void>): void;
}

export class CloutPost {
  private readonly pkg: PostPackage;
  private readonly gossip?: ContentGossip;

  private constructor(pkg: PostPackage, gossip?: ContentGossip) {
    this.pkg = pkg;
    this.gossip = gossip;
  }

  /**
   * Create a new post using a Day Pass (Ticket)
   * SIGNATURE: (config, ticket, gossip)
   */
  static async post(
    config: PostConfig,
    ticket: CloutTicket,
    gossip?: ContentGossip
  ): Promise<CloutPost> {
    // 1. Check if Ticket belongs to Author
    if (ticket.owner !== config.author) {
      throw new Error("Ticket theft detected: Owner mismatch");
    }

    // 2. Check if Ticket is Expired
    if (Date.now() > ticket.expiry) {
      throw new Error("Ticket expired. Please mint a new Day Pass.");
    }

    // 3. Verify Ticket Signature
    const ticketValid = await config.witness.verify(ticket.signature);
    if (!ticketValid) {
      throw new Error("Invalid Witness signature on ticket");
    }

    // 4. Create Content ID
    const id = Crypto.hashString(config.content);

    // 5. Serialize Ticket as Authorship Proof
    const authorshipProof = new TextEncoder().encode(JSON.stringify(ticket));

    // 6. Package post data
    const pkg: Omit<PostPackage, 'proof'> = {
      id,
      content: config.content,
      author: config.author,
      signature: config.signature,
      authorshipProof,
      replyTo: config.replyTo,
      contentType: config.contentType || 'text/plain',
      ephemeralPublicKey: config.ephemeralPublicKey,
      ephemeralKeyProof: config.ephemeralKeyProof,
      media: config.media,
      nsfw: config.nsfw,
      contentWarning: config.contentWarning,
      mentions: config.mentions,
      authorDisplayName: config.authorDisplayName,
      authorAvatar: config.authorAvatar
    };

    // 7. Hash package for timestamping (deterministic)
    const pkgHash = Crypto.hashObject(pkg);

    // 8. Timestamp the post
    const proof = await config.witness.timestamp(pkgHash);

    // 9. Create complete package
    const fullPkg: PostPackage = {
      ...pkg,
      proof
    };

    // 10. Create post instance
    const post = new CloutPost(fullPkg, gossip);

    // 11. Auto-broadcast
    if (gossip) {
      await post.broadcast();
    }

    console.log(`[CloutPost] ✅ Created post ${id.slice(0, 8)} using Day Pass`);

    return post;
  }

  /**
   * Broadcast post to gossip network
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
   * Create a reply to this post
   */
  async reply(
    content: string,
    config: Omit<PostConfig, 'content' | 'replyTo'>,
    ticket: CloutTicket,
    gossip?: ContentGossip
  ): Promise<CloutPost> {
    return CloutPost.post(
      {
        ...config,
        content,
        replyTo: this.pkg.id
      },
      ticket,
      gossip
    );
  }

  /**
   * Get post metadata
   */
  getPackage(): PostPackage {
    return { ...this.pkg };
  }
}