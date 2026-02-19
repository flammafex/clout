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
 * OpenGraph metadata for link previews
 * Embedded in posts to show rich link cards
 */
export interface OpenGraphMetadata {
  /** The original URL */
  readonly url: string;
  /** Page title from og:title or <title> */
  readonly title?: string;
  /** Page description from og:description or meta description */
  readonly description?: string;
  /** Image URL from og:image */
  readonly image?: string;
  /** Site name from og:site_name */
  readonly siteName?: string;
  /** Content type from og:type */
  readonly type?: string;
  /** When the OG data was fetched - used for decay */
  readonly fetchedAt: number;
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
  /** When you invite someone, automatically create mutual trust */
  readonly autoMutualOnInvite: boolean;

  /** Maximum pending outgoing trust requests (default: 20) */
  readonly maxPendingOutgoing: number;

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

  /**
   * Content decay settings - enables "right to be forgotten"
   * Posts older than decayAfterDays will have their content nulled
   * but envelope (id, author, signature) persists to prevent resurrection
   */
  readonly contentDecay?: {
    /** Enable automatic content decay (default: false) */
    readonly enabled: boolean;
    /** Days after which content decays (default: 90) */
    readonly decayAfterDays: number;
    /** Keep content for retracted posts longer to ensure propagation (default: 30) */
    readonly retractedDecayDays: number;
  };

}

/**
 * Default trust settings
 */
export const DEFAULT_TRUST_SETTINGS: TrustSettings = {
  autoMutualOnInvite: true,     // Invitations create mutual trust
  maxPendingOutgoing: 20,       // Max 20 pending outgoing requests
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

  /** Timestamp used in the canonical post signature payload (CLOUT_POST_V2) */
  readonly signatureTimestamp?: number;

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
   * Note: A post can have either media OR link, not both
   */
  readonly media?: MediaMetadata;

  /**
   * Optional: OpenGraph link preview metadata
   * Embedded link card with title, description, image from the URL
   * Note: A post can have either media OR link, not both
   * Link previews decay after a configurable time (fetchedAt + decayHours)
   */
  readonly link?: OpenGraphMetadata;

  /**
   * NSFW flag - marks content as Not Safe For Work
   * Users who have NSFW filtering enabled will not see this post
   * unless they explicitly opt-in to view NSFW content
   */
  readonly nsfw?: boolean;

  /**
   * Content warning - custom spoiler/warning text
   * Content is collapsed by default and shows this warning text.
   * Examples: "spoilers", "politics", "food", "flashing images"
   */
  readonly contentWarning?: string;

  /**
   * Mentions - public keys of users mentioned in this post
   * Extracted from @publicKey patterns in content during post creation
   */
  readonly mentions?: string[];

  /**
   * Edit reference - if this post is an edit of another post
   * Points to the original post ID that this supersedes
   */
  readonly editOf?: string;

  /**
   * Edit history - chain of previous versions (oldest first)
   * Populated by the system when displaying, not stored in gossip
   */
  readonly editHistory?: string[];

  /**
   * Author's display name at time of posting
   * Embedded so other users can see the author's chosen name
   */
  readonly authorDisplayName?: string;

  /**
   * Author's avatar emoji at time of posting
   * Embedded so other users can see the author's avatar
   */
  readonly authorAvatar?: string;

  /**
   * Content decay timestamp - when the content was decayed (nulled)
   * The envelope (id, author, signature, proof) persists but content is gone.
   * This enables "the right to be forgotten" while preventing resurrection.
   */
  readonly decayedAt?: number;
}

/**
 * PostDeletePackage - A signed request to retract a post
 *
 * Retraction is an act of accountability - publicly taking back what you said
 * while acknowledging it can't be truly erased. The original post still exists
 * cryptographically, but nodes that receive this signal should hide it from feeds.
 * Only the original author can sign a valid retraction request.
 *
 * Note: Type name kept as "PostDeletePackage" for wire/storage compatibility.
 */
export interface PostDeletePackage {
  /** The post ID to retract */
  readonly postId: string;

  /** Author's public key (must match original post author) */
  readonly author: string;

  /** Author's signature over { postId, deletedAt } */
  readonly signature: Uint8Array;

  /** Witness timestamp proof of retraction request */
  readonly proof: Attestation;

  /** When the retraction was requested (field name kept for wire compatibility) */
  readonly deletedAt: number;

  /** Reason for retraction */
  readonly reason?: 'retracted' | 'edited' | 'mistake' | 'other';
}

/**
 * TrustSignal - A signed statement that "I trust this person"
 *
 * This is the social equivalent of a token transfer.
 * Instead of transferring value, you're signaling trust.
 *
 * NOTE: This is the legacy plaintext format. For privacy-preserving
 * trust signals, use EncryptedTrustSignal instead.
 */
export interface TrustSignal {
  /** Who is doing the trusting */
  readonly truster: string;

  /** Who is being trusted */
  readonly trustee: string;

  /** Signature from truster */
  readonly signature: Uint8Array;

  /**
   * Canonical trust payload timestamp.
   * If present, this is the timestamp used in the signed/hash payload.
   * If absent, receivers fall back to proof.timestamp for legacy compatibility.
   */
  readonly timestamp?: number;

  /** Timestamp proof */
  readonly proof: Attestation;

  /** Trust level (0-1, default 1.0 for "follow") */
  readonly weight?: number;

  /** Optional: Can revoke trust */
  readonly revoked?: boolean;
}

/**
 * EncryptedTrustSignal - Privacy-preserving trust signal
 *
 * Hides the trustee's identity from third parties while allowing:
 * 1. The trustee to decrypt and verify they were trusted
 * 2. Third parties to detect duplicate signals (via commitment)
 * 3. Anyone to verify the truster's signature
 *
 * Privacy guarantees:
 * - Truster identity: PUBLIC (needed for signature verification)
 * - Trustee identity: ENCRYPTED (only trustee can decrypt)
 * - Trust relationship: HIDDEN (observers cannot map social graph)
 *
 * Cryptographic construction:
 * - Commitment: H(trustee || nonce) - prevents duplicate detection attacks
 * - Encryption: X25519 ECDH + XChaCha20-Poly1305 AEAD
 * - Signature: Ed25519 over (commitment || weight || timestamp)
 */
export interface EncryptedTrustSignal {
  /** Who is doing the trusting (public) */
  readonly truster: string;

  /**
   * Commitment to trustee identity: H(trustee || nonce)
   * - Allows duplicate detection without revealing trustee
   * - Nonce prevents rainbow table attacks
   */
  readonly trusteeCommitment: string;

  /**
   * Encrypted trustee data - only decryptable by the trustee
   * Contains: { trustee: string, nonce: string }
   */
  readonly encryptedTrustee: {
    /** Ephemeral X25519 public key for ECDH */
    readonly ephemeralPublicKey: Uint8Array;
    /** XChaCha20-Poly1305 ciphertext */
    readonly ciphertext: Uint8Array;
  };

  /**
   * Ed25519 signature from truster over:
   * H(trusteeCommitment || weight || timestamp)
   */
  readonly signature: Uint8Array;

  /** Timestamp proof from Witness */
  readonly proof: Attestation;

  /** Trust level (0-1, default 1.0 for "follow") */
  readonly weight?: number;

  /** Revocation flag */
  readonly revoked?: boolean;

  /** Signal version for future compatibility */
  readonly version: 'encrypted-v1';
}

/**
 * TrustRequestStatus - The state of a trust request
 *
 * From requester's perspective:
 * - pending: Waiting for response (0-7 days)
 * - ghosted: No response after 7 days (visually faded, can retry once)
 * - accepted: Trust established
 *
 * From recipient's perspective:
 * - pending: Can Accept/Reject/Ignore
 * - accepted: Trust established
 * - rejected: Blocked from re-requesting (hidden from requester as "pending/ghosted")
 */
export type TrustRequestStatus = 'pending' | 'accepted' | 'rejected' | 'ghosted';

/**
 * TrustRequest - A request to establish a trust relationship
 *
 * Implements consent-based trust to prevent stalker exploitation.
 * Alice sends a request, Bob must accept before trust is established.
 *
 * Privacy design:
 * - Rejected requests appear as "pending" to requester (no signal of rejection)
 * - After 7 days, pending requests become "ghosted" (faded visual)
 * - Requests are private between requester and recipient (not visible to others)
 */
export interface TrustRequest {
  /** Unique request ID (hash of requester + recipient + timestamp) */
  readonly id: string;

  /** Who is requesting to trust */
  readonly requester: string;

  /** Who is being requested to be trusted */
  readonly recipient: string;

  /** Requested trust weight (0.1-1.0, default 1.0) */
  readonly weight: number;

  /** When the request was created */
  readonly createdAt: number;

  /** Current status of the request */
  readonly status: TrustRequestStatus;

  /** When the status was last updated */
  readonly updatedAt: number;

  /** Number of times requester has re-requested after ghosting (max 1) */
  readonly retryCount: number;

  /** Signature from requester over { recipient, weight, createdAt } */
  readonly signature: Uint8Array;

  /** Optional: Message from requester to recipient */
  readonly message?: string;
}

/**
 * Reaction - A signed endorsement of a post
 *
 * Reactions are lightweight engagement signals (like/boost/emoji).
 * They are trust-weighted: reactions from closer users count more.
 */
export interface ReactionPackage {
  /** Unique ID (hash of postId + reactor + emoji) */
  readonly id: string;

  /** Post being reacted to */
  readonly postId: string;

  /** User reacting */
  readonly reactor: string;

  /** Reaction type (emoji like 👍, 🔥, ❤️, or keywords like 'boost') */
  readonly emoji: string;

  /** Signature from reactor */
  readonly signature: Uint8Array;

  /** Timestamp proof */
  readonly proof: Attestation;

  /** Whether this reaction has been removed */
  readonly removed?: boolean;
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
  readonly type: 'post' | 'trust' | 'trust-encrypted' | 'revoke' | 'slide' | 'reaction' | 'post-delete' | 'state-sync' | 'state-request' | 'media-request' | 'media-response';

  /** For posts */
  readonly post?: PostPackage;

  /** For trust signals (legacy plaintext format) */
  readonly trustSignal?: TrustSignal;

  /** For encrypted trust signals (privacy-preserving) */
  readonly encryptedTrustSignal?: EncryptedTrustSignal;

  /** For reactions */
  readonly reaction?: ReactionPackage;

  /** For encrypted slides */
  readonly slide?: SlidePackage;

  /** For post deletion requests */
  readonly postDelete?: PostDeletePackage;

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

  /** For requesting media from peer (P2P media fetch) */
  readonly mediaRequest?: {
    /** CID of the media being requested */
    readonly cid: string;
    /** Requester's public key */
    readonly requester: string;
    /** Post ID this media is attached to (for authorization check) */
    readonly postId: string;
  };

  /** For responding to media request */
  readonly mediaResponse?: {
    /** CID of the media */
    readonly cid: string;
    /** Media data (null if not found or not authorized) */
    readonly data: Uint8Array | null;
    /** MIME type */
    readonly mimeType?: string;
    /** Error message if request failed */
    readonly error?: string;
  };

  /** Message timestamp */
  readonly timestamp: number;
}

/**
 * SignedContentGossipMessage - Gossip message with sender authentication
 *
 * This wrapper ensures that all gossip messages are signed by their sender,
 * preventing relay impersonation and message injection attacks.
 *
 * Security guarantees:
 * - Sender identity verification: The message is signed by the sender's Ed25519 key
 * - Tamper detection: Any modification invalidates the signature
 * - Replay prevention: Nonce + timestamp ensures each message is unique
 */
export interface SignedContentGossipMessage {
  /** The original gossip message */
  readonly message: ContentGossipMessage;

  /** Sender's public key (Ed25519, hex-encoded) */
  readonly senderPublicKey: string;

  /** Ed25519 signature over the serialized message + nonce (hex-encoded) */
  readonly signature: string;

  /**
   * Unique message nonce (32 bytes, hex-encoded) - prevents replay attacks
   * Combined with timestamp to create a unique message ID for deduplication.
   */
  readonly nonce: string;

  /**
   * Message expiry timestamp - messages older than this are rejected
   * Typically set to timestamp + 5 minutes for gossip freshness
   */
  readonly expiresAt?: number;
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

  /** Reactions issued by this agent */
  myReactions: ReactionPackage[];

  /** Post deletions issued by this agent */
  myPostDeletions: PostDeletePackage[];

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
