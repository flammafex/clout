/**
 * Clout - Uncensorable Reputation Protocol
 *
 * Main entry point for the Clout protocol.
 *
 * Built by inverting Scarcity's logic:
 * - Scarcity: Gossip to STOP data (prevent double-spends)
 * - Clout: Gossip to SPREAD data (propagate posts and trust)
 *
 * The Five Phases:
 * 1. Trust (Identity using Freebird)
 * 2. Post (Immutable content)
 * 3. ContentGossip (Trust-based propagation)
 * 4. Reputation (Graph distance filtering)
 * 5. State Sync (CRDT-based state)
 */

// Main Clout protocol
export { Clout } from './clout.js';
export type { CloutConfig } from './clout.js';

// Core primitives
export { CloutIdentity } from './identity.js';
export type { IdentityConfig } from './identity.js';

export { CloutPost } from './post.js';
export type { PostConfig } from './post.js';

export { ContentGossip } from './content-gossip.js';
export type { ContentGossipConfig } from './content-gossip.js';

export { ReputationValidator } from './reputation.js';
export type { ReputationConfig } from './reputation.js';

export { CloutStateManager } from './chronicle/clout-state.js';

export { InvitationManager } from './invitation.js';
export type { Invitation, SigningFunction } from './invitation.js';

// Storage (WNFS-based media storage)
export { StorageManager, FileBlockStore } from './storage/wnfs-manager.js';
export type {
  MediaMetadata as StorageMediaMetadata,
  BlockStore,
  StorageManagerConfig
} from './storage/wnfs-manager.js';

// Types
export type {
  CloutProfile,
  PostPackage,
  TrustSignal,
  TrustSettings,
  Feed,
  ContentGossipMessage,
  SignedContentGossipMessage,
  ReputationScore,
  CloutState,
  MediaMetadata,
  MediaInput
} from './clout-types.js';

export { DEFAULT_TRUST_SETTINGS } from './clout-types.js';

// Network layer (Phase 6: P2P Integration)
export { CloutNode } from './network/clout-node.js';
export { PeerManager } from './network/peer-manager.js';
export { DHTDiscovery } from './network/dht-discovery.js';
export { RelayServer } from './network/relay-server.js';
export { RelayClient } from './network/relay-client.js';
export { WebRTCPeer } from './network/webrtc-peer.js';

export type {
  NetworkConfig,
  NetworkPeer,
  NodeType,
  PeerState,
  PeerMetadata,
  PeerInfo,
  PeerDiscovery,
  NetworkStats,
  NetworkMessage,
  RelayMessage
} from './network-types.js';

// Re-export Scarcity infrastructure (crypto, integrations, etc.)
export { Crypto } from './crypto.js';
export { FreebirdAdapter } from './integrations/freebird.js';
export { WitnessAdapter } from './integrations/witness.js';
export { TorProxy } from './tor.js';

export type {
  PublicKey,
  PrivateKey,
  KeyPair,
  Attestation,
  FreebirdClient,
  WitnessClient,
  TorConfig
} from './types.js';
