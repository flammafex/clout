/**
 * DHT-based peer discovery for Clout
 *
 * Simple implementation of distributed hash table for finding peers.
 * Keys are public keys, values are connection addresses.
 */

import { Crypto } from '../crypto.js';
import type { PeerDiscovery, PeerInfo, NodeType } from '../network-types.js';
import { NodeType as NT } from '../network-types.js';

interface DHTEntry {
  readonly publicKey: string;
  readonly nodeType: NodeType;
  readonly addresses: string[];
  readonly timestamp: number;
  readonly ttl: number;  // Time to live in seconds
}

interface DHTNode {
  readonly id: string;
  readonly address: string;
}

/**
 * Simple DHT implementation for peer discovery
 */
export class DHTDiscovery implements PeerDiscovery {
  private readonly localId: string;
  private readonly storage = new Map<string, DHTEntry>();
  private readonly nodes: DHTNode[] = [];
  private readonly k = 20; // Bucket size (Kademlia-inspired)

  constructor(publicKey: string) {
    this.localId = Crypto.hashString(publicKey);
  }

  /**
   * Find peers for a given public key
   */
  async findPeers(publicKey: string, maxResults = 3): Promise<PeerInfo[]> {
    const key = Crypto.hashString(publicKey);

    // Check local storage first
    const localEntry = this.storage.get(key);
    if (localEntry && !this.isExpired(localEntry)) {
      return [{
        publicKey: localEntry.publicKey,
        nodeType: localEntry.nodeType,
        addresses: localEntry.addresses,
        lastSeen: localEntry.timestamp
      }];
    }

    // Query DHT (simplified - would do proper Kademlia lookup)
    // For now, just return from local storage
    const results: PeerInfo[] = [];

    for (const [storedKey, entry] of this.storage.entries()) {
      if (this.isExpired(entry)) {
        this.storage.delete(storedKey);
        continue;
      }

      if (entry.publicKey === publicKey) {
        results.push({
          publicKey: entry.publicKey,
          nodeType: entry.nodeType,
          addresses: entry.addresses,
          lastSeen: entry.timestamp
        });

        if (results.length >= maxResults) {
          break;
        }
      }
    }

    return results;
  }

  /**
   * Announce our presence in the DHT
   */
  async announce(publicKey: string, address: string): Promise<void> {
    const key = Crypto.hashString(publicKey);

    const entry: DHTEntry = {
      publicKey,
      nodeType: NT.LIGHT, // Default to light node
      addresses: [address],
      timestamp: Date.now(),
      ttl: 3600 // 1 hour
    };

    this.storage.set(key, entry);
    console.log(`[DHT] Announced ${publicKey.slice(0, 8)} at ${address}`);
  }

  /**
   * Bootstrap from known relay nodes
   *
   * FUTURE WORK: Query relays for their peer lists.
   * Implementation needs:
   * 1. Define relay API endpoint for peer discovery (e.g., GET /peers)
   * 2. Implement HTTP/WebSocket query to relay
   * 3. Handle relay authentication and rate limiting
   * 4. Merge discovered peers into DHT routing table
   */
  async bootstrap(relays: string[]): Promise<void> {
    console.log(`[DHT] Bootstrapping from ${relays.length} relays`);

    for (const relay of relays) {
      // Add relay as DHT node
      const nodeId = Crypto.hashString(relay);
      this.nodes.push({
        id: nodeId,
        address: relay
      });

      // Not implemented: Relay API for peer discovery not yet defined
      console.log(`[DHT] Added relay node: ${relay}`);
    }
  }

  /**
   * Store peer information in DHT
   */
  async store(peerInfo: PeerInfo): Promise<void> {
    const key = Crypto.hashString(peerInfo.publicKey);

    const entry: DHTEntry = {
      publicKey: peerInfo.publicKey,
      nodeType: peerInfo.nodeType,
      addresses: peerInfo.addresses,
      timestamp: Date.now(),
      ttl: 3600
    };

    this.storage.set(key, entry);
  }

  /**
   * Find closest nodes to a key (Kademlia-style)
   */
  private findClosestNodes(targetKey: string, count: number): DHTNode[] {
    // Simple XOR distance metric
    const distances = this.nodes.map(node => ({
      node,
      distance: this.xorDistance(targetKey, node.id)
    }));

    // Sort by distance
    distances.sort((a, b) => a.distance - b.distance);

    return distances.slice(0, count).map(d => d.node);
  }

  /**
   * Calculate XOR distance between two keys
   */
  private xorDistance(a: string, b: string): number {
    // Simple numeric XOR for demo
    const aNum = parseInt(a.slice(0, 8), 16) || 0;
    const bNum = parseInt(b.slice(0, 8), 16) || 0;
    return aNum ^ bNum;
  }

  /**
   * Check if DHT entry is expired
   */
  private isExpired(entry: DHTEntry): boolean {
    const age = (Date.now() - entry.timestamp) / 1000;
    return age > entry.ttl;
  }

  /**
   * Periodic cleanup of expired entries
   */
  startMaintenance(): void {
    setInterval(() => {
      let removed = 0;
      for (const [key, entry] of this.storage.entries()) {
        if (this.isExpired(entry)) {
          this.storage.delete(key);
          removed++;
        }
      }

      if (removed > 0) {
        console.log(`[DHT] Cleaned up ${removed} expired entries`);
      }
    }, 300_000); // Every 5 minutes
  }

  /**
   * Get DHT statistics
   */
  getStats() {
    return {
      entries: this.storage.size,
      nodes: this.nodes.length,
      localId: this.localId
    };
  }
}
