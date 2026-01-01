/**
 * CloutStateSync - CRDT State Synchronization
 *
 * Handles synchronizing Chronicle CRDT state with peers.
 * Manages periodic broadcasts and state merging.
 */

import type { CloutStateManager } from '../chronicle/clout-state.js';

export interface StateSyncConfig {
  publicKey: string;
  stateManager: CloutStateManager;
  gossip?: {
    setStateSyncHandler(handler: (publicKey: string, stateBinary: Uint8Array) => Promise<void>): void;
    setStateRequestHandler(handler: (publicKey: string) => Promise<Uint8Array | null>): void;
    broadcastState(publicKey: string, stateBinary: Uint8Array): Promise<void>;
    requestState(publicKey: string, currentVersion?: number): Promise<void>;
  };
  syncInterval?: number; // milliseconds, default 30000
}

export class CloutStateSync {
  private readonly publicKeyHex: string;
  private readonly stateManager: CloutStateManager;
  private readonly gossip?: StateSyncConfig['gossip'];
  private readonly syncInterval: number;
  private syncTimer?: NodeJS.Timeout;

  constructor(config: StateSyncConfig) {
    this.publicKeyHex = config.publicKey;
    this.stateManager = config.stateManager;
    this.gossip = config.gossip;
    this.syncInterval = config.syncInterval ?? 30000;
  }

  /**
   * Initialize state sync - set up handlers and start timer
   */
  initialize(): void {
    if (!this.gossip) {
      console.log('[StateSync] No gossip configured, skipping sync setup');
      return;
    }

    // Set up CRDT state synchronization handlers
    this.gossip.setStateSyncHandler(async (publicKey: string, stateBinary: Uint8Array) => {
      await this.handleIncomingState(publicKey, stateBinary);
    });

    this.gossip.setStateRequestHandler(async (publicKey: string) => {
      return this.handleStateRequest(publicKey);
    });

    // Start periodic state sync
    this.startSyncTimer();

    // Request initial state from peers after connections establish
    setTimeout(() => {
      this.requestPeerStates();
    }, 2000);

    console.log(`[StateSync] 🔄 Initialized (interval: ${this.syncInterval / 1000}s)`);
  }

  /**
   * Handle incoming CRDT state from peer
   */
  private async handleIncomingState(publicKey: string, stateBinary: Uint8Array): Promise<void> {
    try {
      console.log(`[StateSync] 📦 Merging state from ${publicKey.slice(0, 8)}`);

      // Merge the remote state into our Chronicle
      this.stateManager.merge(stateBinary);

      const mergedState = this.stateManager.getState();
      console.log(
        `[StateSync] ✅ State merged. Posts: ${mergedState.myPosts.length}, ` +
        `Trust signals: ${mergedState.myTrustSignals.length}`
      );
    } catch (error: any) {
      console.error(`[StateSync] ❌ Failed to merge state:`, error.message);
    }
  }

  /**
   * Handle state request from peer
   */
  private async handleStateRequest(publicKey: string): Promise<Uint8Array | null> {
    try {
      console.log(`[StateSync] 📤 Sending state to ${publicKey.slice(0, 8)}`);
      return this.stateManager.exportSync();
    } catch (error: any) {
      console.error(`[StateSync] ❌ Failed to export state:`, error.message);
      return null;
    }
  }

  /**
   * Start periodic state synchronization timer
   */
  private startSyncTimer(): void {
    // Clear any existing timer
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }

    // Broadcast state periodically
    this.syncTimer = setInterval(() => {
      this.broadcastState();
    }, this.syncInterval);

    console.log(`[StateSync] 🔄 Timer started (every ${this.syncInterval / 1000}s)`);
  }

  /**
   * Broadcast our current state to all peers
   */
  async broadcastState(): Promise<void> {
    if (!this.gossip) return;

    try {
      const stateBinary = this.stateManager.exportSync();
      await this.gossip.broadcastState(this.publicKeyHex, stateBinary);
    } catch (error: any) {
      console.error(`[StateSync] ❌ Failed to broadcast state:`, error.message);
    }
  }

  /**
   * Request state from all peers
   */
  async requestPeerStates(): Promise<void> {
    if (!this.gossip) return;

    try {
      console.log(`[StateSync] 📥 Requesting state from peers`);
      await this.gossip.requestState(this.publicKeyHex);
    } catch (error: any) {
      console.error(`[StateSync] ❌ Failed to request state:`, error.message);
    }
  }

  /**
   * Force immediate sync (broadcast + request)
   */
  async forceSync(): Promise<void> {
    await this.broadcastState();
    await this.requestPeerStates();
  }

  /**
   * Stop synchronization and clean up
   */
  destroy(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
      console.log('[StateSync] 🛑 Stopped');
    }
  }

  /**
   * Check if sync is active
   */
  isActive(): boolean {
    return !!this.syncTimer;
  }

  /**
   * Get sync configuration
   */
  getConfig(): { syncInterval: number; isActive: boolean } {
    return {
      syncInterval: this.syncInterval,
      isActive: this.isActive()
    };
  }
}
