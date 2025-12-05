/**
 * Type definitions for Clout - Uncensorable Reputation Protocol
 *
 * Clout inverts Scarcity's logic:
 * - Scarcity uses gossip to STOP data (prevent double-spends)
 * - Clout uses gossip to SPREAD data (posts and trust signals)
 */

import type { PublicKey, Attestation } from './types.js';

/**
 * Media metadata for content-addressed media storage
 * Used with the "Offload-and-Link" pattern for rich media posts
 */
export interface MediaMetadata {
  /** Content Identifier - content-addressed hash of the media file */
  readonly cid: string;
  /** MIME type (e.g., 'image/png', 'video/mp4') */
  readonly mimeType: string;
  /** Original filename (optional) */
  readonly filename?: string;
  /** File size in bytes */
  readonly size: number;
  /** Timestamp when media was stored */
  readonly storedAt: number;
}

/**
 * Media input for creating posts with attached media
 */
export interface MediaInput {
  /** File data as Uint8Array or Buffer */
  readonly data: Uint8Array | Buffer;
  /** MIME type of the file */
  readonly mimeType: string;
  /** Optional original filename */
  readonly filename?: string;
}

/**
 * Content-type-specific filter rules
 */
export interface ContentTypeFilter {
  /** Maximum trust distance for this content type */
  readonly maxHops: number;

  /** Minimum reputation score for this content type */
  readonly minReputation: number;
}

/**
 * Trust settings - Configurable trust behavior
 */
export interface TrustSettings {
  /** When someone trusts you, automatically trust them back */
  readonly autoFollowBack: boolean;

  /** When you invite someone, automatically create mutual trust */
  readonly autoMutualOnInvite: boolean;

  /** Require approval before accepting trust from others */
  readonly requireApproval: boolean;

  /** Maximum trust distance to display in feed (1-3) - default for all content */
  readonly maxHops: number;

  /** Minimum reputation score to show posts (0-1) - default for all content */
  readonly minReputation: number;

  /** Content-type-specific filters (e.g., 'slide', 'post', 'image/png') */
  readonly contentTypeFilters?: Record<string, ContentTypeFilter>;

  /** Whether to show NSFW content (default: false) */
  readonly showNsfw?: boolean;

  /** Minimum reputation score to show NSFW content (default: 0.7) */
  readonly nsfwMinReputation?: number;
}

/**
 * Default trust settings
 */
export const DEFAULT_TRUST_SETTINGS: TrustSettings = {
  autoFollowBack: false,        // One-way follows by default
  autoMutualOnInvite: true,     // Invitations create mutual trust
  requireApproval: false,       // Accept trust signals automatically
  maxHops: 3,                   // Show up to 3 degrees
  minReputation: 0.3,           // Minimum score of 0.3
  showNsfw: false,              // Hide NSFW by default
  nsfwMinReputation: 0.7        // Higher reputation threshold for NSFW
};

/**
 * CloutProfile - The core identity primitive
 *
 * In Scarcity, "Money" is the primitive.
 * In Clout, "Trust" is the primitive.
 */
export interface CloutProfile {
  /** Agent's public key (their unique identifier) */
  readonly publicKey: string;

  /** Web of Trust - public keys this agent trusts */
  readonly trustGraph: Set<string>;

  /** Trust settings - Configurable behavior */
  readonly trustSettings: TrustSettings;

  /** Display metadata (optional) */
  readonly metadata?: {
    readonly displayName?: string;
    readonly bio?: string;
    readonly avatar?: string;
  };

  /** Local trust tags for organizing connections (private, not synced) */
  readonly trustTags?: Map<string, Set<string>>; // tag -> Set<publicKey>
}

/**
 * Post - The "Token" equivalent for Clout
 *
 * In Scarcity, a token is spent and becomes invalid.
 * In Clout, a post is created and becomes permanently readable.
 */
export interface PostPackage {
  /** Content-addressable ID (hash of content) */
  readonly id: string;

  /** The actual content */
  readonly content: string;

  /** Author's public key (master identity key) */
  readonly author: string;

  /** Author's signature over content */
  readonly signature: Uint8Array;

  /** Witness timestamp proof (proves when it was posted) */
  readonly proof: Attestation;

  /** Optional: Freebird authorship proof */
  readonly authorshipProof?: Uint8Array;

  /** Optional: Parent post ID (for replies/threads) */
  readonly replyTo?: string;

  /** Optional: Content type (text, image, etc.) */
  readonly contentType?: string;

  /** Optional: Ephemeral public key for forward secrecy */
  readonly ephemeralPublicKey?: Uint8Array;

  /** Optional: Proof linking ephemeral key to master key (signature of ephemeral key by master key) */
  readonly ephemeralKeyProof?: Uint8Array;

  /**
   * Optional: Media metadata for posts with attached media
   * Uses "Offload-and-Link" pattern - only CID is stored in the post,
   * actual media data lives in the local WNFS blockstore
   */
  readonly media?: MediaMetadata;

  /**
   * NSFW flag - marks content as Not Safe For Work
   * Users who have NSFW filtering enabled will not see this post
   * unless they explicitly opt-in to view NSFW content
   */
  readonly nsfw?: boolean;
}

/**
 * TrustSignal - A signed statement that "I trust this person"
 *
 * This is the social equivalent of a token transfer.
 * Instead of transferring value, you're signaling trust.
 */
export interface TrustSignal {
  /** Who is doing the trusting */
  readonly truster: string;

  /** Who is being trusted */
  readonly trustee: string;

  /** Signature from truster */
  readonly signature: Uint8Array;

  /** Timestamp proof */
  readonly proof: Attestation;

  /** Trust level (0-1, default 1.0 for "follow") */
  readonly weight?: number;

  /** Optional: Can revoke trust */
  readonly revoked?: boolean;
}

/**
 * Feed - Collection of posts visible to an agent
 *
 * Each agent maintains their own subjective feed based on their trust graph.
 */
export interface Feed {
  /** Posts ordered by timestamp (newest first) */
  readonly posts: PostPackage[];

  /** Maximum graph distance to include */
  readonly maxHops: number;

  /** Last updated timestamp */
  readonly lastUpdated: number;
}

/**
 * Slide - Encrypted direct message between users
 *
 * Slides propagate through the gossip network but are only
 * readable by sender and recipient (end-to-end encrypted).
 */
export interface SlidePackage {
  /** Content-addressable ID (hash of encrypted content) */
  readonly id: string;

  /** Sender's public key */
  readonly sender: string;

  /** Recipient's public key */
  readonly recipient: string;

  /** Ephemeral public key for ECDH */
  readonly ephemeralPublicKey: Uint8Array;

  /** Encrypted message content */
  readonly ciphertext: Uint8Array;

  /** Sender's signature (over recipient + ephemeralPublicKey + ciphertext) */
  readonly signature: Uint8Array;

  /** Witness timestamp proof */
  readonly proof: Attestation;
}

/**
 * ContentGossipMessage - Gossip protocol for spreading posts
 *
 * In Scarcity: GossipMessage spreads nullifiers to detect double-spends
 * In Clout: ContentGossipMessage spreads posts to propagate content
 */
export interface ContentGossipMessage {
  readonly type: 'post' | 'trust' | 'revoke' | 'slide' | 'state-sync' | 'state-request';

  /** For posts */
  readonly post?: PostPackage;

  /** For trust signals */
  readonly trustSignal?: TrustSignal;

  /** For encrypted slides */
  readonly slide?: SlidePackage;

  /** For CRDT state synchronization */
  readonly stateSync?: {
    readonly publicKey: string;
    readonly stateBinary: Uint8Array;
    readonly version: number;
  };

  /** For requesting peer state */
  readonly stateRequest?: {
    readonly publicKey: string;
    readonly currentVersion: number;
  };

  /** Message timestamp */
  readonly timestamp: number;
}

/**
 * ReputationScore - Computed reputation for a user
 *
 * In Scarcity: Validator computes confidence score for transfers
 * In Clout: Validator computes reputation score based on graph distance
 */
export interface ReputationScore {
  /** Graph distance from current user (0 = self, 1 = direct follow, etc.) */
  readonly distance: number;

  /** Number of trust paths to this user */
  readonly pathCount: number;

  /** Weighted trust score (0-1) */
  readonly score: number;

  /** Whether this user is visible in feed */
  readonly visible: boolean;
}

/**
 * Inbox - Collection of received slides (encrypted messages)
 */
export interface Inbox {
  /** Received slides ordered by timestamp (newest first) */
  readonly slides: SlidePackage[];

  /** Last updated timestamp */
  readonly lastUpdated: number;
}

/**
 * CloutState - State synchronized via Chronicle CRDT
 *
 * Each agent's profile and feed state that can be merged P2P.
 */
export interface CloutState {
  // --- ADD THIS LINE ---
  [key: string]: any; 

  /** Current agent's profile */
  profile?: CloutProfile;

  /** Posts authored by this agent */
  myPosts: PostPackage[];

  /** Trust signals issued by this agent */
  myTrustSignals: TrustSignal[];

  /** Last sync timestamp */
  lastSync?: number;
}

export interface CloutStore {
  /** Persist a post to the local feed cache */
  addPost(post: PostPackage): Promise<void>;
  
  /** Retrieve the local feed cache */
  getFeed(): Promise<PostPackage[]>;
  
  /** Persist a received slide to the local inbox */
  addSlide(slide: SlidePackage): Promise<void>;
  
  /** Retrieve the local inbox */
  getInbox(): Promise<SlidePackage[]>;
  
  /** Initialize storage (load from disk/db) */
  init(): Promise<void>;
}
