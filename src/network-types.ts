/**
 * Network layer types for Clout P2P protocol
 *
 * Supports both light clients and full relay nodes with hybrid discovery.
 */

import type { ContentGossipMessage } from './clout-types.js';

// Re-export for network modules
export type { ContentGossipMessage };

/**
 * Node types in the Clout network
 */
export enum NodeType {
  /** Light client (mobile/desktop app, limited storage, connects to relays) */
  LIGHT = 'light',

  /** Full node (always-on server, relays for others, full history) */
  FULL = 'full'
}

/**
 * Peer connection state
 */
export enum PeerState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  FAILED = 'failed'
}

/**
 * Connection metadata for a peer
 */
export interface PeerMetadata {
  /** Peer's public key (identity) */
  readonly publicKey: string;

  /** Peer's node type */
  readonly nodeType: NodeType;

  /** Connection state */
  state: PeerState;

  /** Trust distance from us (0 = self, 1 = direct follow, etc.) */
  readonly distance: number;

  /** Last seen timestamp */
  lastSeen: number;

  /** Connection quality metrics */
  metrics?: {
    latency: number;      // Average RTT in ms
    messagesSent: number;
    messagesReceived: number;
    bytesTransferred: number;
  };

  /** Remote address (for relay nodes) */
  remoteAddress?: string;
}

/**
 * Network configuration
 */
export interface NetworkConfig {
  /** This node's type */
  readonly nodeType: NodeType;

  /** Public key (identity) */
  readonly publicKey: string;

  /** Trust graph (Set of public keys we trust) */
  readonly trustGraph: Set<string>;

  /** Relay servers to connect to (for bootstrap and NAT traversal) */
  readonly relayServers?: string[];

  /** Enable DHT-based peer discovery */
  readonly enableDHT?: boolean;

  /** Maximum number of peers to maintain */
  readonly maxPeers?: number;

  /** Port for full nodes to listen on */
  readonly listenPort?: number;

  /** WebRTC configuration */
  readonly webrtc?: {
    iceServers: RTCIceServer[];
  };
}

/**
 * Peer connection interface (compatible with existing gossip)
 */
export interface NetworkPeer {
  readonly id: string;
  readonly publicKey: string;
  readonly metadata: PeerMetadata;

  /** Send a message to this peer */
  send(message: ContentGossipMessage): Promise<void>;

  /** Check if connected */
  isConnected(): boolean;

  /** Set message handler */
  setMessageHandler?(handler: (message: ContentGossipMessage) => void): void;

  /** Disconnect from peer */
  disconnect(): void;
}

/**
 * Peer discovery interface
 */
export interface PeerDiscovery {
  /** Find peers for a given public key */
  findPeers(publicKey: string, maxResults?: number): Promise<PeerInfo[]>;

  /** Announce our presence */
  announce(publicKey: string, address: string): Promise<void>;

  /** Bootstrap from known relays */
  bootstrap(relays: string[]): Promise<void>;
}

/**
 * Peer information from discovery
 */
export interface PeerInfo {
  readonly publicKey: string;
  readonly nodeType: NodeType;
  readonly addresses: string[];  // WebRTC connection strings or relay addresses
  readonly lastSeen: number;
}

/**
 * Network message types
 */
export enum NetworkMessageType {
  /** Gossip message (post or trust signal) */
  GOSSIP = 'gossip',

  /** Peer discovery/exchange */
  PEER_EXCHANGE = 'peer_exchange',

  /** DHT query/response */
  DHT = 'dht',

  /** Ping/pong for keepalive */
  PING = 'ping',
  PONG = 'pong'
}

/**
 * Network message envelope
 */
export interface NetworkMessage {
  readonly type: NetworkMessageType;
  readonly from: string;  // Sender's public key
  readonly to?: string;   // Recipient's public key (optional, for direct messages)
  readonly timestamp: number;
  readonly payload: any;
}

/**
 * Relay server message types
 */
export enum RelayMessageType {
  /** Register with relay */
  REGISTER = 'register',

  /** Forward message to peer */
  FORWARD = 'forward',

  /** WebRTC signaling (offer/answer/ice) */
  SIGNAL = 'signal',

  /** Query for peers */
  QUERY_PEERS = 'query_peers',

  /**
   * Authentication challenge from server
   * Server sends random nonce that client must sign
   */
  AUTH_CHALLENGE = 'auth_challenge',

  /**
   * Authentication response from client
   * Client sends Ed25519 signature of: nonce + publicKey
   */
  AUTH_RESPONSE = 'auth_response',

  /** Error message */
  ERROR = 'error'
}

/**
 * Relay message
 */
export interface RelayMessage {
  readonly type: RelayMessageType;
  readonly from?: string;
  readonly to?: string;
  readonly payload: any;
}

/**
 * DHT operations
 */
export enum DHTOperation {
  /** Store value in DHT */
  STORE = 'store',

  /** Find value in DHT */
  FIND_VALUE = 'find_value',

  /** Find peers close to key */
  FIND_NODE = 'find_node'
}

/**
 * DHT message
 */
export interface DHTMessage {
  readonly operation: DHTOperation;
  readonly key: string;
  readonly value?: any;
  readonly ttl?: number;  // Time to live in seconds
}

/**
 * Network statistics
 */
export interface NetworkStats {
  readonly nodeType: NodeType;
  readonly totalPeers: number;
  readonly connectedPeers: number;
  readonly trustGraphSize: number;

  /** Peers by distance */
  readonly peersByDistance: {
    distance0: number;  // Self
    distance1: number;  // Direct follows
    distance2: number;  // Friends of friends
    distance3: number;  // 3 hops
  };

  /** Traffic stats */
  readonly traffic: {
    messagesSent: number;
    messagesReceived: number;
    bytesTransferred: number;
  };

  /** Connection quality */
  readonly avgLatency: number;
  readonly avgPeerCount: number;
}
