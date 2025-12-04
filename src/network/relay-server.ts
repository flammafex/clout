/**
 * Relay Server for Clout P2P network
 *
 * Provides:
 * 1. WebRTC signaling (ICE, offer/answer)
 * 2. Bootstrap peer discovery
 * 3. NAT traversal support
 * 4. Message forwarding for unreachable peers
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { RelayMessage, RelayMessageType } from '../network-types.js';

interface RegisteredClient {
  readonly publicKey: string;
  readonly ws: WebSocket;
  readonly nodeType: string;
  registeredAt: number;
  lastSeen: number;
}

export interface RelayServerConfig {
  readonly port: number;
  readonly host?: string;
}

/**
 * Relay server for WebRTC signaling and peer discovery
 */
export class RelayServer {
  private readonly config: RelayServerConfig;
  private wss?: WebSocketServer;
  private readonly clients = new Map<string, RegisteredClient>();

  constructor(config: RelayServerConfig) {
    this.config = config;
  }

  /**
   * Start relay server
   */
  async start(): Promise<void> {
    this.wss = new WebSocketServer({
      port: this.config.port,
      host: this.config.host || '0.0.0.0'
    });

    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws);
    });

    this.wss.on('error', (error) => {
      console.error('[RelayServer] Error:', error);
    });

    // Start maintenance
    this.startMaintenance();

    console.log(`[RelayServer] Started on ${this.config.host || '0.0.0.0'}:${this.config.port}`);
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket): void {
    console.log('[RelayServer] New connection');

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as RelayMessage;
        this.handleMessage(ws, message);
      } catch (error) {
        console.warn('[RelayServer] Invalid message:', error);
      }
    });

    ws.on('close', () => {
      // Remove client from registry
      for (const [publicKey, client] of this.clients.entries()) {
        if (client.ws === ws) {
          this.clients.delete(publicKey);
          console.log(`[RelayServer] Client ${publicKey.slice(0, 8)} disconnected`);
          break;
        }
      }
    });

    ws.on('error', (error) => {
      console.warn('[RelayServer] WebSocket error:', error);
    });
  }

  /**
   * Handle relay message
   */
  private handleMessage(ws: WebSocket, message: RelayMessage): void {
    switch (message.type) {
      case 'register':
        this.handleRegister(ws, message);
        break;

      case 'signal':
        this.handleSignal(ws, message);
        break;

      case 'forward':
        this.handleForward(ws, message);
        break;

      case 'query_peers':
        this.handleQueryPeers(ws, message);
        break;

      default:
        console.warn(`[RelayServer] Unknown message type: ${message.type}`);
    }
  }

  /**
   * Handle client registration
   */
  private handleRegister(ws: WebSocket, message: RelayMessage): void {
    const { publicKey, nodeType } = message.payload;

    if (!publicKey) {
      this.sendError(ws, 'Missing publicKey in registration');
      return;
    }

    // Register client
    this.clients.set(publicKey, {
      publicKey,
      ws,
      nodeType: nodeType || 'light',
      registeredAt: Date.now(),
      lastSeen: Date.now()
    });

    console.log(
      `[RelayServer] Registered ${publicKey.slice(0, 8)} ` +
      `(type: ${nodeType || 'light'})`
    );

    // Send confirmation
    this.send(ws, {
      type: 'register',
      payload: {
        success: true,
        connectedPeers: this.clients.size
      }
    });
  }

  /**
   * Handle WebRTC signaling
   */
  private handleSignal(ws: WebSocket, message: RelayMessage): void {
    const { to, payload } = message;

    if (!to) {
      this.sendError(ws, 'Missing recipient in signal');
      return;
    }

    const recipient = this.clients.get(to);
    if (!recipient) {
      this.sendError(ws, `Recipient ${to.slice(0, 8)} not connected`);
      return;
    }

    // Forward signal to recipient
    this.send(recipient.ws, {
      type: 'signal',
      from: message.from,
      to,
      payload
    });

    console.log(
      `[RelayServer] Forwarded signal: ${message.from?.slice(0, 8)} -> ${to.slice(0, 8)}`
    );
  }

  /**
   * Handle message forwarding
   */
  private handleForward(ws: WebSocket, message: RelayMessage): void {
    const { to, payload } = message;

    if (!to) {
      this.sendError(ws, 'Missing recipient in forward');
      return;
    }

    const recipient = this.clients.get(to);
    if (!recipient) {
      this.sendError(ws, `Recipient ${to.slice(0, 8)} not connected`);
      return;
    }

    // Forward message
    this.send(recipient.ws, {
      type: 'forward',
      from: message.from,
      to,
      payload
    });
  }

  /**
   * Handle peer query
   */
  private handleQueryPeers(ws: WebSocket, message: RelayMessage): void {
    const { maxResults = 10 } = message.payload;

    // Return list of connected peers (excluding requester)
    const peers = Array.from(this.clients.values())
      .filter(client => client.ws !== ws)
      .slice(0, maxResults)
      .map(client => ({
        publicKey: client.publicKey,
        nodeType: client.nodeType,
        lastSeen: client.lastSeen
      }));

    this.send(ws, {
      type: 'query_peers',
      payload: { peers }
    });

    console.log(`[RelayServer] Sent ${peers.length} peer(s) to query`);
  }

  /**
   * Send message to WebSocket
   */
  private send(ws: WebSocket, message: RelayMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send error message
   */
  private sendError(ws: WebSocket, error: string): void {
    this.send(ws, {
      type: 'forward' as RelayMessageType, // Type assertion for error messages
      payload: { error }
    });
  }

  /**
   * Periodic maintenance
   */
  private startMaintenance(): void {
    setInterval(() => {
      const now = Date.now();
      const TIMEOUT = 5 * 60 * 1000; // 5 minutes

      // Remove stale clients
      for (const [publicKey, client] of this.clients.entries()) {
        if (now - client.lastSeen > TIMEOUT) {
          console.log(`[RelayServer] Removing stale client ${publicKey.slice(0, 8)}`);
          client.ws.close();
          this.clients.delete(publicKey);
        }
      }

      console.log(`[RelayServer] ${this.clients.size} clients connected`);
    }, 60_000); // Every minute
  }

  /**
   * Get server statistics
   */
  getStats() {
    return {
      connectedClients: this.clients.size,
      clients: Array.from(this.clients.values()).map(c => ({
        publicKey: c.publicKey.slice(0, 8),
        nodeType: c.nodeType,
        lastSeen: new Date(c.lastSeen).toISOString()
      }))
    };
  }

  /**
   * Stop relay server
   */
  async stop(): Promise<void> {
    if (this.wss) {
      this.wss.close();
      console.log('[RelayServer] Stopped');
    }
  }
}
