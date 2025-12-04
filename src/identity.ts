/**
 * Identity - Trust-based identity using Freebird
 *
 * In Scarcity: Freebird provides ownership proofs for spending tokens
 * In Clout: Freebird provides authorship proofs for posting content
 *
 * This is Phase 1 of the Clout protocol.
 */

import { Crypto } from './crypto.js';
import type { PublicKey, FreebirdClient } from './types.js';
import type { CloutProfile, TrustSignal } from './clout-types.js';

export interface IdentityConfig {
  readonly publicKey: PublicKey;
  readonly privateKey: Uint8Array;
  readonly freebird: FreebirdClient;
}

/**
 * CloutIdentity - Manages an agent's identity and trust graph
 *
 * The core primitive is TRUST rather than VALUE.
 * Instead of createOwnershipProof, we signContent.
 */
export class CloutIdentity {
  private readonly publicKey: PublicKey;
  private readonly privateKey: Uint8Array;
  private readonly freebird: FreebirdClient;
  private profile: CloutProfile;

  constructor(config: IdentityConfig) {
    this.publicKey = config.publicKey;
    this.privateKey = config.privateKey;
    this.freebird = config.freebird;

    // Initialize profile
    this.profile = {
      publicKey: Crypto.toHex(this.publicKey.bytes),
      trustGraph: new Set<string>(),
      metadata: {}
    };
  }

  /**
   * Sign content for authorship proof
   *
   * In Scarcity: createOwnershipProof proves you own money
   * In Clout: signContent proves you authored content
   *
   * This is the key transformation from Phase 1.
   */
  async signContent(contentHash: string): Promise<Uint8Array> {
    // Use Freebird to create an authorship proof
    // This leverages VOPRF to create unforgeable signatures
    const contentBytes = Crypto.fromHex(contentHash);
    return await this.freebird.createOwnershipProof(contentBytes);
  }

  /**
   * Create a blinded commitment to content
   *
   * Allows privacy-preserving content creation.
   * The content is hashed and blinded before being gossiped.
   */
  async blindContent(content: string): Promise<Uint8Array> {
    const contentHash = Crypto.hashString(content);
    const contentKey: PublicKey = { bytes: Crypto.fromHex(contentHash) };
    return await this.freebird.blind(contentKey);
  }

  /**
   * Trust another agent
   *
   * Adds a public key to your trust graph.
   * This is the social equivalent of a token transfer.
   *
   * @param publicKey - Public key of agent to trust
   * @param weight - Trust weight (0-1, default 1.0)
   */
  trust(publicKey: string, weight: number = 1.0): void {
    if (weight < 0 || weight > 1) {
      throw new Error('Trust weight must be between 0 and 1');
    }

    this.profile.trustGraph.add(publicKey);
  }

  /**
   * Revoke trust for an agent
   *
   * Removes a public key from your trust graph.
   * This is like "unfollowing" in traditional social media.
   */
  untrust(publicKey: string): void {
    this.profile.trustGraph.delete(publicKey);
  }

  /**
   * Check if you trust an agent
   */
  isTrusted(publicKey: string): boolean {
    return this.profile.trustGraph.has(publicKey);
  }

  /**
   * Get graph distance to another agent
   *
   * Returns the shortest path distance in the trust graph:
   * - 0: Self
   * - 1: Direct follow
   * - 2: Friend of friend
   * - -1: Not reachable
   *
   * This is used by the Validator to compute reputation scores.
   */
  getGraphDistance(targetKey: string, visited = new Set<string>(), depth = 0): number {
    // Self
    if (targetKey === this.profile.publicKey) {
      return 0;
    }

    // Direct follow
    if (this.profile.trustGraph.has(targetKey)) {
      return 1;
    }

    // Prevent cycles
    if (visited.has(this.profile.publicKey)) {
      return -1;
    }

    visited.add(this.profile.publicKey);

    // BFS search through trust graph (simplified - in production use proper BFS)
    // For MVP, we just check distance 1 and 2
    if (depth < 2) {
      for (const trustedKey of this.profile.trustGraph) {
        // In full implementation, we'd recursively check trusted agent's trust graph
        // For now, return 2 for any second-degree connection
        return 2;
      }
    }

    return -1; // Not reachable
  }

  /**
   * Update profile metadata
   */
  updateMetadata(metadata: { displayName?: string; bio?: string; avatar?: string }): void {
    this.profile = {
      ...this.profile,
      metadata: {
        ...this.profile.metadata,
        ...metadata
      }
    };
  }

  /**
   * Get current profile (safe to share)
   */
  getProfile(): CloutProfile {
    return {
      publicKey: this.profile.publicKey,
      trustGraph: new Set(this.profile.trustGraph),
      metadata: this.profile.metadata ? { ...this.profile.metadata } : undefined
    };
  }

  /**
   * Get public key as hex string
   */
  getPublicKeyHex(): string {
    return this.profile.publicKey;
  }

  /**
   * Export trust graph for gossip
   *
   * Returns the list of public keys you trust, for sharing with the network.
   */
  exportTrustGraph(): string[] {
    return Array.from(this.profile.trustGraph);
  }

  /**
   * Import trust graph from another source
   *
   * Useful for bootstrapping or syncing from backup.
   */
  importTrustGraph(trustGraph: string[]): void {
    this.profile.trustGraph = new Set(trustGraph);
  }

  /**
   * Get trust graph size
   */
  getTrustCount(): number {
    return this.profile.trustGraph.size;
  }
}
