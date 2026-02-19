/**
 * TrustGraphCache - Optimized trust graph distance calculations
 *
 * Maintains an adjacency list and hop distance cache for O(1) lookups
 * instead of O(n) BFS traversal on every message.
 */

export interface TrustGraphCacheConfig {
  /** Initial direct trust graph (distance 1) */
  readonly trustGraph: Set<string>;
  /** Maximum hops to track (default: 3) */
  readonly maxHops?: number;
  /** Optional callback when a new trust edge is discovered */
  readonly onTrustEdge?: (truster: string, trustee: string) => void;
  /** Optional initial persisted trust graph */
  readonly persistedTrustGraph?: Map<string, Set<string>>;
}

export class TrustGraphCache {
  private readonly trustGraph: Set<string>;
  private readonly maxHops: number;
  private readonly onTrustEdge?: (truster: string, trustee: string) => void;

  // OPTIMIZATION: Cached adjacency list for O(1) hop distance lookups
  private readonly trustAdjacencyList = new Map<string, Set<string>>();
  private readonly hopDistanceCache = new Map<string, number>();

  constructor(config: TrustGraphCacheConfig) {
    this.trustGraph = config.trustGraph;
    this.maxHops = config.maxHops ?? 3;
    this.onTrustEdge = config.onTrustEdge;

    // Initialize hop distance cache from initial trust graph (distance 1)
    for (const trustedKey of this.trustGraph) {
      this.hopDistanceCache.set(trustedKey, 1);
    }

    // Load persisted trust graph if provided
    if (config.persistedTrustGraph) {
      for (const [truster, trustees] of config.persistedTrustGraph) {
        for (const trustee of trustees) {
          this.updateCaches(truster, trustee);
        }
      }
      console.log(`[TrustGraphCache] Loaded ${config.persistedTrustGraph.size} persisted trust graph entries`);
    }
  }

  private rebuildHopDistanceCache(): void {
    this.hopDistanceCache.clear();

    const queue: Array<[string, number]> = [];
    for (const trustedKey of this.trustGraph) {
      this.hopDistanceCache.set(trustedKey, 1);
      queue.push([trustedKey, 1]);
    }

    while (queue.length > 0) {
      const [current, distance] = queue.shift()!;
      if (distance >= this.maxHops) {
        continue;
      }

      const neighbors = this.trustAdjacencyList.get(current);
      if (!neighbors) {
        continue;
      }

      for (const neighbor of neighbors) {
        const newDistance = distance + 1;
        const existingDistance = this.hopDistanceCache.get(neighbor);
        if (existingDistance === undefined || newDistance < existingDistance) {
          this.hopDistanceCache.set(neighbor, newDistance);
          queue.push([neighbor, newDistance]);
        }
      }
    }
  }

  /**
   * Incrementally update graph caches when trust signals arrive.
   */
  updateCaches(truster: string, trustee: string): void {
    if (!this.trustAdjacencyList.has(truster)) {
      this.trustAdjacencyList.set(truster, new Set());
    }

    const neighbors = this.trustAdjacencyList.get(truster)!;
    const isNewEdge = !neighbors.has(trustee);
    neighbors.add(trustee);

    if (isNewEdge && this.onTrustEdge) {
      this.onTrustEdge(truster, trustee);
    }

    this.rebuildHopDistanceCache();
  }

  /**
   * Remove an edge from the adjacency list and recalculate hop distances.
   */
  removeEdge(truster: string, trustee: string): void {
    const neighbors = this.trustAdjacencyList.get(truster);
    if (!neighbors) {
      return;
    }

    neighbors.delete(trustee);
    if (neighbors.size === 0) {
      this.trustAdjacencyList.delete(truster);
    }

    this.rebuildHopDistanceCache();
  }

  /**
   * Calculate hop distance in trust graph (OPTIMIZED)
   *
   * Returns:
   * - 0: Self
   * - 1: Direct follow
   * - 2: Friend of friend
   * - 999: Not trusted (beyond maxHops)
   *
   * OPTIMIZATION: O(1) lookup instead of O(n) BFS traversal.
   */
  calculateHopDistance(publicKey: string): number {
    // Distance 1: Direct trust
    if (this.trustGraph.has(publicKey)) {
      return 1;
    }

    // Distance 2+: Lookup in pre-computed cache
    const cachedDistance = this.hopDistanceCache.get(publicKey);
    if (cachedDistance !== undefined) {
      return cachedDistance;
    }

    // Not reachable within maxHops
    return 999;
  }

  /**
   * Check if a public key is within the trust boundary
   */
  isWithinMaxHops(publicKey: string): boolean {
    return this.calculateHopDistance(publicKey) <= this.maxHops;
  }

  /**
   * Update local trust graph (when direct trust relationships change)
   *
   * Rebuilds hop distance cache for direct trust relationships.
   */
  updateDirectTrustGraph(newTrustGraph: Set<string>): void {
    this.trustGraph.clear();
    for (const key of newTrustGraph) {
      this.trustGraph.add(key);
    }
    this.rebuildHopDistanceCache();
  }

  /**
   * Rebuild extended network cache from trust signals
   */
  rebuildFromSignals(trustSignals: Map<string, { truster: string; trustee: string }>): void {
    this.trustAdjacencyList.clear();
    for (const [_key, signal] of trustSignals.entries()) {
      if (!this.trustAdjacencyList.has(signal.truster)) {
        this.trustAdjacencyList.set(signal.truster, new Set());
      }
      this.trustAdjacencyList.get(signal.truster)!.add(signal.trustee);
    }
    this.rebuildHopDistanceCache();
  }

  /**
   * Get the current max hops setting
   */
  get maxHopsLimit(): number {
    return this.maxHops;
  }

  /**
   * Get cache statistics
   */
  getStats(): { adjacencyListSize: number; hopCacheSize: number; directTrustSize: number } {
    return {
      adjacencyListSize: this.trustAdjacencyList.size,
      hopCacheSize: this.hopDistanceCache.size,
      directTrustSize: this.trustGraph.size
    };
  }
}
