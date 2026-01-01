/**
 * Infrastructure initialization for Clout CLI
 *
 * Initializes Witness, Freebird, HyperToken P2P, and ContentGossip for Clout
 */

import {
  FreebirdAdapter,
  WitnessAdapter,
  ContentGossip
} from '../index.js';
import { HyperTokenAdapter } from '../integrations/hypertoken.js';
import { ConfigManager } from './config.js';

export interface Infrastructure {
  freebird: FreebirdAdapter;
  witness: WitnessAdapter;
  gossip: ContentGossip;
  hypertoken: HyperTokenAdapter;
}

export interface InitializeOptions {
  /** User's public key (hex string) for Freebird owner identification */
  userPublicKey?: string;
  /** Whether this user is the Freebird instance owner */
  isOwner?: boolean;
  /** Whether user is already registered with Freebird (can renew Day Pass without invitation) */
  isFreebirdRegistered?: boolean;
}

export class InfrastructureManager {
  private config: ConfigManager;
  private infrastructure?: Infrastructure;

  constructor(config?: ConfigManager) {
    this.config = config || new ConfigManager();
  }

  /**
   * Initialize infrastructure
   *
   * @param options Optional initialization options (owner info, etc.)
   */
  async initialize(options?: InitializeOptions): Promise<Infrastructure> {
    if (this.infrastructure) {
      return this.infrastructure;
    }

    // Initialize Freebird with owner info if available
    const baseFreebirdConfig = this.config.getFreebirdConfig();
    const freebirdConfig = {
      ...baseFreebirdConfig,
      userPublicKey: options?.userPublicKey,
      isOwner: options?.isOwner,
      // If user is already registered with Freebird, use 'registered' mode for Day Pass renewal
      // This allows renewal without requiring a new invitation code
      sybilMode: (options?.isFreebirdRegistered && baseFreebirdConfig.sybilMode === 'invitation')
        ? 'registered' as const
        : baseFreebirdConfig.sybilMode
    };
    const freebird = new FreebirdAdapter(freebirdConfig);

    // Initialize Witness
    const witness = new WitnessAdapter(this.config.getWitnessConfig());

    // Initialize ContentGossip for Clout (trust-based propagation)
    const gossip = new ContentGossip({
      witness,
      freebird,
      trustGraph: new Set<string>(), // Empty initially, will be populated by Clout
      maxHops: 3
    });

    // Initialize HyperToken P2P adapter
    const hypertoken = new HyperTokenAdapter(this.config.getHyperTokenConfig());

    // Wire up peer discovery: when HyperToken discovers peers, add them to gossip
    hypertoken.setPeerDiscoveryHandler((peer) => {
      console.log(`[Infrastructure] New peer discovered: ${peer.id.slice(0, 8)}...`);
      gossip.addPeer(peer);
    });

    // Connect to relay (non-blocking, will retry on failure)
    hypertoken.connect().then(() => {
      console.log(`[Infrastructure] Connected to HyperToken relay`);
    }).catch((error) => {
      console.warn(`[Infrastructure] Failed to connect to HyperToken relay: ${error.message}`);
      console.warn(`[Infrastructure] P2P gossip disabled - running in local-only mode`);
    });

    this.infrastructure = {
      freebird,
      witness,
      gossip,
      hypertoken
    };

    return this.infrastructure;
  }

  /**
   * Get initialized infrastructure
   */
  getInfrastructure(): Infrastructure | undefined {
    return this.infrastructure;
  }

  /**
   * Get infrastructure (alias for getInfrastructure)
   */
  get(): Infrastructure {
    if (!this.infrastructure) {
      throw new Error('Infrastructure not initialized. Call initialize() first.');
    }
    return this.infrastructure;
  }
}
