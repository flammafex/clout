/**
 * Relay Server for Clout P2P network
 *
 * Provides:
 * 1. WebRTC signaling (ICE, offer/answer)
 * 2. Bootstrap peer discovery
 * 3. NAT traversal support
 * 4. Message forwarding for unreachable peers
 *
 * Security:
 * - Challenge-response authentication required before peer discovery
 * - Clients must prove ownership of their publicKey via Ed25519 signature
 * - Unauthenticated clients cannot query peer lists or forward messages
 */

/// <reference types="node" />

import { WebSocketServer, WebSocket } from 'ws';
import type { RelayMessage } from '../network-types.js';
import { RelayMessageType } from '../network-types.js';
import { Crypto } from '../crypto.js';

/** Pending authentication challenge for a connection */
interface PendingAuth {
  readonly nonce: string;
  readonly issuedAt: number;
}

interface RegisteredClient {
  readonly publicKey: string;
  readonly ws: WebSocket;
  readonly nodeType: string;
  readonly authenticated: boolean;
  registeredAt: number;
  lastSeen: number;
}

export interface RelayServerConfig {
  readonly port: number;
  readonly host?: string;

  /**
   * Whether to require authentication for peer discovery.
   * When true (default), clients must complete challenge-response auth.
   * When false, allows unauthenticated access (NOT RECOMMENDED for production).
   */
  readonly requireAuth?: boolean;

  /**
   * Challenge expiry time in milliseconds (default: 30 seconds)
   */
  readonly challengeExpiry?: number;

  /**
   * Enable Tor-only mode for maximum privacy.
   *
   * When enabled:
   * - Server binds to 127.0.0.1 only (localhost)
   * - Designed to be exposed only via Tor hidden service
   * - Relay operator cannot see client IP addresses
   * - Clients must connect via .onion address
   *
   * To set up a Tor hidden service, add to torrc:
   *   HiddenServiceDir /var/lib/tor/clout-relay/
   *   HiddenServicePort 80 127.0.0.1:PORT
   *
   * The .onion address will be in /var/lib/tor/clout-relay/hostname
   */
  readonly torOnly?: boolean;

  /**
   * Optional: Onion address for this relay (for logging/discovery)
   * Format: xxxx.onion (without port)
   */
  readonly onionAddress?: string;
}

/**
 * Relay server for WebRTC signaling and peer discovery
 */
export class RelayServer {
  private readonly config: RelayServerConfig;
  private readonly requireAuth: boolean;
  private readonly challengeExpiry: number;
  private readonly torOnly: boolean;
  private wss?: WebSocketServer;
  private readonly clients = new Map<string, RegisteredClient>();
  private readonly pendingAuth = new Map<WebSocket, PendingAuth>();
  /** Track WebSockets that have successfully completed authentication */
  private readonly authenticatedWs = new Set<WebSocket>();
  /** Map WebSocket to authenticated publicKey for sender verification */
  private readonly wsToPublicKey = new Map<WebSocket, string>();
  /** Track recent message IDs for deduplication (reduces bandwidth) */
  private readonly recentMessageIds = new Map<string, number>();
  /** How long to remember message IDs for deduplication (5 minutes) */
  private readonly messageDedupeExpiry = 5 * 60 * 1000;

  constructor(config: RelayServerConfig) {
    this.config = config;
    this.requireAuth = config.requireAuth ?? true; // Default: require auth
    this.challengeExpiry = config.challengeExpiry ?? 30_000; // 30 seconds
    this.torOnly = config.torOnly ?? false;

    // Validate Tor-only mode configuration
    if (this.torOnly) {
      if (config.host && config.host !== '127.0.0.1' && config.host !== 'localhost') {
        console.warn(
          '[RelayServer] ⚠️ WARNING: torOnly mode enabled but host is not localhost.\n' +
          'For maximum privacy, the server should only bind to 127.0.0.1 and be\n' +
          'exposed via Tor hidden service. This prevents seeing client IP addresses.'
        );
      }
    }
  }

  /**
   * Start relay server
   */
  async start(): Promise<void> {
    // In Tor-only mode, force binding to localhost only
    const host = this.torOnly
      ? '127.0.0.1'
      : (this.config.host || '0.0.0.0');

    this.wss = new WebSocketServer({
      port: this.config.port,
      host
    });

    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws);
    });

    this.wss.on('error', (error) => {
      console.error('[RelayServer] Error:', error);
    });

    // Start maintenance
    this.startMaintenance();

    // Log startup with Tor mode information
    if (this.torOnly) {
      console.log(`[RelayServer] 🧅 Started in Tor-only mode on ${host}:${this.config.port}`);
      console.log('[RelayServer] Server is only accessible via Tor hidden service');
      if (this.config.onionAddress) {
        console.log(`[RelayServer] Onion address: ${this.config.onionAddress}`);
      } else {
        console.log('[RelayServer] Configure onionAddress in config to display .onion address');
      }
      console.log('[RelayServer] Client IP addresses are hidden from relay operator');
    } else {
      console.log(`[RelayServer] Started on ${host}:${this.config.port}`);
    }
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket): void {
    console.log('[RelayServer] New connection');

    // Generate and send authentication challenge
    if (this.requireAuth) {
      const nonce = Crypto.toHex(Crypto.randomBytes(32));
      this.pendingAuth.set(ws, {
        nonce,
        issuedAt: Date.now()
      });

      this.send(ws, {
        type: RelayMessageType.AUTH_CHALLENGE,
        payload: { nonce }
      });
      console.log('[RelayServer] Sent auth challenge');
    }

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as RelayMessage;
        this.handleMessage(ws, message);
      } catch (error) {
        console.warn('[RelayServer] Invalid message:', error);
      }
    });

    ws.on('close', () => {
      // Clean up all tracking structures
      this.pendingAuth.delete(ws);
      this.authenticatedWs.delete(ws);
      this.wsToPublicKey.delete(ws);

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
      case 'auth_response':
        this.handleAuthResponse(ws, message);
        break;

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
   * Handle authentication response
   *
   * Verifies the client's Ed25519 signature over nonce + publicKey
   */
  private handleAuthResponse(ws: WebSocket, message: RelayMessage): void {
    const { publicKey, signature } = message.payload;

    if (!publicKey || !signature) {
      this.sendError(ws, 'Missing publicKey or signature in auth response');
      return;
    }

    // Get pending challenge
    const pending = this.pendingAuth.get(ws);
    if (!pending) {
      this.sendError(ws, 'No pending authentication challenge');
      return;
    }

    // Check challenge expiry
    if (Date.now() - pending.issuedAt > this.challengeExpiry) {
      this.pendingAuth.delete(ws);
      this.sendError(ws, 'Authentication challenge expired');
      return;
    }

    // Verify signature: sign(nonce + publicKey)
    try {
      const signedData = pending.nonce + publicKey;
      const signedBytes = new TextEncoder().encode(signedData);
      const signatureBytes = Crypto.fromHex(signature);
      const publicKeyBytes = Crypto.fromHex(publicKey);

      const valid = Crypto.verify(signedBytes, signatureBytes, publicKeyBytes);

      if (!valid) {
        console.warn(`[RelayServer] ⚠️ Invalid signature from ${publicKey.slice(0, 8)}`);
        this.sendError(ws, 'Invalid signature - authentication failed');
        this.pendingAuth.delete(ws);
        ws.close(4001, 'Authentication failed');
        return;
      }

      // Authentication successful - clean up pending auth and track success
      this.pendingAuth.delete(ws);
      this.authenticatedWs.add(ws);
      this.wsToPublicKey.set(ws, publicKey);

      console.log(`[RelayServer] ✓ Authenticated ${publicKey.slice(0, 8)}`);

      // Send success response
      this.send(ws, {
        type: RelayMessageType.AUTH_RESPONSE,
        payload: {
          success: true,
          publicKey
        }
      });

    } catch (error) {
      console.error('[RelayServer] Auth verification error:', error);
      this.sendError(ws, 'Authentication verification failed');
      this.pendingAuth.delete(ws);
      ws.close(4001, 'Authentication failed');
    }
  }

  /**
   * Check if a WebSocket connection is authenticated
   */
  private isAuthenticated(ws: WebSocket): boolean {
    // If auth not required, always return true
    if (!this.requireAuth) {
      return true;
    }

    // Check if client is registered and authenticated
    for (const client of this.clients.values()) {
      if (client.ws === ws && client.authenticated) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a WebSocket has completed auth challenge successfully
   */
  private hasCompletedAuth(ws: WebSocket): boolean {
    if (!this.requireAuth) {
      return true;
    }

    // Check if client successfully completed authentication
    return this.authenticatedWs.has(ws);
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

    // Check if client completed auth challenge
    if (!this.hasCompletedAuth(ws)) {
      this.sendError(ws, 'Must complete authentication challenge before registering');
      return;
    }

    // Verify the publicKey matches the authenticated identity
    if (this.requireAuth) {
      const authenticatedAs = this.wsToPublicKey.get(ws);
      if (authenticatedAs !== publicKey) {
        console.warn(
          `[RelayServer] ⚠️ Registration identity mismatch: ` +
          `authenticated as ${authenticatedAs?.slice(0, 8)}, trying to register as ${publicKey.slice(0, 8)}`
        );
        this.sendError(ws, 'Registration publicKey must match authenticated identity');
        return;
      }
    }

    // Register client (authenticated since they passed the challenge)
    this.clients.set(publicKey, {
      publicKey,
      ws,
      nodeType: nodeType || 'light',
      authenticated: true,
      registeredAt: Date.now(),
      lastSeen: Date.now()
    });

    console.log(
      `[RelayServer] Registered ${publicKey.slice(0, 8)} ` +
      `(type: ${nodeType || 'light'}, authenticated: true)`
    );

    // Send confirmation
    this.send(ws, {
      type: RelayMessageType.REGISTER,
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
    const { to, payload, from } = message;

    if (!to) {
      this.sendError(ws, 'Missing recipient in signal');
      return;
    }

    // Verify sender identity to prevent spoofing
    const authenticatedAs = this.wsToPublicKey.get(ws);
    if (!authenticatedAs) {
      this.sendError(ws, 'Must register before sending signals');
      return;
    }

    if (from !== authenticatedAs) {
      console.warn(
        `[RelayServer] ⚠️ Sender spoofing attempt: ` +
        `claimed ${from?.slice(0, 8)}, actually ${authenticatedAs.slice(0, 8)}`
      );
      this.sendError(ws, 'Sender identity mismatch');
      return;
    }

    const recipient = this.clients.get(to);
    if (!recipient) {
      this.sendError(ws, `Recipient ${to.slice(0, 8)} not connected`);
      return;
    }

    // Forward signal to recipient with verified sender
    this.send(recipient.ws, {
      type: RelayMessageType.SIGNAL,
      from: authenticatedAs,
      to,
      payload
    });

    console.log(
      `[RelayServer] Forwarded signal: ${authenticatedAs.slice(0, 8)} -> ${to.slice(0, 8)}`
    );
  }

  /**
   * Handle message forwarding
   */
  private handleForward(ws: WebSocket, message: RelayMessage): void {
    const { to, payload, from } = message;

    if (!to) {
      this.sendError(ws, 'Missing recipient in forward');
      return;
    }

    // Verify sender identity to prevent spoofing
    const authenticatedAs = this.wsToPublicKey.get(ws);
    if (!authenticatedAs) {
      this.sendError(ws, 'Must register before forwarding messages');
      return;
    }

    if (from !== authenticatedAs) {
      console.warn(
        `[RelayServer] ⚠️ Forward spoofing attempt: ` +
        `claimed ${from?.slice(0, 8)}, actually ${authenticatedAs.slice(0, 8)}`
      );
      this.sendError(ws, 'Sender identity mismatch');
      return;
    }

    // Deduplicate messages by ID to reduce bandwidth
    const messageId = payload?.id;
    if (messageId && typeof messageId === 'string') {
      if (this.recentMessageIds.has(messageId)) {
        // Already forwarded this message recently, skip
        return;
      }
      this.recentMessageIds.set(messageId, Date.now());
    }

    const recipient = this.clients.get(to);
    if (!recipient) {
      this.sendError(ws, `Recipient ${to.slice(0, 8)} not connected`);
      return;
    }

    // Forward message with verified sender
    this.send(recipient.ws, {
      type: RelayMessageType.FORWARD,
      from: authenticatedAs,
      to,
      payload
    });
  }

  /**
   * Handle peer query
   *
   * Security: Only authenticated clients can query peers.
   * This prevents unauthenticated parties from mapping the network.
   */
  private handleQueryPeers(ws: WebSocket, message: RelayMessage): void {
    // Require authentication for peer discovery
    if (!this.isAuthenticated(ws)) {
      console.warn('[RelayServer] ⚠️ Unauthenticated peer query rejected');
      this.sendError(ws, 'Authentication required for peer discovery');
      return;
    }

    const { maxResults = 10 } = message.payload;

    // Return list of connected peers (excluding requester)
    // Only return authenticated peers
    const peers = Array.from(this.clients.values())
      .filter(client => client.ws !== ws && client.authenticated)
      .slice(0, maxResults)
      .map(client => ({
        publicKey: client.publicKey,
        nodeType: client.nodeType,
        lastSeen: client.lastSeen
      }));

    this.send(ws, {
      type: RelayMessageType.QUERY_PEERS,
      payload: { peers }
    });

    console.log(`[RelayServer] Sent ${peers.length} peer(s) to authenticated query`);
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
      type: RelayMessageType.ERROR,
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

      // Clean up expired auth challenges (prevents memory leak from abandoned connections)
      for (const [ws, pending] of this.pendingAuth.entries()) {
        if (now - pending.issuedAt > this.challengeExpiry) {
          console.log('[RelayServer] Cleaning up expired auth challenge');
          this.pendingAuth.delete(ws);
          ws.close(4002, 'Authentication timeout');
        }
      }

      // Remove stale clients
      for (const [publicKey, client] of this.clients.entries()) {
        if (now - client.lastSeen > TIMEOUT) {
          console.log(`[RelayServer] Removing stale client ${publicKey.slice(0, 8)}`);
          client.ws.close();
          this.clients.delete(publicKey);
        }
      }

      // Clean up old message IDs for deduplication
      for (const [messageId, timestamp] of this.recentMessageIds.entries()) {
        if (now - timestamp > this.messageDedupeExpiry) {
          this.recentMessageIds.delete(messageId);
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
      torOnly: this.torOnly,
      onionAddress: this.config.onionAddress,
      requireAuth: this.requireAuth,
      clients: Array.from(this.clients.values()).map(c => ({
        publicKey: c.publicKey.slice(0, 8),
        nodeType: c.nodeType,
        lastSeen: new Date(c.lastSeen).toISOString()
      }))
    };
  }

  /**
   * Check if server is running in Tor-only mode
   */
  isTorOnly(): boolean {
    return this.torOnly;
  }

  /**
   * Get the onion address (if configured)
   */
  getOnionAddress(): string | undefined {
    return this.config.onionAddress;
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
