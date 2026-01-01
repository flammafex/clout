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
  NodeType,
  RelayMessage
} from '../network-types.js';
import { PeerState as State, RelayMessageType } from '../network-types.js';
import { WebRTCPeer } from './webrtc-peer.js';
import type { RelayClient } from './relay-client.js';

export interface PeerManagerConfig {
  readonly network: NetworkConfig;
  readonly discovery: PeerDiscovery;
  readonly relayClient?: RelayClient;
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
  private readonly relayClient?: RelayClient;

  // Pending connections awaiting signaling completion
  private readonly pendingConnections = new Map<string, {
    peer: WebRTCPeer;
    iceCandidates: RTCIceCandidateInit[];
    resolve: (peer: NetworkPeer) => void;
    reject: (error: Error) => void;
  }>();

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
    this.relayClient = config.relayClient;

    // Set up relay message handler for signaling
    if (this.relayClient) {
      this.relayClient.onMessage((message: RelayMessage) => {
        this.handleRelayMessage(message);
      });
    }
  }

  /**
   * Handle incoming relay messages (signaling)
   */
  private handleRelayMessage(message: RelayMessage): void {
    if (message.type === RelayMessageType.SIGNAL) {
      this.handleSignal(message);
    } else if (message.type === RelayMessageType.FORWARD) {
      // Handle forwarded gossip messages
      const peer = this.peers.get(message.from!);
      if (peer && this.config.onMessage) {
        this.config.onMessage(peer, message.payload);
      }
    }
  }

  /**
   * Handle WebRTC signaling message
   */
  private async handleSignal(message: RelayMessage): Promise<void> {
    const { from, payload } = message;
    if (!from || !payload) return;

    const signalType = payload.type;
    console.log(`[PeerManager] Received signal: ${signalType} from ${from.slice(0, 8)}`);

    if (signalType === 'offer') {
      // Incoming connection request
      await this.handleOffer(from, payload.offer);
    } else if (signalType === 'answer') {
      // Response to our offer
      await this.handleAnswer(from, payload.answer);
    } else if (signalType === 'ice-candidate') {
      // ICE candidate
      await this.handleIceCandidate(from, payload.candidate);
    }
  }

  /**
   * Handle incoming WebRTC offer
   */
  private async handleOffer(from: string, offer: RTCSessionDescriptionInit): Promise<void> {
    // Only accept connections from trusted peers
    if (!this.trustGraph.has(from)) {
      console.log(`[PeerManager] Rejecting offer from untrusted peer ${from.slice(0, 8)}`);
      return;
    }

    // Create peer and accept offer
    const metadata: PeerMetadata = {
      publicKey: from,
      nodeType: 'light' as any,
      state: State.CONNECTING,
      distance: 1,
      lastSeen: Date.now()
    };

    const peer = new WebRTCPeer({
      publicKey: from,
      metadata,
      onMessage: (msg) => {
        if (this.config.onMessage) {
          this.config.onMessage(peer, msg);
        }
      }
    });

    try {
      // Accept the offer and create answer
      const answer = await peer.acceptOffer(offer);

      // Send answer back via relay
      if (this.relayClient) {
        await this.relayClient.signal(from, {
          type: 'answer',
          answer
        });
      }

      // Store pending connection for ICE candidates
      this.pendingConnections.set(from, {
        peer,
        iceCandidates: [],
        resolve: () => {},
        reject: () => {}
      });

      // Set up ICE candidate handler
      this.setupIceCandidateHandler(peer, from);

      console.log(`[PeerManager] Sent answer to ${from.slice(0, 8)}`);
    } catch (error) {
      console.error(`[PeerManager] Failed to handle offer from ${from.slice(0, 8)}:`, error);
    }
  }

  /**
   * Handle WebRTC answer to our offer
   */
  private async handleAnswer(from: string, answer: RTCSessionDescriptionInit): Promise<void> {
    const pending = this.pendingConnections.get(from);
    if (!pending) {
      console.warn(`[PeerManager] Received answer for unknown connection: ${from.slice(0, 8)}`);
      return;
    }

    try {
      await pending.peer.completeConnection(answer);

      // Apply any queued ICE candidates
      for (const candidate of pending.iceCandidates) {
        await pending.peer.addIceCandidate(candidate);
      }

      console.log(`[PeerManager] Connection completed with ${from.slice(0, 8)}`);
    } catch (error) {
      console.error(`[PeerManager] Failed to complete connection with ${from.slice(0, 8)}:`, error);
      pending.reject(error as Error);
    }
  }

  /**
   * Handle ICE candidate
   */
  private async handleIceCandidate(from: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pending = this.pendingConnections.get(from);
    const existingPeer = this.peers.get(from);

    if (pending) {
      // Queue candidate if connection not yet complete
      try {
        await pending.peer.addIceCandidate(candidate);
      } catch {
        pending.iceCandidates.push(candidate);
      }
    } else if (existingPeer && existingPeer instanceof WebRTCPeer) {
      await existingPeer.addIceCandidate(candidate);
    }
  }

  /**
   * Set up ICE candidate forwarding via relay
   */
  private setupIceCandidateHandler(peer: WebRTCPeer, targetPublicKey: string): void {
    // Access the internal connection to handle ICE candidates
    // This is a bit hacky but necessary for signaling
    const connection = (peer as any).connection as RTCPeerConnection;
    if (!connection) return;

    connection.onicecandidate = async (event) => {
      if (event.candidate && this.relayClient) {
        await this.relayClient.signal(targetPublicKey, {
          type: 'ice-candidate',
          candidate: event.candidate.toJSON()
        });
      }
    };

    // Handle connection state changes
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'connected') {
        // Move from pending to active peers
        const pending = this.pendingConnections.get(targetPublicKey);
        if (pending) {
          this.peers.set(targetPublicKey, peer);
          this.peerMetadata.set(targetPublicKey, peer.metadata);
          this.pendingConnections.delete(targetPublicKey);

          console.log(`[PeerManager] ✅ P2P connected to ${targetPublicKey.slice(0, 8)}`);

          if (this.config.onPeerConnected) {
            this.config.onPeerConnected(peer);
          }

          pending.resolve(peer);
        }
      } else if (connection.connectionState === 'failed') {
        const pending = this.pendingConnections.get(targetPublicKey);
        if (pending) {
          this.pendingConnections.delete(targetPublicKey);
          pending.reject(new Error('Connection failed'));
        }
      }
    };
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
   * Establish WebRTC connection to peer via relay signaling
   */
  private async establishConnection(
    peerInfo: PeerInfo,
    distance: number
  ): Promise<NetworkPeer | null> {
    if (!this.relayClient) {
      console.log(`[PeerManager] No relay client - cannot establish WebRTC connection to ${peerInfo.publicKey.slice(0, 8)}`);
      return null;
    }

    const targetPublicKey = peerInfo.publicKey;

    // Create metadata for the peer
    const metadata: PeerMetadata = {
      publicKey: targetPublicKey,
      nodeType: peerInfo.nodeType,
      state: State.CONNECTING,
      distance,
      lastSeen: Date.now()
    };

    // Create WebRTC peer
    const peer = new WebRTCPeer({
      publicKey: targetPublicKey,
      metadata,
      onMessage: (msg) => {
        if (this.config.onMessage) {
          this.config.onMessage(peer, msg);
        }
      }
    });

    return new Promise(async (resolve, reject) => {
      // Set connection timeout
      const timeout = setTimeout(() => {
        this.pendingConnections.delete(targetPublicKey);
        reject(new Error('Connection timeout'));
      }, 30000); // 30 second timeout

      // Store pending connection
      this.pendingConnections.set(targetPublicKey, {
        peer,
        iceCandidates: [],
        resolve: (connectedPeer) => {
          clearTimeout(timeout);
          resolve(connectedPeer);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });

      try {
        // Create offer
        const offer = await peer.connect();

        // Set up ICE candidate forwarding
        this.setupIceCandidateHandler(peer, targetPublicKey);

        // Send offer via relay
        await this.relayClient!.signal(targetPublicKey, {
          type: 'offer',
          offer
        });

        console.log(`[PeerManager] Sent offer to ${targetPublicKey.slice(0, 8)}`);
      } catch (error) {
        clearTimeout(timeout);
        this.pendingConnections.delete(targetPublicKey);
        console.error(`[PeerManager] Failed to create offer for ${targetPublicKey.slice(0, 8)}:`, error);
        reject(error);
      }
    });
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
   *
   * FUTURE WORK: This requires a P2P message protocol for trust graph exchange.
   * Implementation needs:
   * 1. Define TrustGraphRequest/TrustGraphResponse message types
   * 2. Add privacy controls (users may not want to expose full graph)
   * 3. Handle partial/filtered graph responses
   * 4. Rate limiting to prevent enumeration attacks
   */
  async discoverSecondHopPeers(): Promise<void> {
    // For each connected peer, discover who they trust
    for (const [_publicKey, _peer] of this.peers.entries()) {
      // Not implemented: Requires P2P message protocol for trust graph exchange
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
