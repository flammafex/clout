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

// Types
export type {
  CloutProfile,
  PostPackage,
  TrustSignal,
  Feed,
  ContentGossipMessage,
  ReputationScore,
  CloutState
} from './clout-types.js';

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
