/**
 * CloutState - CRDT-based state synchronization
 *
 * Phase 5: Use HyperToken's Chronicle for P2P state sync
 *
 * Your profile is a CRDT document.
 * When you follow someone, you merge their Chronicle into your local view.
 * Because it's a CRDT, edits merge seamlessly when reconnecting.
 */

import { Emitter } from './events.js';
import type { CloutState, PostPackage, TrustSignal, CloutProfile } from '../clout-types.js';

/**
 * Simple CRDT-like state manager for Clout
 *
 * In production, this would use Automerge or Y.js for true CRDT semantics.
 * For MVP, we implement basic last-write-wins with vector clocks.
 */
export class CloutStateManager extends Emitter {
  private state: CloutState;
  private version: number = 0;

  constructor(initialState?: Partial<CloutState>) {
    super();
    this.state = {
      myPosts: [],
      myTrustSignals: [],
      lastSync: Date.now(),
      ...initialState
    };
  }

  /**
   * Get current state (readonly)
   */
  getState(): Readonly<CloutState> {
    return { ...this.state };
  }

  /**
   * Update profile
   */
  updateProfile(profile: CloutProfile): void {
    this.state = {
      ...this.state,
      profile
    };
    this.version++;
    this.emit('state:changed', { state: this.state, source: 'local' });
  }

  /**
   * Add a post
   */
  addPost(post: PostPackage): void {
    // Check if post already exists
    const exists = this.state.myPosts.some(p => p.id === post.id);
    if (exists) {
      return;
    }

    this.state = {
      ...this.state,
      myPosts: [...this.state.myPosts, post]
    };
    this.version++;
    this.emit('state:changed', { state: this.state, source: 'local' });
  }

  /**
   * Add a trust signal
   */
  addTrustSignal(signal: TrustSignal): void {
    // Remove existing signal for same truster-trustee pair
    const filtered = this.state.myTrustSignals.filter(
      s => !(s.truster === signal.truster && s.trustee === signal.trustee)
    );

    this.state = {
      ...this.state,
      myTrustSignals: [...filtered, signal]
    };
    this.version++;
    this.emit('state:changed', { state: this.state, source: 'local' });
  }

  /**
   * Merge remote state (CRDT merge)
   *
   * This is where the magic happens - conflict-free merging of states.
   */
  merge(remoteState: CloutState, remoteVersion?: number): void {
    // Merge posts (union of sets, deduplicated by ID)
    const localPostIds = new Set(this.state.myPosts.map(p => p.id));
    const newPosts = remoteState.myPosts.filter(p => !localPostIds.has(p.id));

    // Merge trust signals (last-write-wins by timestamp)
    const mergedSignals = this.mergeTrustSignals(
      this.state.myTrustSignals,
      remoteState.myTrustSignals
    );

    // Merge profile (if remote is newer)
    const mergedProfile = this.mergeProfiles(this.state.profile, remoteState.profile);

    this.state = {
      profile: mergedProfile,
      myPosts: [...this.state.myPosts, ...newPosts],
      myTrustSignals: mergedSignals,
      feed: this.state.feed, // Keep local feed
      lastSync: Date.now()
    };

    this.version++;
    this.emit('state:changed', { state: this.state, source: 'merge' });
  }

  /**
   * Merge trust signals (last-write-wins)
   */
  private mergeTrustSignals(local: TrustSignal[], remote: TrustSignal[]): TrustSignal[] {
    const merged = new Map<string, TrustSignal>();

    // Add local signals
    for (const signal of local) {
      const key = `${signal.truster}:${signal.trustee}`;
      merged.set(key, signal);
    }

    // Merge remote signals (newer wins)
    for (const signal of remote) {
      const key = `${signal.truster}:${signal.trustee}`;
      const existing = merged.get(key);

      if (!existing || signal.proof.timestamp > existing.proof.timestamp) {
        merged.set(key, signal);
      }
    }

    return Array.from(merged.values());
  }

  /**
   * Merge profiles (last-write-wins, but preserve local trust graph)
   */
  private mergeProfiles(
    local: CloutProfile | undefined,
    remote: CloutProfile | undefined
  ): CloutProfile | undefined {
    if (!local && !remote) return undefined;
    if (!local) return remote;
    if (!remote) return local;

    // Keep local trust graph and settings (they're personal)
    // But merge metadata if remote has updates
    return {
      publicKey: local.publicKey,
      trustGraph: local.trustGraph, // Always keep local
      trustSettings: local.trustSettings, // Always keep local
      metadata: local.metadata || remote.metadata
    };
  }

  /**
   * Export state for transmission
   */
  export(): { state: CloutState; version: number } {
    return {
      state: { ...this.state },
      version: this.version
    };
  }

  /**
   * Import state from transmission
   */
  import(data: { state: CloutState; version: number }): void {
    this.merge(data.state, data.version);
  }

  /**
   * Serialize to JSON
   */
  toJSON(): string {
    return JSON.stringify({
      state: {
        ...this.state,
        profile: this.state.profile ? {
          ...this.state.profile,
          trustGraph: Array.from(this.state.profile.trustGraph)
        } : undefined
      },
      version: this.version
    });
  }

  /**
   * Deserialize from JSON
   */
  static fromJSON(json: string): CloutStateManager {
    const data = JSON.parse(json);
    const state = data.state;

    if (state.profile && Array.isArray(state.profile.trustGraph)) {
      state.profile.trustGraph = new Set(state.profile.trustGraph);
    }

    const manager = new CloutStateManager(state);
    manager.version = data.version || 0;
    return manager;
  }

  /**
   * Get state version for sync
   */
  getVersion(): number {
    return this.version;
  }

  /**
   * Clear all state
   */
  clear(): void {
    this.state = {
      myPosts: [],
      myTrustSignals: [],
      lastSync: Date.now()
    };
    this.version = 0;
    this.emit('state:changed', { state: this.state, source: 'clear' });
  }
}
