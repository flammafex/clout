/**
 * ReputationValidator: Trust-based content filtering
 *
 * The key transformation (Phase 4):
 * - Scarcity: TransferValidator checks if money is fake (double-spend)
 * - Clout: ReputationValidator checks if content is "spam" or "untrusted"
 *
 * Instead of calculating confidence scores for transfers,
 * we calculate reputation scores based on graph distance.
 */

import type { WitnessClient } from './types.js';
import type { PostPackage, ReputationScore, TrustSignal } from './clout-types.js';

export interface ReputationConfig {
  readonly trustGraph: Set<string>;
  readonly witness: WitnessClient;
  readonly maxHops?: number; // Maximum graph distance to accept (default: 3)
  readonly minReputation?: number; // Minimum reputation score (0-1, default: 0.3)
}

interface TrustPath {
  readonly hops: string[]; // Chain of public keys
  readonly weight: number; // Accumulated trust weight
}

/**
 * ReputationValidator - Compute trust scores based on social graph
 *
 * In Scarcity: Validator prevents double-spends using confidence scores
 * In Clout: Validator filters spam using reputation scores
 */
export class ReputationValidator {
  private readonly trustGraph: Set<string>;
  private readonly witness: WitnessClient;
  private readonly maxHops: number;
  private readonly minReputation: number;
  private readonly trustSignals = new Map<string, TrustSignal>(); // Observed trust signals

  constructor(config: ReputationConfig) {
    this.trustGraph = config.trustGraph;
    this.witness = config.witness;
    this.maxHops = config.maxHops ?? 3;
    this.minReputation = config.minReputation ?? 0.3;
  }

  /**
   * Validate a post based on author's reputation
   *
   * In Scarcity: validateTransfer() checks for double-spends
   * In Clout: validatePost() checks for trust/reputation
   *
   * Returns whether the post should be shown to the user.
   */
  async validatePost(post: PostPackage): Promise<{
    valid: boolean;
    reputation: ReputationScore;
    reason?: string;
  }> {
    // Step 1: Verify witness timestamp
    const proofValid = await this.witness.verify(post.proof);
    if (!proofValid) {
      return {
        valid: false,
        reputation: this.getDefaultScore(),
        reason: 'Invalid witness attestation'
      };
    }

    // Step 2: Check post age (optional - prevent ancient spam)
    const age = Date.now() - post.proof.timestamp;
    const MAX_POST_AGE = 365 * 24 * 3600 * 1000; // 1 year
    if (age > MAX_POST_AGE) {
      return {
        valid: false,
        reputation: this.getDefaultScore(),
        reason: `Post too old (${(age / 86400000).toFixed(0)} days)`
      };
    }

    // Step 3: Compute reputation score
    const reputation = this.computeReputation(post.author);

    // Step 4: Check if reputation meets threshold
    if (reputation.score < this.minReputation) {
      return {
        valid: false,
        reputation,
        reason: `Reputation ${reputation.score.toFixed(2)} below threshold ${this.minReputation}`
      };
    }

    // Step 5: Check if within hop distance
    if (reputation.distance > this.maxHops) {
      return {
        valid: false,
        reputation,
        reason: `Author is ${reputation.distance} hops away (max ${this.maxHops})`
      };
    }

    return {
      valid: true,
      reputation,
      reason: 'Post validated successfully'
    };
  }

  /**
   * Compute reputation score for a user
   *
   * In Scarcity: computeConfidence() uses peer count and witness depth
   * In Clout: computeReputation() uses graph distance and trust paths
   *
   * Scoring:
   * - Distance 0 (self): score = 1.0
   * - Distance 1 (direct follow): score = 0.9
   * - Distance 2 (friend of friend): score = 0.6
   * - Distance 3 (3 hops): score = 0.3
   * - Distance 4+ (too far): score = 0.0
   */
  computeReputation(publicKey: string): ReputationScore {
    // Find all paths to this user
    const paths = this.findTrustPaths(publicKey);

    if (paths.length === 0) {
      // Not reachable
      return {
        distance: 999,
        pathCount: 0,
        score: 0.0,
        visible: false
      };
    }

    // Find shortest path
    const shortestPath = paths.reduce((min, path) =>
      path.hops.length < min.hops.length ? path : min
    );

    const distance = shortestPath.hops.length;

    // Compute score based on distance and path diversity
    let score = 0.0;

    switch (distance) {
      case 0: // Self
        score = 1.0;
        break;
      case 1: // Direct follow
        score = 0.9;
        break;
      case 2: // Friend of friend
        score = 0.6;
        break;
      case 3: // 3 hops
        score = 0.3;
        break;
      default: // Too far
        score = 0.0;
    }

    // Boost score based on path diversity (multiple paths = more trustworthy)
    const diversityBonus = Math.min(paths.length * 0.05, 0.2);
    score = Math.min(score + diversityBonus, 1.0);

    return {
      distance,
      pathCount: paths.length,
      score,
      visible: distance <= this.maxHops
    };
  }

  /**
   * Find all trust paths to a user (BFS)
   *
   * Returns all paths within maxHops distance.
   */
  private findTrustPaths(targetKey: string, maxDepth = this.maxHops): TrustPath[] {
    const paths: TrustPath[] = [];
    const visited = new Set<string>();

    // BFS queue: [currentKey, path, depth]
    const queue: Array<[string, string[], number]> = [['self', [], 0]];

    while (queue.length > 0) {
      const [currentKey, path, depth] = queue.shift()!;

      // Found target
      if (currentKey === targetKey) {
        paths.push({
          hops: path,
          weight: this.calculatePathWeight(path)
        });
        continue;
      }

      // Max depth reached
      if (depth >= maxDepth) {
        continue;
      }

      // Avoid cycles
      if (visited.has(currentKey)) {
        continue;
      }
      visited.add(currentKey);

      // Explore neighbors
      const neighbors = this.getTrustedNeighbors(currentKey);
      for (const neighbor of neighbors) {
        queue.push([neighbor, [...path, neighbor], depth + 1]);
      }
    }

    return paths;
  }

  /**
   * Get list of users trusted by a given user
   */
  private getTrustedNeighbors(publicKey: string): string[] {
    if (publicKey === 'self') {
      return Array.from(this.trustGraph);
    }

    // In production, we'd query the trust signals to build the full graph
    // For now, we only have direct follows from local trust graph
    const neighbors: string[] = [];

    for (const [key, signal] of this.trustSignals.entries()) {
      const [truster, trustee] = key.split(':');
      if (truster === publicKey && !signal.revoked) {
        neighbors.push(trustee);
      }
    }

    return neighbors;
  }

  /**
   * Calculate weight of a trust path
   *
   * Weight decays with distance: 1.0 -> 0.9 -> 0.6 -> 0.3
   */
  private calculatePathWeight(path: string[]): number {
    const distance = path.length;

    switch (distance) {
      case 0: return 1.0;
      case 1: return 0.9;
      case 2: return 0.6;
      case 3: return 0.3;
      default: return 0.0;
    }
  }

  /**
   * Update local trust graph
   */
  updateTrustGraph(newTrustGraph: Set<string>): void {
    this.trustGraph.clear();
    for (const key of newTrustGraph) {
      this.trustGraph.add(key);
    }
  }

  /**
   * Add observed trust signal to expand graph knowledge
   *
   * This allows us to compute 2+ hop distances.
   */
  addTrustSignal(signal: TrustSignal): void {
    const key = `${signal.truster}:${signal.trustee}`;

    if (signal.revoked) {
      this.trustSignals.delete(key);
    } else {
      this.trustSignals.set(key, signal);
    }
  }

  /**
   * Get trust signals
   */
  getTrustSignals(): TrustSignal[] {
    return Array.from(this.trustSignals.values());
  }

  /**
   * Fast validation without graph traversal
   *
   * Just checks if author is directly trusted (1 hop).
   * Useful for quick filtering.
   */
  fastValidate(post: PostPackage): boolean {
    return this.trustGraph.has(post.author);
  }

  /**
   * Get reputation for multiple users (batch)
   */
  computeBatchReputation(publicKeys: string[]): Map<string, ReputationScore> {
    const results = new Map<string, ReputationScore>();

    for (const key of publicKeys) {
      results.set(key, this.computeReputation(key));
    }

    return results;
  }

  /**
   * Get all visible authors (within trust graph)
   */
  getVisibleAuthors(): string[] {
    const visible: string[] = [];

    // Add direct follows
    for (const key of this.trustGraph) {
      visible.push(key);
    }

    // Add 2-hop connections
    for (const [signalKey] of this.trustSignals.entries()) {
      const [truster, trustee] = signalKey.split(':');
      if (this.trustGraph.has(truster)) {
        visible.push(trustee);
      }
    }

    return [...new Set(visible)]; // Deduplicate
  }

  /**
   * Get configuration
   */
  getConfig() {
    return {
      maxHops: this.maxHops,
      minReputation: this.minReputation,
      trustGraphSize: this.trustGraph.size,
      trustSignalCount: this.trustSignals.size
    };
  }

  /**
   * Default reputation score for invalid/unknown users
   */
  private getDefaultScore(): ReputationScore {
    return {
      distance: 999,
      pathCount: 0,
      score: 0.0,
      visible: false
    };
  }

  /**
   * Update minimum reputation threshold
   */
  setMinReputation(reputation: number): void {
    if (reputation < 0 || reputation > 1) {
      throw new Error('Reputation must be between 0 and 1');
    }
    (this as any).minReputation = reputation;
  }

  /**
   * Update maximum hop distance
   */
  setMaxHops(hops: number): void {
    if (hops < 1) {
      throw new Error('Max hops must be at least 1');
    }
    (this as any).maxHops = hops;
  }
}
