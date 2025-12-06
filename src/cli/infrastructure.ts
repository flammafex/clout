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

export class InfrastructureManager {
  private config: ConfigManager;
  private infrastructure?: Infrastructure;

  constructor(config?: ConfigManager) {
    this.config = config || new ConfigManager();
  }

  /**
   * Initialize infrastructure
   */
  async initialize(): Promise<Infrastructure> {
    if (this.infrastructure) {
      return this.infrastructure;
    }

    // Initialize Freebird
    const freebird = new FreebirdAdapter(this.config.getFreebirdConfig());

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
