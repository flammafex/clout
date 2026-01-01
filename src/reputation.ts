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
  readonly selfPublicKey: string; // User's own public key (for distance 0)
  readonly trustGraph: Set<string>;
  readonly witness: WitnessClient;
  readonly maxHops?: number; // Maximum graph distance to accept (default: 3)
  readonly minReputation?: number; // Minimum reputation score (0-1, default: 0.3)
  readonly trustDecayDays?: number; // Days until trust weight decays to 50% (default: 365, 0 = no decay)
  readonly contentTypeFilters?: Record<string, { maxHops: number; minReputation: number }>; // Per-content-type filters
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
  private readonly selfPublicKey: string;
  private readonly trustGraph: Set<string>;
  private readonly witness: WitnessClient;
  private readonly maxHops: number;
  private readonly minReputation: number;
  private readonly trustDecayDays: number;
  private readonly contentTypeFilters: Record<string, { maxHops: number; minReputation: number }>;
  private readonly trustSignals = new Map<string, TrustSignal>(); // Observed trust signals

  constructor(config: ReputationConfig) {
    this.selfPublicKey = config.selfPublicKey;
    this.trustGraph = config.trustGraph;
    this.witness = config.witness;
    this.maxHops = config.maxHops ?? 3;
    this.minReputation = config.minReputation ?? 0.3;
    this.trustDecayDays = config.trustDecayDays ?? 365; // Default: 1 year half-life
    this.contentTypeFilters = config.contentTypeFilters ?? {};
  }

  /**
   * Validate a post based on author's reputation
   *
   * In Scarcity: validateTransfer() checks for double-spends
   * In Clout: validatePost() checks for trust/reputation
   *
   * Returns whether the post should be shown to the user.
   * Supports content-type-specific filtering rules.
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

    // Step 3: Get content-type-specific thresholds
    const contentType = post.contentType || 'text/plain';
    const filter = this.contentTypeFilters[contentType];
    const maxHops = filter?.maxHops ?? this.maxHops;
    const minReputation = filter?.minReputation ?? this.minReputation;

    // Step 4: Compute reputation score
    const reputation = this.computeReputation(post.author);

    // Step 5: Check if reputation meets threshold
    if (reputation.score < minReputation) {
      return {
        valid: false,
        reputation,
        reason: `Reputation ${reputation.score.toFixed(2)} below threshold ${minReputation} for ${contentType}`
      };
    }

    // Step 6: Check if within hop distance
    if (reputation.distance > maxHops) {
      return {
        valid: false,
        reputation,
        reason: `Author is ${reputation.distance} hops away (max ${maxHops} for ${contentType})`
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
   * - Distance 1 (direct follow): base = 0.9 * trust_weight
   * - Distance 2 (friend of friend): base = 0.6 * path_weight
   * - Distance 3 (3 hops): base = 0.3 * path_weight
   * - Distance 4+ (too far): score = 0.0
   *
   * Enhanced with:
   * - Custom trust weights (0.1-1.0) multiply the base scores
   * - Path diversity bonus (multiple paths increase trust)
   */
  computeReputation(publicKey: string): ReputationScore {
    // Self always has distance 0 and perfect score
    if (publicKey === this.selfPublicKey) {
      return {
        distance: 0,
        pathCount: 1,
        score: 1.0,
        visible: true
      };
    }

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

    // Find best path (highest weight, shortest distance as tiebreaker)
    const bestPath = paths.reduce((best, path) => {
      if (path.weight > best.weight) return path;
      if (path.weight === best.weight && path.hops.length < best.hops.length) return path;
      return best;
    });

    const distance = bestPath.hops.length;

    // Use the weighted score from the best path
    let score = bestPath.weight;

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
   * Calculate temporal decay multiplier for a trust signal
   *
   * Uses exponential decay with configurable half-life (trustDecayDays).
   * Formula: decay = 0.5^(age_days / half_life_days)
   *
   * Example: If trustDecayDays = 365:
   * - Fresh trust (0 days): 1.0x
   * - 1 year old: 0.5x
   * - 2 years old: 0.25x
   * - 3 years old: 0.125x
   */
  private calculateDecayMultiplier(timestamp: number): number {
    if (this.trustDecayDays === 0) {
      return 1.0; // No decay
    }

    const ageMs = Date.now() - timestamp;
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    const halfLives = ageDays / this.trustDecayDays;

    return Math.pow(0.5, halfLives);
  }

  /**
   * Calculate weight of a trust path
   *
   * Weight factors in:
   * 1. Distance-based decay: 1.0 -> 0.9 -> 0.6 -> 0.3
   * 2. Custom trust weights (0.1-1.0) - applied multiplicatively
   * 3. Temporal decay - applied only to the oldest edge in the path
   *
   * Note on temporal decay: We apply decay based only on the oldest edge
   * rather than multiplicatively. This is more intuitive because:
   * - A path is only as "fresh" as its oldest link
   * - Multiplicative decay unfairly penalizes longer paths
   * - Example: A 3-hop path with 1-year-old edges would be 0.125 (0.5³)
   *   multiplicatively, but 0.5 with oldest-edge-only approach
   */
  private calculatePathWeight(path: string[]): number {
    const distance = path.length;

    // Base score by distance
    let baseScore = 0.0;
    switch (distance) {
      case 0: baseScore = 1.0; break;
      case 1: baseScore = 0.9; break;
      case 2: baseScore = 0.6; break;
      case 3: baseScore = 0.3; break;
      default: baseScore = 0.0;
    }

    // Factor in custom trust weights along the path
    // Collect edge timestamps to find oldest edge for decay
    let weightMultiplier = 1.0;
    let previousKey = 'self';
    let oldestTimestamp: number | null = null;

    for (const currentKey of path) {
      const signalKey = `${previousKey}:${currentKey}`;
      const signal = this.trustSignals.get(signalKey);

      if (signal) {
        // Apply custom trust weight (multiplicative)
        if (signal.weight !== undefined) {
          weightMultiplier *= signal.weight;
        }

        // Track the oldest edge timestamp
        if (oldestTimestamp === null || signal.proof.timestamp < oldestTimestamp) {
          oldestTimestamp = signal.proof.timestamp;
        }
      }
      // If no signal, assume 1.0 (direct trust from local graph with no decay)

      previousKey = currentKey;
    }

    // Apply temporal decay based only on the oldest edge
    // This is more intuitive: a path is only as fresh as its oldest link
    let decayMultiplier = 1.0;
    if (oldestTimestamp !== null) {
      decayMultiplier = this.calculateDecayMultiplier(oldestTimestamp);
    }

    return baseScore * weightMultiplier * decayMultiplier;
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
      trustDecayDays: this.trustDecayDays,
      trustGraphSize: this.trustGraph.size,
      trustSignalCount: this.trustSignals.size
    };
  }

  /**
   * Get trust path to a user (public API)
   *
   * Returns the best trust path to a user, showing who vouched for them.
   * Useful for displaying "Via Alice → Bob" in the UI.
   */
  getTrustPath(publicKey: string): { path: string[]; distance: number } | null {
    const paths = this.findTrustPaths(publicKey);

    if (paths.length === 0) {
      return null;
    }

    // Find best path (shortest, then highest weight)
    const bestPath = paths.reduce((best, path) => {
      if (path.hops.length < best.hops.length) return path;
      if (path.hops.length === best.hops.length && path.weight > best.weight) return path;
      return best;
    });

    return {
      path: bestPath.hops,
      distance: bestPath.hops.length
    };
  }

  /**
   * Check if a user is directly trusted (1 hop)
   */
  isDirectlyTrusted(publicKey: string): boolean {
    return this.trustGraph.has(publicKey);
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
