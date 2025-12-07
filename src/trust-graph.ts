/**
 * TrustGraph: Shared trust graph with incremental hop distance computation
 *
 * This class provides a single source of truth for trust graph computations,
 * eliminating duplicate BFS traversals across ContentGossip and ReputationValidator.
 *
 * Key features:
 * - O(1) hop distance lookups via incrementally maintained cache
 * - Adjacency list for efficient neighbor lookups
 * - Event callbacks for persistence
 *
 * Privacy note on encrypted trust signals:
 * When useEncryptedTrustSignals is true (default), nodes that aren't the trustee
 * of an encrypted trust signal cannot see that edge. This is a deliberate privacy
 * tradeoff - the social graph is hidden from third parties, but hop distance
 * calculations may be incomplete. Communities preferring transparency over privacy
 * can set useEncryptedTrustSignals: false to use plaintext signals where the full
 * graph is visible to all nodes.
 */

import type { TrustSignal } from './clout-types.js';

export interface TrustGraphConfig {
  /** Our public key (for distance 0) */
  readonly selfPublicKey: string;

  /** Initial direct trust set (distance 1) */
  readonly directTrust?: Set<string>;

  /** Maximum hop distance to track (default: 3) */
  readonly maxHops?: number;

  /** Callback when trust edges change (for persistence) */
  readonly onTrustEdge?: (truster: string, trustee: string) => void;

  /** Initial trust graph from persistence (Map of truster -> Set of trustees) */
  readonly persistedTrustGraph?: Map<string, Set<string>>;
}

export interface TrustPath {
  readonly hops: string[];
  readonly weight: number;
}

/**
 * TrustGraph - Centralized trust graph with incremental caching
 *
 * Uses an incrementally maintained hop distance cache for O(1) lookups,
 * rather than O(n) BFS traversal on every query.
 */
export class TrustGraph {
  private readonly selfPublicKey: string;
  private readonly directTrust: Set<string>;
  private readonly maxHops: number;
  private readonly onTrustEdge?: (truster: string, trustee: string) => void;

  // Incremental caches
  private readonly adjacencyList = new Map<string, Set<string>>();
  private readonly hopDistanceCache = new Map<string, number>();

  // Trust signals with metadata (for weighted path calculations)
  private readonly trustSignals = new Map<string, TrustSignal>();

  constructor(config: TrustGraphConfig) {
    this.selfPublicKey = config.selfPublicKey;
    this.directTrust = config.directTrust ?? new Set();
    this.maxHops = config.maxHops ?? 3;
    this.onTrustEdge = config.onTrustEdge;

    // Initialize hop distance cache with direct trust (distance 1)
    for (const trustedKey of this.directTrust) {
      this.hopDistanceCache.set(trustedKey, 1);
    }

    // Load persisted trust graph if provided
    if (config.persistedTrustGraph) {
      for (const [truster, trustees] of config.persistedTrustGraph) {
        for (const trustee of trustees) {
          this.updateCaches(truster, trustee);
        }
      }
    }
  }

  /**
   * Get hop distance to a public key
   *
   * O(1) lookup using incrementally maintained cache.
   *
   * @returns hop distance (0 = self, 1 = direct, 2+ = indirect, 999 = unreachable)
   */
  getHopDistance(publicKey: string): number {
    // Self is always distance 0
    if (publicKey === this.selfPublicKey) {
      return 0;
    }

    // Direct trust is distance 1
    if (this.directTrust.has(publicKey)) {
      return 1;
    }

    // Check cache for 2+ hop distances
    return this.hopDistanceCache.get(publicKey) ?? 999;
  }

  /**
   * Check if a public key is within our trust horizon
   */
  isWithinHorizon(publicKey: string): boolean {
    return this.getHopDistance(publicKey) <= this.maxHops;
  }

  /**
   * Add a trust edge to the graph
   *
   * Incrementally updates the hop distance cache.
   *
   * @param truster - Who is doing the trusting
   * @param trustee - Who is being trusted
   * @param signal - Optional full trust signal (for weighted calculations)
   */
  addTrustEdge(truster: string, trustee: string, signal?: TrustSignal): void {
    // Store signal if provided
    if (signal) {
      const key = `${truster}:${trustee}`;
      if (signal.revoked) {
        this.trustSignals.delete(key);
        this.removeEdge(truster, trustee);
        return;
      }
      this.trustSignals.set(key, signal);
    }

    this.updateCaches(truster, trustee);
  }

  /**
   * Remove a trust edge from the graph
   */
  private removeEdge(truster: string, trustee: string): void {
    const neighbors = this.adjacencyList.get(truster);
    if (neighbors) {
      neighbors.delete(trustee);
    }
    // Note: We don't immediately invalidate hop distance cache on removal
    // as there may be other paths. A full rebuild would be needed for accuracy.
  }

  /**
   * Update adjacency list and hop distance cache
   */
  private updateCaches(truster: string, trustee: string): void {
    // Update adjacency list
    if (!this.adjacencyList.has(truster)) {
      this.adjacencyList.set(truster, new Set());
    }

    const isNewEdge = !this.adjacencyList.get(truster)!.has(trustee);
    this.adjacencyList.get(truster)!.add(trustee);

    // Persist new trust edge
    if (isNewEdge && this.onTrustEdge) {
      this.onTrustEdge(truster, trustee);
    }

    // Calculate hop distance for trustee based on truster's distance
    const trusterDistance = this.getHopDistanceInternal(truster);

    if (trusterDistance !== undefined && trusterDistance < 999) {
      const newDistance = trusterDistance + 1;
      const existingDistance = this.hopDistanceCache.get(trustee);

      // Update if this is a shorter path or first path
      if (existingDistance === undefined || newDistance < existingDistance) {
        this.hopDistanceCache.set(trustee, newDistance);

        // Recursively update neighbors of trustee (if within maxHops)
        if (newDistance < this.maxHops) {
          const neighbors = this.adjacencyList.get(trustee);
          if (neighbors) {
            for (const neighbor of neighbors) {
              this.updateCaches(trustee, neighbor);
            }
          }
        }
      }
    }
  }

  /**
   * Internal hop distance lookup (doesn't check self)
   */
  private getHopDistanceInternal(publicKey: string): number | undefined {
    if (publicKey === this.selfPublicKey) {
      return 0;
    }
    if (this.directTrust.has(publicKey)) {
      return 1;
    }
    return this.hopDistanceCache.get(publicKey);
  }

  /**
   * Update direct trust set
   */
  updateDirectTrust(newTrustGraph: Set<string>): void {
    this.directTrust.clear();
    for (const key of newTrustGraph) {
      this.directTrust.add(key);
      this.hopDistanceCache.set(key, 1);
    }

    // Rebuild extended network from existing edges
    for (const [truster, trustees] of this.adjacencyList) {
      for (const trustee of trustees) {
        this.updateCaches(truster, trustee);
      }
    }
  }

  /**
   * Get direct trust set
   */
  getDirectTrust(): ReadonlySet<string> {
    return this.directTrust;
  }

  /**
   * Add to direct trust
   */
  addDirectTrust(publicKey: string): void {
    this.directTrust.add(publicKey);
    this.hopDistanceCache.set(publicKey, 1);
  }

  /**
   * Remove from direct trust
   */
  removeDirectTrust(publicKey: string): void {
    this.directTrust.delete(publicKey);
    // Don't remove from cache - may still be reachable via other paths
  }

  /**
   * Get neighbors (trustees) of a given truster
   */
  getNeighbors(publicKey: string): string[] {
    if (publicKey === this.selfPublicKey || publicKey === 'self') {
      return Array.from(this.directTrust);
    }
    const neighbors = this.adjacencyList.get(publicKey);
    return neighbors ? Array.from(neighbors) : [];
  }

  /**
   * Find all trust paths to a target (BFS with optional depth limit)
   *
   * This is used for detailed reputation calculations where we need
   * path diversity and weighted paths. For simple distance checks,
   * use getHopDistance() which is O(1).
   *
   * @param targetKey - Target public key
   * @param maxDepth - Maximum search depth (default: maxHops)
   * @returns Array of trust paths
   */
  findTrustPaths(targetKey: string, maxDepth?: number): TrustPath[] {
    const searchDepth = maxDepth ?? this.maxHops;
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
      if (depth >= searchDepth) {
        continue;
      }

      // Avoid cycles
      if (visited.has(currentKey)) {
        continue;
      }
      visited.add(currentKey);

      // Explore neighbors
      const neighbors = this.getNeighbors(currentKey);
      for (const neighbor of neighbors) {
        queue.push([neighbor, [...path, neighbor], depth + 1]);
      }
    }

    return paths;
  }

  /**
   * Calculate weight of a trust path
   *
   * Factors in:
   * - Distance-based decay (0.9 for hop 1, 0.6 for hop 2, 0.3 for hop 3)
   * - Custom trust weights from signals
   */
  private calculatePathWeight(path: string[]): number {
    const distance = path.length;

    // Base score by distance
    let baseScore: number;
    switch (distance) {
      case 0: baseScore = 1.0; break;
      case 1: baseScore = 0.9; break;
      case 2: baseScore = 0.6; break;
      case 3: baseScore = 0.3; break;
      default: baseScore = 0.0;
    }

    // Factor in custom trust weights along the path
    let weightMultiplier = 1.0;
    let previousKey = 'self';

    for (const currentKey of path) {
      const trusterKey = previousKey === 'self' ? this.selfPublicKey : previousKey;
      const signalKey = `${trusterKey}:${currentKey}`;
      const signal = this.trustSignals.get(signalKey);

      if (signal?.weight !== undefined) {
        weightMultiplier *= signal.weight;
      }

      previousKey = currentKey;
    }

    return baseScore * weightMultiplier;
  }

  /**
   * Get trust signal for an edge
   */
  getTrustSignal(truster: string, trustee: string): TrustSignal | undefined {
    return this.trustSignals.get(`${truster}:${trustee}`);
  }

  /**
   * Get all trust signals
   */
  getAllTrustSignals(): TrustSignal[] {
    return Array.from(this.trustSignals.values());
  }

  /**
   * Get graph statistics
   */
  getStats() {
    return {
      directTrustCount: this.directTrust.size,
      adjacencyListSize: this.adjacencyList.size,
      hopDistanceCacheSize: this.hopDistanceCache.size,
      trustSignalCount: this.trustSignals.size,
      maxHops: this.maxHops
    };
  }

  /**
   * Export adjacency list (for persistence)
   */
  exportAdjacencyList(): Map<string, Set<string>> {
    return new Map(this.adjacencyList);
  }
}
