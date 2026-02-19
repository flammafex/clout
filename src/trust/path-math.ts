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
}

/**
 * Find trust paths from the synthetic "self" root to targetKey.
 *
 * Uses per-path cycle checks so distinct paths are not collapsed by
 * a global visited set.
 */
export function findTrustPaths(options: FindTrustPathsOptions): TrustPath[] {
  const paths: TrustPath[] = [];
  const queue: Array<[string, string[], number]> = [['self', [], 0]];

  while (queue.length > 0) {
    const [currentKey, path, depth] = queue.shift()!;

    if (currentKey === options.targetKey) {
      paths.push({
        hops: path,
        weight: options.calculatePathWeight(path)
      });
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
