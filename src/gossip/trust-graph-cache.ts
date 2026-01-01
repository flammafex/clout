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

  /**
   * Incrementally update graph caches when trust signals arrive
   *
   * This updates the adjacency list and recalculates hop distances
   * for affected nodes, avoiding the need to traverse the entire graph
   * on every message.
   */
  updateCaches(truster: string, trustee: string): void {
    // Update adjacency list
    if (!this.trustAdjacencyList.has(truster)) {
      this.trustAdjacencyList.set(truster, new Set());
    }

    const isNewEdge = !this.trustAdjacencyList.get(truster)!.has(trustee);
    this.trustAdjacencyList.get(truster)!.add(trustee);

    // Persist new trust edge
    if (isNewEdge && this.onTrustEdge) {
      this.onTrustEdge(truster, trustee);
    }

    // Calculate hop distance for trustee based on truster's distance
    const trusterDistance = this.hopDistanceCache.get(truster);

    if (trusterDistance !== undefined) {
      const newDistance = trusterDistance + 1;
      const existingDistance = this.hopDistanceCache.get(trustee);

      // Update if this is a shorter path or first path
      if (existingDistance === undefined || newDistance < existingDistance) {
        this.hopDistanceCache.set(trustee, newDistance);

        // Recursively update neighbors of trustee (if within maxHops)
        if (newDistance < this.maxHops) {
          const neighbors = this.trustAdjacencyList.get(trustee);
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
      // Update cache: all directly trusted nodes are at distance 1
      this.hopDistanceCache.set(key, 1);
    }
  }

  /**
   * Rebuild extended network cache from trust signals
   */
  rebuildFromSignals(trustSignals: Map<string, { truster: string; trustee: string }>): void {
    for (const [_key, signal] of trustSignals.entries()) {
      this.updateCaches(signal.truster, signal.trustee);
    }
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
