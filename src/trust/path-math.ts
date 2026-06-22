/**
 * Shared trust-path traversal helpers used by the active trust engine.
 */

export interface TrustPath {
  readonly hops: string[];
  readonly weight: number;
}

export interface FindTrustPathsOptions {
  readonly targetKey: string;
  readonly maxDepth: number;
  readonly getNeighbors: (node: string) => readonly string[];
  readonly calculatePathWeight: (path: string[]) => number;
  /**
   * Hard cap on the number of queue iterations (node visits) before the
   * search aborts. Prevents CPU exhaustion on dense or pathological trust
   * graphs (e.g., a malicious peer flooding trust signals to create a clique).
   * Default: 1000.
   */
  readonly maxVisited?: number;
  /**
   * Hard cap on the number of paths collected before the search stops.
   * The reputation diversity bonus saturates at 4 paths (0.2 cap), so
   * collecting beyond this only wastes memory. Default: 50.
   */
  readonly maxPaths?: number;
}

/**
 * Default bounds for findTrustPaths.
 *
 * maxVisited caps total work (queue iterations) to prevent CPU exhaustion.
 * maxPaths caps collected paths to prevent memory blowup; the reputation
 * diversity bonus saturates at 4 paths (bonus = min(paths*0.05, 0.2)), so
 * 50 is generous while still bounding memory.
 */
const DEFAULT_MAX_VISITED = 1000;
const DEFAULT_MAX_PATHS = 50;

/**
 * Find trust paths from the synthetic "self" root to targetKey.
 *
 * Uses per-path cycle checks so distinct paths are not collapsed by
 * a global visited set.
 *
 * Bounded by maxVisited and maxPaths to prevent CPU/memory exhaustion on
 * dense or malicious trust graphs. When a bound is hit, the search returns
 * the paths found so far (a prefix of the full result set) rather than
 * throwing — reputation scoring degrades gracefully.
 */
export function findTrustPaths(options: FindTrustPathsOptions): TrustPath[] {
  const maxVisited = options.maxVisited ?? DEFAULT_MAX_VISITED;
  const maxPaths = options.maxPaths ?? DEFAULT_MAX_PATHS;
  const paths: TrustPath[] = [];
  const queue: Array<[string, string[], number]> = [['self', [], 0]];

  let visited = 0;

  while (queue.length > 0) {
    if (visited >= maxVisited) {
      break;
    }
    visited++;

    const [currentKey, path, depth] = queue.shift()!;

    if (currentKey === options.targetKey) {
      paths.push({
        hops: path,
        weight: options.calculatePathWeight(path)
      });
      if (paths.length >= maxPaths) {
        break;
      }
      continue;
    }

    if (depth >= options.maxDepth) {
      continue;
    }

    const neighbors = options.getNeighbors(currentKey);
    for (const neighbor of neighbors) {
      if (neighbor === 'self' || path.includes(neighbor)) {
        continue;
      }
      queue.push([neighbor, [...path, neighbor], depth + 1]);
    }
  }

  return paths;
}
