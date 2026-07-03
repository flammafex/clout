/**
 * HyperToken integration adapter
 *
 * Provides P2P network connectivity for gossip protocol using HyperToken's
 * HybridPeerManager for WebSocket + WebRTC P2P networking with automatic upgrade.
 *
 * This adapter is message-type agnostic - it works with any JSON-serializable
 * message type (Scarcity GossipMessage, Clout ContentGossipMessage, etc.)
 */

import { HybridPeerManager } from '../vendor/hypertoken/HybridPeerManager.js';
import { Crypto } from '../crypto.js';

export interface HyperTokenAdapterConfig {
  readonly relayUrl?: string;
}

/**
 * Generic PeerConnection interface for any message type
 */
export interface GenericPeerConnection<T = any> {
  readonly id: string;
  readonly publicKey?: string;
  send(data: T): Promise<void>;
  isConnected(): boolean;
  setMessageHandler?(handler: (data: T) => void): void;
  disconnect?(): void;
}

/**
 * Recursively serialize an object for JSON transmission
 * Converts Uint8Arrays to { __uint8array: hexString } format
 */
function serializeDeep(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Uint8Array) {
    return { __uint8array: Crypto.toHex(obj) };
  }
  if (Array.isArray(obj)) {
    return obj.map(serializeDeep);
  }
  if (typeof obj === 'object') {
    const result: any = {};
    for (const key of Object.keys(obj)) {
      result[key] = serializeDeep(obj[key]);
    }
    return result;
  }
  return obj;
}

/**
 * Recursively deserialize an object from JSON transmission
 * Converts { __uint8array: hexString } back to Uint8Array
 */
function deserializeDeep(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'object' && '__uint8array' in obj) {
    return Crypto.fromHex(obj.__uint8array);
  }
  if (Array.isArray(obj)) {
    return obj.map(deserializeDeep);
  }
  if (typeof obj === 'object') {
    const result: any = {};
    for (const key of Object.keys(obj)) {
      result[key] = deserializeDeep(obj[key]);
    }
    return result;
  }
  return obj;
}

/**
 * Wrapper that adapts HyperToken's event-driven HybridPeerManager
 * to a generic PeerConnection interface (works with any message type)
 */
class HyperTokenPeerWrapper implements GenericPeerConnection {
  readonly id: string;
  private htManager: HybridPeerManager;
  private messageHandler?: (data: any) => void;
  private targetPeerId: string;

  constructor(htManager: HybridPeerManager, targetPeerId: string) {
    this.htManager = htManager;
    this.targetPeerId = targetPeerId;
    this.id = targetPeerId;
  }

  async send(data: any): Promise<void> {
    if (!this.isConnected()) {
      throw new Error(`Peer ${this.id} is not connected`);
    }

    // Serialize message to JSON-safe format (Uint8Array -> hex string)
    const serialized = serializeDeep(data);
    // Send message to specific peer using HyperToken's sendToPeer
    // This will use WebRTC if available, otherwise falls back to WebSocket
    this.htManager.sendToPeer(this.targetPeerId, serialized);
  }

  isConnected(): boolean {
    const wsConnection = this.htManager.getWebSocketConnection();
    return wsConnection.connected && wsConnection.peers.has(this.targetPeerId);
  }

  /**
   * Set handler for incoming messages from this peer
   */
  setMessageHandler(handler: (data: any) => void): void {
    this.messageHandler = handler;
  }

  /**
   * Internal: Called by HyperTokenAdapter when a message arrives from this peer
   */
  _handleIncomingMessage(data: any): void {
    if (this.messageHandler) {
      // Deserialize from JSON-safe format (hex string -> Uint8Array)
      const deserializedMessage = deserializeDeep(data);
      this.messageHandler(deserializedMessage);
    }
  }

  /**
   * Disconnect this peer
   */
  disconnect(): void {
    // Mark as disconnected - actual cleanup happens in adapter
    console.log(`[HyperToken] Disconnecting peer ${this.id}`);
  }
}

/**
 * Adapter for HyperToken P2P networking
 *
 * Provides hybrid WebSocket + WebRTC P2P connectivity through a relay server.
 * Automatically upgrades connections to WebRTC for lower latency when possible,
 * with graceful fallback to WebSocket.
 * Each HyperTokenAdapter instance represents a single peer in the gossip network.
 */
export class HyperTokenAdapter {
  private readonly relayUrl: string;
  private htManager: HybridPeerManager | null = null;
  private peerWrappers = new Map<string, HyperTokenPeerWrapper>();
  private isReady = false;
  private readyPromise: Promise<void>;
  private readyResolve?: () => void;
  private readyReject?: (error: Error) => void;
  private peerDiscoveryHandler?: (peer: GenericPeerConnection) => void;

  constructor(config: HyperTokenAdapterConfig = {}) {
    this.relayUrl = config.relayUrl ?? 'ws://localhost:8080';

    // Create a promise that resolves when connection is ready
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
  }

  /**
   * Set handler for when new peers are discovered
   */
  setPeerDiscoveryHandler(handler: (peer: GenericPeerConnection) => void): void {
    this.peerDiscoveryHandler = handler;
  }

  /**
   * Connect to relay server
   */
  async connect(): Promise<void> {
    this.htManager = new HybridPeerManager({
      url: this.relayUrl,
      autoUpgrade: true,  // Automatically upgrade to WebRTC
      upgradeDelay: 1000  // Wait 1s after peer joins before upgrading
    });

    // Set up event handlers
    this.htManager.on('net:ready', (evt: any) => {
      this.isReady = true;
      console.log(`[HyperToken] Connected with peer ID: ${evt.payload.peerId}`);
      if (this.readyResolve) {
        this.readyResolve();
      }
    });

    this.htManager.on('net:peer:connected', (evt: any) => {
      const peerId = evt.payload.peerId;
      console.log(`[HyperToken] Peer joined: ${peerId}`);
      
      // Automatically create wrapper for new peer
      const peer = this.ensurePeerWrapper(peerId);
      
      // Notify discovery handler
      if (this.peerDiscoveryHandler) {
        this.peerDiscoveryHandler(peer);
      }
    });

    this.htManager.on('net:peer:disconnected', (evt: any) => {
      const peerId = evt.payload.peerId;
      console.log(`[HyperToken] Peer left: ${peerId}`);
      this.peerWrappers.delete(peerId);
    });

    this.htManager.on('net:message', (evt: any) => {
      // Route message to appropriate peer wrapper
      const fromPeerId = evt.payload?.fromPeerId || evt.fromPeerId;
      if (fromPeerId) {
        // Ensure wrapper exists (implicit discovery for broadcast messages)
        const wrapper = this.ensurePeerWrapper(fromPeerId);

        // Notify handler if this was a new peer we hadn't seen before
        if (!this.peerWrappers.has(fromPeerId) && this.peerDiscoveryHandler) {
           this.peerDiscoveryHandler(wrapper);
        }

        // Extract the actual gossip message from the nested payload
        // HyperToken wraps messages as: { payload: <actual-message>, fromPeerId: <id> }
        const message = evt.payload?.payload || evt.payload?.data || evt.payload;
        wrapper._handleIncomingMessage(message);
      }
    });

    this.htManager.on('net:error', (evt: any) => {
      const error = evt.payload?.error || new Error('Unknown network error');
      console.error(`[HyperToken] Network error:`, error);
      if (this.readyReject && !this.isReady) {
        this.readyReject(error);
      }
    });

    // Optional: Listen to WebRTC upgrade events for visibility
    this.htManager.on('rtc:upgraded', (evt: any) => {
      const { peerId, usingTurn } = evt.payload;
      const turnInfo = usingTurn ? ' (via TURN)' : '';
      console.log(`[HyperToken] ✅ WebRTC connection established with ${peerId}${turnInfo}`);
    });

    this.htManager.on('rtc:downgraded', (evt: any) => {
      const { peerId } = evt.payload;
      console.log(`[HyperToken] WebRTC connection lost with ${peerId}, using WebSocket fallback`);
    });

    // Initiate connection
    this.htManager.connect();

    // Set timeout for connection
    const timeout = setTimeout(() => {
      if (!this.isReady && this.readyReject) {
        this.readyReject(new Error('Connection timeout'));
      }
    }, 10000); // 10 second timeout

    // Wait for connection to be ready
    try {
      await this.readyPromise;
      clearTimeout(timeout);
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  /**
   * Helper to ensure a peer wrapper exists
   */
  private ensurePeerWrapper(peerId: string): HyperTokenPeerWrapper {
    let wrapper = this.peerWrappers.get(peerId);
    if (!wrapper) {
      wrapper = new HyperTokenPeerWrapper(
        this.htManager!,
        peerId
      );
      this.peerWrappers.set(peerId, wrapper);
    }
    return wrapper;
  }

  /**
   * Create a peer connection wrapper for a specific peer
   */
  createPeer(peerId?: string): GenericPeerConnection {
    // Generate peer ID if not provided
    const targetPeerId = peerId ?? this.generatePeerId();

    // If not connected, create a mock peer for fallback mode
    if (!this.htManager) {
      return {
        id: targetPeerId,
        async send(_data: any): Promise<void> {
          // No-op in fallback mode
        },
        isConnected(): boolean {
          return false;
        }
      };
    }

    return this.ensurePeerWrapper(targetPeerId);
  }

  /**
   * Get all connected peer wrappers
   */
  getPeers(): GenericPeerConnection[] {
    return Array.from(this.peerWrappers.values());
  }

  /**
   * Get our peer ID assigned by the relay server
   */
  getMyPeerId(): string | null {
    return this.htManager?.getPeerId() ?? null;
  }

  /**
   * Get list of actually connected peer IDs from relay server
   */
  getConnectedPeerIds(): string[] {
    if (!this.htManager) return [];
    const wsConnection = this.htManager.getWebSocketConnection();
    return wsConnection.peers ? Array.from(wsConnection.peers) : [];
  }

  /**
   * Disconnect from network
   */
  disconnect(): void {
    if (this.htManager) {
      this.htManager.disconnect();
      this.peerWrappers.clear();
      this.isReady = false;
    }
  }

  private generatePeerId(): string {
    return `peer-${Math.random().toString(36).substring(2, 11)}`;
  }
}