/**
 * Type definitions for Clout - Uncensorable Reputation Protocol
 *
 * Clout inverts Scarcity's logic:
 * - Scarcity uses gossip to STOP data (prevent double-spends)
 * - Clout uses gossip to SPREAD data (posts and trust signals)
 */

import type { PublicKey, Attestation } from './types.js';

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

  /** Maximum trust distance to display in feed (1-3) */
  readonly maxHops: number;

  /** Minimum reputation score to show posts (0-1) */
  readonly minReputation: number;
}

/**
 * Default trust settings
 */
export const DEFAULT_TRUST_SETTINGS: TrustSettings = {
  autoFollowBack: false,        // One-way follows by default
  autoMutualOnInvite: true,     // Invitations create mutual trust
  requireApproval: false,       // Accept trust signals automatically
  maxHops: 3,                   // Show up to 3 degrees
  minReputation: 0.3            // Minimum score of 0.3
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

  /** Author's public key */
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
 * ContentGossipMessage - Gossip protocol for spreading posts
 *
 * In Scarcity: GossipMessage spreads nullifiers to detect double-spends
 * In Clout: ContentGossipMessage spreads posts to propagate content
 */
export interface ContentGossipMessage {
  readonly type: 'post' | 'trust' | 'revoke';

  /** For posts */
  readonly post?: PostPackage;

  /** For trust signals */
  readonly trustSignal?: TrustSignal;

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
 * CloutState - State synchronized via Chronicle CRDT
 *
 * Each agent's profile and feed state that can be merged P2P.
 */
export interface CloutState {
  /** Current agent's profile */
  profile?: CloutProfile;

  /** Posts authored by this agent */
  myPosts: PostPackage[];

  /** Trust signals issued by this agent */
  myTrustSignals: TrustSignal[];

  /** Cached feed (computed from trust graph) */
  feed?: Feed;

  /** Last sync timestamp */
  lastSync?: number;
}
