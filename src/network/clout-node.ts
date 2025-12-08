/**
 * CloutNode - Main network node implementation
 *
 * Ties together all networking components:
 * - PeerManager (trust-based connections)
 * - DHT Discovery (decentralized peer finding)
 * - Relay Client (bootstrap and signaling)
 * - WebRTC Peers (P2P connections)
 */

import { PeerManager } from './peer-manager.js';
import { DHTDiscovery } from './dht-discovery.js';
import { RelayClient } from './relay-client.js';
import type {
  NetworkConfig,
  NetworkPeer,
  NodeType,
  NetworkStats,
  PeerDiscovery
} from '../network-types.js';
import type { ContentGossipMessage } from '../clout-types.js';

export interface CloutNodeConfig extends NetworkConfig {
  readonly onMessage?: (peer: NetworkPeer, message: ContentGossipMessage) => void;
  readonly onPeerConnected?: (peer: NetworkPeer) => void;
  readonly onPeerDisconnected?: (peerId: string) => void;
}

/**
 * CloutNode - Full network node implementation
 */
export class CloutNode {
  private readonly config: CloutNodeConfig;
  private peerManager?: PeerManager;
  private dhtDiscovery?: DHTDiscovery;
  private relayClient?: RelayClient;
  private started = false;

  constructor(config: CloutNodeConfig) {
    this.config = config;
  }

  /**
   * Start the node
   */
  async start(): Promise<void> {
    if (this.started) {
      console.warn('[CloutNode] Already started');
      return;
    }

    console.log(`[CloutNode] Starting ${this.config.nodeType} node...`);
    console.log(`[CloutNode] Public key: ${this.config.publicKey.slice(0, 16)}...`);

    // Create discovery mechanism based on config
    // This also creates relayClient if needed
    const discovery = await this.createDiscovery();

    // Create peer manager with relay client for WebRTC signaling
    this.peerManager = new PeerManager({
      network: this.config,
      discovery,
      relayClient: this.relayClient, // Pass relay client for signaling
      onPeerConnected: this.config.onPeerConnected,
      onPeerDisconnected: this.config.onPeerDisconnected,
      onMessage: this.config.onMessage
    });

    // Start peer manager
    await this.peerManager.start();

    this.started = true;
    console.log('[CloutNode] Started successfully');
  }

  /**
   * Create discovery mechanism (DHT, relay, or hybrid)
   */
  private async createDiscovery(): Promise<PeerDiscovery> {
    const useDHT = this.config.enableDHT ?? true;
    const useRelay = this.config.relayServers && this.config.relayServers.length > 0;

    if (useDHT && useRelay) {
      // Hybrid: Use both DHT and relay
      console.log('[CloutNode] Using hybrid discovery (DHT + Relay)');

      // Create DHT
      this.dhtDiscovery = new DHTDiscovery(this.config.publicKey);
      this.dhtDiscovery.startMaintenance();

      // Create relay client
      this.relayClient = new RelayClient({
        publicKey: this.config.publicKey,
        nodeType: this.config.nodeType,
        relayUrl: this.config.relayServers![0] // Use first relay
      });

      await this.relayClient.connect();

      // Return hybrid discovery that tries both
      return new HybridDiscovery(this.dhtDiscovery, this.relayClient);
    } else if (useDHT) {
      // DHT only
      console.log('[CloutNode] Using DHT discovery');
      this.dhtDiscovery = new DHTDiscovery(this.config.publicKey);
      this.dhtDiscovery.startMaintenance();
      return this.dhtDiscovery;
    } else if (useRelay) {
      // Relay only
      console.log('[CloutNode] Using relay discovery');
      this.relayClient = new RelayClient({
        publicKey: this.config.publicKey,
        nodeType: this.config.nodeType,
        relayUrl: this.config.relayServers![0]
      });

      await this.relayClient.connect();
      return this.relayClient;
    } else {
      throw new Error('No discovery mechanism configured');
    }
  }

  /**
   * Update trust graph and reconnect peers
   */
  async updateTrustGraph(newTrustGraph: Set<string>): Promise<void> {
    if (!this.peerManager) {
      throw new Error('Node not started');
    }

    await this.peerManager.updateTrustGraph(newTrustGraph);
  }

  /**
   * Broadcast message to all peers
   */
  async broadcast(message: ContentGossipMessage): Promise<void> {
    if (!this.peerManager) {
      throw new Error('Node not started');
    }

    await this.peerManager.broadcast(message);
  }

  /**
   * Send message to specific peer
   */
  async sendToPeer(publicKey: string, message: ContentGossipMessage): Promise<void> {
    if (!this.peerManager) {
      throw new Error('Node not started');
    }

    await this.peerManager.sendToPeer(publicKey, message);
  }

  /**
   * Get all connected peers
   */
  getPeers(): NetworkPeer[] {
    if (!this.peerManager) {
      return [];
    }

    return this.peerManager.getPeers();
  }

  /**
   * Get network statistics
   */
  getStats(): NetworkStats {
    if (!this.peerManager) {
      throw new Error('Node not started');
    }

    return this.peerManager.getStats();
  }

  /**
   * Stop the node
   */
  async stop(): Promise<void> {
    console.log('[CloutNode] Stopping...');

    if (this.peerManager) {
      await this.peerManager.destroy();
    }

    if (this.relayClient) {
      await this.relayClient.disconnect();
    }

    this.started = false;
    console.log('[CloutNode] Stopped');
  }
}

/**
 * Hybrid discovery using both DHT and relay
 */
class HybridDiscovery implements PeerDiscovery {
  constructor(
    private readonly dht: DHTDiscovery,
    private readonly relay: RelayClient
  ) {}

  async findPeers(publicKey: string, maxResults = 3): Promise<any[]> {
    // Try both DHT and relay in parallel
    const [dhtPeers, relayPeers] = await Promise.all([
      this.dht.findPeers(publicKey, maxResults),
      this.relay.findPeers(publicKey, maxResults)
    ]);

    // Combine and deduplicate
    const combined = [...dhtPeers, ...relayPeers];
    const unique = new Map();

    for (const peer of combined) {
      if (!unique.has(peer.publicKey)) {
        unique.set(peer.publicKey, peer);
      }
    }

    return Array.from(unique.values()).slice(0, maxResults);
  }

  async announce(publicKey: string, address: string): Promise<void> {
    await Promise.all([
      this.dht.announce(publicKey, address),
      this.relay.announce(publicKey, address)
    ]);
  }

  async bootstrap(relays: string[]): Promise<void> {
    await Promise.all([
      this.dht.bootstrap(relays),
      this.relay.bootstrap(relays)
    ]);
  }
}
