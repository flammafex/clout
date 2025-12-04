/**
 * PeerManager - Manages P2P connections based on trust graph
 *
 * Key principle: Trust graph = Peer graph
 * We actively seek and maintain connections to people we trust.
 */

import type {
  NetworkConfig,
  NetworkPeer,
  PeerMetadata,
  PeerState,
  PeerInfo,
  PeerDiscovery,
  NetworkStats,
  NodeType
} from '../network-types.js';
import { PeerState as State } from '../network-types.js';

export interface PeerManagerConfig {
  readonly network: NetworkConfig;
  readonly discovery: PeerDiscovery;
  readonly onPeerConnected?: (peer: NetworkPeer) => void;
  readonly onPeerDisconnected?: (peerId: string) => void;
  readonly onMessage?: (peer: NetworkPeer, message: any) => void;
}

/**
 * PeerManager - Connection management based on trust graph
 */
export class PeerManager {
  private readonly config: PeerManagerConfig;
  private readonly peers = new Map<string, NetworkPeer>();
  private readonly peerMetadata = new Map<string, PeerMetadata>();
  private readonly trustGraph: Set<string>;
  private readonly maxPeers: number;

  // Stats tracking
  private stats = {
    messagesSent: 0,
    messagesReceived: 0,
    bytesTransferred: 0
  };

  constructor(config: PeerManagerConfig) {
    this.config = config;
    this.trustGraph = config.network.trustGraph;
    this.maxPeers = config.network.maxPeers ?? 50;
  }

  /**
   * Start peer manager - connect to trusted peers
   */
  async start(): Promise<void> {
    console.log('[PeerManager] Starting...');
    console.log(`[PeerManager] Trust graph size: ${this.trustGraph.size}`);
    console.log(`[PeerManager] Node type: ${this.config.network.nodeType}`);

    // Bootstrap from relay servers if configured
    if (this.config.network.relayServers && this.config.network.relayServers.length > 0) {
      console.log(`[PeerManager] Bootstrapping from ${this.config.network.relayServers.length} relays`);
      await this.config.discovery.bootstrap(this.config.network.relayServers);
    }

    // Connect to trusted peers
    await this.connectToTrustedPeers();

    // Start periodic maintenance
    this.startMaintenance();
  }

  /**
   * Connect to all peers in trust graph
   */
  private async connectToTrustedPeers(): Promise<void> {
    const trustedKeys = Array.from(this.trustGraph);
    console.log(`[PeerManager] Connecting to ${trustedKeys.length} trusted peers...`);

    // Limit concurrent connections
    const BATCH_SIZE = 10;
    for (let i = 0; i < trustedKeys.length; i += BATCH_SIZE) {
      const batch = trustedKeys.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(key => this.connectToPeer(key, 1)));
    }
  }

  /**
   * Connect to a specific peer by public key
   */
  async connectToPeer(publicKey: string, distance: number): Promise<NetworkPeer | null> {
    // Skip if already connected
    if (this.peers.has(publicKey)) {
      return this.peers.get(publicKey)!;
    }

    // Skip if at max peers
    if (this.peers.size >= this.maxPeers) {
      console.log('[PeerManager] At max peers, skipping connection');
      return null;
    }

    try {
      // Discover peer addresses
      const peerInfos = await this.config.discovery.findPeers(publicKey, 3);

      if (peerInfos.length === 0) {
        console.log(`[PeerManager] No addresses found for peer ${publicKey.slice(0, 8)}`);
        return null;
      }

      // Try to connect to first available address
      const peerInfo = peerInfos[0];
      const peer = await this.establishConnection(peerInfo, distance);

      if (peer) {
        this.peers.set(publicKey, peer);

        // Update metadata
        this.peerMetadata.set(publicKey, {
          publicKey,
          nodeType: peerInfo.nodeType,
          state: State.CONNECTED,
          distance,
          lastSeen: Date.now()
        });

        console.log(
          `[PeerManager] ✅ Connected to ${publicKey.slice(0, 8)} ` +
          `(distance: ${distance}, type: ${peerInfo.nodeType})`
        );

        // Notify callback
        if (this.config.onPeerConnected) {
          this.config.onPeerConnected(peer);
        }

        return peer;
      }

      return null;
    } catch (error) {
      console.warn(`[PeerManager] Failed to connect to ${publicKey.slice(0, 8)}:`, error);
      return null;
    }
  }

  /**
   * Establish connection to peer (stub - will be implemented with WebRTC)
   */
  private async establishConnection(
    peerInfo: PeerInfo,
    distance: number
  ): Promise<NetworkPeer | null> {
    // TODO: Implement actual WebRTC connection
    // For now, return a mock peer
    console.log(`[PeerManager] TODO: Establish WebRTC connection to ${peerInfo.publicKey.slice(0, 8)}`);

    // This will be replaced with real WebRTC implementation
    return null;
  }

  /**
   * Disconnect from a peer
   */
  async disconnectPeer(publicKey: string): Promise<void> {
    const peer = this.peers.get(publicKey);
    if (!peer) return;

    peer.disconnect();
    this.peers.delete(publicKey);
    this.peerMetadata.delete(publicKey);

    console.log(`[PeerManager] Disconnected from ${publicKey.slice(0, 8)}`);

    if (this.config.onPeerDisconnected) {
      this.config.onPeerDisconnected(publicKey);
    }
  }

  /**
   * Update trust graph and reconnect as needed
   */
  async updateTrustGraph(newTrustGraph: Set<string>): Promise<void> {
    const added = new Set<string>();
    const removed = new Set<string>();

    // Find additions
    for (const key of newTrustGraph) {
      if (!this.trustGraph.has(key)) {
        added.add(key);
      }
    }

    // Find removals
    for (const key of this.trustGraph) {
      if (!newTrustGraph.has(key)) {
        removed.add(key);
      }
    }

    // Update local trust graph
    this.trustGraph.clear();
    for (const key of newTrustGraph) {
      this.trustGraph.add(key);
    }

    console.log(`[PeerManager] Trust graph updated: +${added.size}, -${removed.size}`);

    // Connect to new trusted peers
    for (const key of added) {
      await this.connectToPeer(key, 1);
    }

    // Disconnect from untrusted peers
    for (const key of removed) {
      await this.disconnectPeer(key);
    }
  }

  /**
   * Discover and connect to 2-hop peers (friends of friends)
   */
  async discoverSecondHopPeers(): Promise<void> {
    // For each connected peer, discover who they trust
    for (const [publicKey, peer] of this.peers.entries()) {
      // TODO: Query peer for their trust graph
      // For now, skip this - will implement after basic connections work
    }
  }

  /**
   * Get all connected peers
   */
  getPeers(): NetworkPeer[] {
    return Array.from(this.peers.values());
  }

  /**
   * Get peer by public key
   */
  getPeer(publicKey: string): NetworkPeer | undefined {
    return this.peers.get(publicKey);
  }

  /**
   * Get peer metadata
   */
  getPeerMetadata(publicKey: string): PeerMetadata | undefined {
    return this.peerMetadata.get(publicKey);
  }

  /**
   * Broadcast message to all connected peers
   */
  async broadcast(message: any): Promise<void> {
    const peers = this.getPeers();
    const promises = peers.map(peer =>
      peer.send(message).catch(err => {
        console.warn(`[PeerManager] Failed to send to ${peer.publicKey.slice(0, 8)}:`, err);
      })
    );

    await Promise.all(promises);
    this.stats.messagesSent += peers.length;
  }

  /**
   * Send message to specific peer
   */
  async sendToPeer(publicKey: string, message: any): Promise<void> {
    const peer = this.peers.get(publicKey);
    if (!peer) {
      throw new Error(`Peer ${publicKey} not connected`);
    }

    await peer.send(message);
    this.stats.messagesSent++;
  }

  /**
   * Get network statistics
   */
  getStats(): NetworkStats {
    const connectedPeers = this.peers.size;

    // Count peers by distance
    const peersByDistance = {
      distance0: 0,
      distance1: 0,
      distance2: 0,
      distance3: 0
    };

    for (const metadata of this.peerMetadata.values()) {
      if (metadata.distance === 0) peersByDistance.distance0++;
      else if (metadata.distance === 1) peersByDistance.distance1++;
      else if (metadata.distance === 2) peersByDistance.distance2++;
      else if (metadata.distance === 3) peersByDistance.distance3++;
    }

    // Calculate average latency
    let totalLatency = 0;
    let latencyCount = 0;
    for (const metadata of this.peerMetadata.values()) {
      if (metadata.metrics?.latency) {
        totalLatency += metadata.metrics.latency;
        latencyCount++;
      }
    }
    const avgLatency = latencyCount > 0 ? totalLatency / latencyCount : 0;

    return {
      nodeType: this.config.network.nodeType,
      totalPeers: this.peerMetadata.size,
      connectedPeers,
      trustGraphSize: this.trustGraph.size,
      peersByDistance,
      traffic: this.stats,
      avgLatency,
      avgPeerCount: connectedPeers
    };
  }

  /**
   * Periodic maintenance: reconnect dropped peers, prune stale connections
   */
  private startMaintenance(): void {
    setInterval(() => {
      this.runMaintenance().catch(err => {
        console.warn('[PeerManager] Maintenance error:', err);
      });
    }, 60_000); // Every minute
  }

  private async runMaintenance(): Promise<void> {
    const now = Date.now();
    const STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes

    // Check for stale peers
    for (const [publicKey, metadata] of this.peerMetadata.entries()) {
      if (now - metadata.lastSeen > STALE_THRESHOLD) {
        console.log(`[PeerManager] Peer ${publicKey.slice(0, 8)} is stale, reconnecting...`);
        await this.disconnectPeer(publicKey);

        // Reconnect if still trusted
        if (this.trustGraph.has(publicKey)) {
          await this.connectToPeer(publicKey, metadata.distance);
        }
      }
    }

    // Try to reconnect to trusted peers we're not connected to
    for (const publicKey of this.trustGraph) {
      if (!this.peers.has(publicKey) && this.peers.size < this.maxPeers) {
        await this.connectToPeer(publicKey, 1);
      }
    }
  }

  /**
   * Cleanup - disconnect all peers
   */
  async destroy(): Promise<void> {
    console.log('[PeerManager] Shutting down...');

    const publicKeys = Array.from(this.peers.keys());
    for (const publicKey of publicKeys) {
      await this.disconnectPeer(publicKey);
    }

    console.log('[PeerManager] Shutdown complete');
  }
}
