/**
 * Infrastructure initialization for Clout CLI
 *
 * Initializes Witness, Freebird, and ContentGossip for Clout
 */

import {
  FreebirdAdapter,
  WitnessAdapter,
  ContentGossip
} from '../index.js';
import { ConfigManager } from './config.js';

export interface Infrastructure {
  freebird: FreebirdAdapter;
  witness: WitnessAdapter;
  gossip: ContentGossip;
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

    this.infrastructure = {
      freebird,
      witness,
      gossip
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
