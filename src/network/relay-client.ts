/**
 * Relay Client - Connects to relay server for signaling and discovery
 *
 * Used by light clients to:
 * 1. Register with relay
 * 2. Discover peers
 * 3. Perform WebRTC signaling
 * 4. Forward messages when direct connection unavailable
 */

/// <reference types="node" />

import { WebSocket } from 'ws';
import type { RelayMessage, PeerDiscovery, PeerInfo, NodeType } from '../network-types.js';
import { NodeType as NT, RelayMessageType } from '../network-types.js';

export interface RelayClientConfig {
  readonly publicKey: string;
  readonly nodeType: NodeType;
  readonly relayUrl: string;
}

type MessageHandler = (message: RelayMessage) => void;

/**
 * Client for connecting to Clout relay server
 */
export class RelayClient implements PeerDiscovery {
  private readonly config: RelayClientConfig;
  private ws?: WebSocket;
  private connected = false;
  private messageHandlers: MessageHandler[] = [];
  private reconnectTimer?: NodeJS.Timeout;

  constructor(config: RelayClientConfig) {
    this.config = config;
  }

  /**
   * Connect to relay server
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.config.relayUrl);

      this.ws.on('open', () => {
        console.log(`[RelayClient] Connected to ${this.config.relayUrl}`);
        this.connected = true;

        // Register with relay
        this.register();

        resolve();
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString()) as RelayMessage;
          this.handleMessage(message);
        } catch (error) {
          console.warn('[RelayClient] Invalid message:', error);
        }
      });

      this.ws.on('close', () => {
        console.log('[RelayClient] Disconnected from relay');
        this.connected = false;
        this.scheduleReconnect();
      });

      this.ws.on('error', (error) => {
        console.warn('[RelayClient] Error:', error);
        reject(error);
      });
    });
  }

  /**
   * Register with relay server
   */
  private register(): void {
    this.send({
      type: RelayMessageType.REGISTER,
      from: this.config.publicKey,
      payload: {
        publicKey: this.config.publicKey,
        nodeType: this.config.nodeType
      }
    });
  }

  /**
   * Handle incoming message from relay
   */
  private handleMessage(message: RelayMessage): void {
    // Notify all handlers
    for (const handler of this.messageHandlers) {
      handler(message);
    }
  }

  /**
   * Send message to relay
   */
  send(message: RelayMessage): void {
    if (!this.ws || !this.connected) {
      console.warn('[RelayClient] Not connected to relay');
      return;
    }

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Add message handler
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  /**
   * Send WebRTC signal via relay
   */
  async signal(to: string, payload: any): Promise<void> {
    this.send({
      type: RelayMessageType.SIGNAL,
      from: this.config.publicKey,
      to,
      payload
    });
  }

  /**
   * Forward message via relay (when direct connection unavailable)
   */
  async forward(to: string, payload: any): Promise<void> {
    this.send({
      type: RelayMessageType.FORWARD,
      from: this.config.publicKey,
      to,
      payload
    });
  }

  /**
   * PeerDiscovery: Find peers via relay
   */
  async findPeers(publicKey: string, maxResults = 3): Promise<PeerInfo[]> {
    return new Promise((resolve) => {
      // Query relay for peers
      this.send({
        type: RelayMessageType.QUERY_PEERS,
        from: this.config.publicKey,
        payload: { maxResults }
      });

      // Listen for response
      const timeout = setTimeout(() => {
        resolve([]);
      }, 5000);

      const handler = (message: RelayMessage) => {
        if (message.type === RelayMessageType.QUERY_PEERS && message.payload.peers) {
          clearTimeout(timeout);
          this.messageHandlers = this.messageHandlers.filter(h => h !== handler);

          const peers: PeerInfo[] = message.payload.peers.map((p: any) => ({
            publicKey: p.publicKey,
            nodeType: p.nodeType,
            addresses: [`relay:${this.config.relayUrl}:${p.publicKey}`],
            lastSeen: p.lastSeen
          }));

          resolve(peers);
        }
      };

      this.messageHandlers.push(handler);
    });
  }

  /**
   * PeerDiscovery: Announce presence (implicit via registration)
   */
  async announce(publicKey: string, address: string): Promise<void> {
    // Already announced via registration
    console.log(`[RelayClient] Announced via relay: ${publicKey.slice(0, 8)}`);
  }

  /**
   * PeerDiscovery: Bootstrap from relay
   */
  async bootstrap(relays: string[]): Promise<void> {
    // We're already connected to a relay
    console.log('[RelayClient] Already bootstrapped via relay connection');
  }

  /**
   * Schedule reconnection
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    console.log('[RelayClient] Reconnecting in 5 seconds...');

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect().catch(err => {
        console.warn('[RelayClient] Reconnect failed:', err);
      });
    }, 5000);
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Disconnect from relay
   */
  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }

    this.connected = false;
    console.log('[RelayClient] Disconnected');
  }
}
