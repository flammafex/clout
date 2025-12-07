/**
 * Relay Client - Connects to relay server for signaling and discovery
 *
 * Used by light clients to:
 * 1. Register with relay
 * 2. Discover peers
 * 3. Perform WebRTC signaling
 * 4. Forward messages when direct connection unavailable
 *
 * Security:
 * - Completes challenge-response authentication before registration
 * - Signs auth challenge with Ed25519 to prove identity
 */

/// <reference types="node" />

import { WebSocket } from 'ws';
import type { RelayMessage, PeerDiscovery, PeerInfo, NodeType } from '../network-types.js';
import { NodeType as NT, RelayMessageType } from '../network-types.js';
import { Crypto } from '../crypto.js';
import { TorProxy, type TorConfig } from '../tor.js';

export interface RelayClientConfig {
  readonly publicKey: string;
  readonly nodeType: NodeType;
  readonly relayUrl: string;

  /**
   * Ed25519 private key for signing authentication challenges.
   * Required for connecting to relays that require authentication.
   * The key should correspond to the publicKey.
   */
  readonly privateKey?: Uint8Array;

  /**
   * Tor configuration for anonymous relay connections.
   * When provided, connections are routed through Tor SOCKS5 proxy.
   *
   * Security benefits:
   * - Hides client IP address from relay operator
   * - Prevents traffic analysis correlation
   * - Required for connecting to .onion relay addresses
   */
  readonly tor?: TorConfig;

  /**
   * Require Tor for all connections (default: false).
   * When true, refuses to connect if Tor is unavailable.
   * When false, uses Tor if configured, falls back to direct connection.
   */
  readonly requireTor?: boolean;
}

type MessageHandler = (message: RelayMessage) => void;
type ReconnectHandler = () => void;

/**
 * Client for connecting to Clout relay server
 */
export class RelayClient implements PeerDiscovery {
  private readonly config: RelayClientConfig;
  private readonly torProxy?: TorProxy;
  private readonly requireTor: boolean;
  private ws?: WebSocket;
  private connected = false;
  private authenticated = false;
  private usingTor = false;
  private wasConnectedBefore = false;
  private messageHandlers: MessageHandler[] = [];
  private reconnectHandlers: ReconnectHandler[] = [];
  private reconnectTimer?: NodeJS.Timeout;
  private authResolve?: () => void;
  private authReject?: (error: Error) => void;

  constructor(config: RelayClientConfig) {
    this.config = config;
    this.requireTor = config.requireTor ?? false;

    // Initialize Tor proxy if configured
    if (config.tor) {
      this.torProxy = new TorProxy(config.tor);
    }

    // Auto-detect: require Tor for .onion addresses
    if (TorProxy.isOnionUrl(config.relayUrl)) {
      if (!this.torProxy) {
        throw new Error(
          `Cannot connect to .onion relay without Tor configuration.\n` +
          `Relay URL: ${config.relayUrl}\n` +
          `Please provide tor config in RelayClientConfig.`
        );
      }
    }
  }

  /**
   * Connect to relay server
   *
   * Handles authentication flow:
   * 1. Connect WebSocket (through Tor if configured)
   * 2. Receive auth challenge from server
   * 3. Sign challenge and respond
   * 4. Wait for auth success
   * 5. Register with relay
   *
   * Privacy: When Tor is configured, the relay server cannot see
   * the client's real IP address. Only the Tor exit node IP is visible.
   */
  async connect(): Promise<void> {
    // Determine if we should use Tor for this connection
    const isOnion = TorProxy.isOnionUrl(this.config.relayUrl);
    const shouldUseTor = this.torProxy && (isOnion || this.requireTor || this.torProxy.shouldProxy(this.config.relayUrl));

    // Verify Tor is available if required
    if (this.requireTor && !this.torProxy) {
      throw new Error(
        'Tor is required but not configured.\n' +
        'Set requireTor: false or provide tor config in RelayClientConfig.'
      );
    }

    if (shouldUseTor && this.torProxy) {
      // Verify Tor connection is available
      const torAvailable = await this.torProxy.checkConnection().catch(() => false);
      if (!torAvailable) {
        if (this.requireTor || isOnion) {
          throw new Error(
            `Tor proxy is not available at ${this.torProxy['proxyHost']}:${this.torProxy['proxyPort']}.\n` +
            'Please ensure Tor is running and the SOCKS5 proxy is accessible.'
          );
        }
        console.warn('[RelayClient] Tor unavailable, falling back to direct connection');
      }
    }

    return new Promise((resolve, reject) => {
      // Create WebSocket with Tor agent if configured
      const wsOptions = shouldUseTor && this.torProxy
        ? this.torProxy.getWebSocketOptions(this.config.relayUrl)
        : {};

      this.ws = new WebSocket(this.config.relayUrl, wsOptions);
      this.usingTor = Boolean(shouldUseTor) && Object.keys(wsOptions).length > 0;

      this.ws.on('open', () => {
        const torStatus = this.usingTor ? ' (via Tor)' : '';
        console.log(`[RelayClient] Connected to ${this.config.relayUrl}${torStatus}`);
        this.connected = true;
        // Don't register yet - wait for auth challenge
        // If no auth required, server won't send challenge and we can register immediately
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString()) as RelayMessage;
          this.handleMessage(message, resolve, reject);
        } catch (error) {
          console.warn('[RelayClient] Invalid message:', error);
        }
      });

      this.ws.on('close', () => {
        console.log('[RelayClient] Disconnected from relay');
        this.connected = false;
        this.authenticated = false;
        this.scheduleReconnect();
      });

      this.ws.on('error', (error) => {
        console.warn('[RelayClient] Error:', error);
        reject(error);
      });

      // Timeout for initial connection + auth
      setTimeout(() => {
        if (!this.authenticated && this.connected) {
          // No auth challenge received - server doesn't require auth
          console.log('[RelayClient] No auth challenge received - server may not require auth');
          this.register();
          this.wasConnectedBefore = true;
          resolve();
        }
      }, 2000);
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
  private handleMessage(
    message: RelayMessage,
    connectResolve?: () => void,
    connectReject?: (error: Error) => void
  ): void {
    // Handle authentication flow
    if (message.type === RelayMessageType.AUTH_CHALLENGE) {
      this.handleAuthChallenge(message, connectResolve, connectReject);
      return;
    }

    if (message.type === RelayMessageType.AUTH_RESPONSE) {
      this.handleAuthSuccess(message, connectResolve);
      return;
    }

    if (message.type === RelayMessageType.ERROR) {
      console.error('[RelayClient] Error from relay:', message.payload.error);
      if (connectReject && !this.authenticated) {
        connectReject(new Error(message.payload.error));
      }
      return;
    }

    // Notify all handlers
    for (const handler of this.messageHandlers) {
      handler(message);
    }
  }

  /**
   * Handle authentication challenge from server
   */
  private handleAuthChallenge(
    message: RelayMessage,
    connectResolve?: () => void,
    connectReject?: (error: Error) => void
  ): void {
    const { nonce } = message.payload;

    if (!nonce) {
      console.error('[RelayClient] Invalid auth challenge - missing nonce');
      if (connectReject) {
        connectReject(new Error('Invalid auth challenge'));
      }
      return;
    }

    console.log('[RelayClient] Received auth challenge');

    // Check if we have a private key for signing
    if (!this.config.privateKey) {
      console.error('[RelayClient] Cannot authenticate - no privateKey configured');
      if (connectReject) {
        connectReject(new Error('Authentication required but no privateKey provided'));
      }
      return;
    }

    try {
      // Sign: nonce + publicKey
      const signedData = nonce + this.config.publicKey;
      const signedBytes = new TextEncoder().encode(signedData);
      const signature = Crypto.sign(signedBytes, this.config.privateKey);

      // Send auth response
      this.send({
        type: RelayMessageType.AUTH_RESPONSE,
        from: this.config.publicKey,
        payload: {
          publicKey: this.config.publicKey,
          signature: Crypto.toHex(signature)
        }
      });

      console.log('[RelayClient] Sent auth response');

      // Store resolve/reject for when we get success/failure
      this.authResolve = connectResolve;
      this.authReject = connectReject;

    } catch (error) {
      console.error('[RelayClient] Failed to sign auth challenge:', error);
      if (connectReject) {
        connectReject(error as Error);
      }
    }
  }

  /**
   * Handle successful authentication response
   */
  private handleAuthSuccess(message: RelayMessage, connectResolve?: () => void): void {
    if (message.payload.success) {
      console.log('[RelayClient] ✓ Authentication successful');
      this.authenticated = true;

      // Now register with relay
      this.register();
      this.wasConnectedBefore = true;

      // Resolve connect promise
      if (this.authResolve) {
        this.authResolve();
        this.authResolve = undefined;
        this.authReject = undefined;
      } else if (connectResolve) {
        connectResolve();
      }
    } else {
      console.error('[RelayClient] Authentication failed');
      if (this.authReject) {
        this.authReject(new Error('Authentication failed'));
        this.authResolve = undefined;
        this.authReject = undefined;
      }
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
   * Add reconnect handler
   *
   * Called when the client reconnects after a disconnection.
   * Useful for triggering state sync after network partition heals.
   */
  onReconnect(handler: ReconnectHandler): void {
    this.reconnectHandlers.push(handler);
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
      this.connect()
        .then(() => {
          // Notify reconnect handlers for state sync
          if (this.wasConnectedBefore) {
            console.log('[RelayClient] Reconnected - triggering sync handlers');
            for (const handler of this.reconnectHandlers) {
              try {
                handler();
              } catch (err) {
                console.warn('[RelayClient] Reconnect handler error:', err);
              }
            }
          }
        })
        .catch(err => {
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
   * Check if authenticated with relay
   */
  isAuthenticated(): boolean {
    return this.authenticated;
  }

  /**
   * Check if connection is using Tor
   *
   * Returns true when:
   * - Connected via Tor SOCKS5 proxy
   * - Connecting to .onion address
   * - forceProxy is enabled in Tor config
   */
  isUsingTor(): boolean {
    return this.usingTor;
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

    // Clean up Tor proxy resources
    if (this.torProxy) {
      this.torProxy.destroy();
    }

    this.connected = false;
    this.authenticated = false;
    console.log('[RelayClient] Disconnected');
  }
}
