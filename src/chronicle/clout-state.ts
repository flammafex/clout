/**
 * CloutState - CRDT-based state synchronization
 * Powered by HyperToken Core-RS (Rust/WASM)
 */

import * as A from "@automerge/automerge";
import { Chronicle } from '../vendor/hypertoken/Chronicle.js'; // This is actually ChronicleWasm
import { Emitter } from './events.js';
import type { CloutState, PostPackage, TrustSignal, ReactionPackage, CloutProfile } from '../clout-types.js';

// Default empty state
const INITIAL_STATE: CloutState = {
  myPosts: [],
  myTrustSignals: [],
  myReactions: [],
  profile: {
    publicKey: '',
    trustGraph: new Set(),
    trustSettings: {
        autoFollowBack: false,
        autoMutualOnInvite: true,
        requireApproval: false,
        maxHops: 3,
        minReputation: 0.3
    }
  },
  lastSync: 0
};

export class CloutStateManager extends Emitter {
  public chronicle: Chronicle;

  constructor(initialState?: Partial<CloutState>) {
    super();
    const startState = { ...INITIAL_STATE, ...initialState };
    
    // Automerge/WASM JSON serialization requires Arrays, not Sets
    if (startState.profile?.trustGraph instanceof Set) {
        (startState.profile as any).trustGraph = Array.from(startState.profile.trustGraph);
    }

    // Initialize the WASM-backed Chronicle
    // We sanitize startState to ensure no undefined values exist
    this.chronicle = new Chronicle(JSON.parse(JSON.stringify(startState)));

    // Forward events from Chronicle to Clout listeners
    this.chronicle.on("state:changed", (payload: any) => {
      this.emit("state:changed", payload);
    });
  }

  getState(): Readonly<CloutState> {
    // Chronicle.state getter automatically syncs from WASM to JS object
    const doc = this.chronicle.state;
    
    // Hydrate Sets for the application layer
    const state = { ...doc } as any;
    if (state.profile?.trustGraph) {
        state.profile.trustGraph = new Set(state.profile.trustGraph);
    }
    return state;
  }

  addPost(post: PostPackage): void {
    // Uses Rust backend for the merge calculation if available
    this.chronicle.change("add post", (doc: any) => {
      const exists = doc.myPosts.some((p: any) => p.id === post.id);
      if (!exists) {
        // FIX: Sanitize post to remove 'undefined' fields (e.g. replyTo)
        // Automerge throws RangeError if it encounters undefined
        const cleanPost = JSON.parse(JSON.stringify(post));
        doc.myPosts.push(cleanPost);
      }
    });
  }

  addTrustSignal(signal: TrustSignal): void {
    this.chronicle.change("add trust signal", (doc: any) => {
      const idx = doc.myTrustSignals.findIndex(
        (s: any) => s.truster === signal.truster && s.trustee === signal.trustee
      );
      if (idx !== -1) doc.myTrustSignals.splice(idx, 1);

      // FIX: Sanitize signal
      const cleanSignal = JSON.parse(JSON.stringify(signal));
      doc.myTrustSignals.push(cleanSignal);
    });
  }

  addReaction(reaction: ReactionPackage): void {
    this.chronicle.change("add reaction", (doc: any) => {
      // Ensure myReactions exists
      if (!doc.myReactions) doc.myReactions = [];

      // Check for existing reaction to same post with same emoji
      const idx = doc.myReactions.findIndex(
        (r: any) => r.postId === reaction.postId && r.emoji === reaction.emoji
      );
      if (idx !== -1) doc.myReactions.splice(idx, 1);

      // Only add if not removed
      if (!reaction.removed) {
        const cleanReaction = JSON.parse(JSON.stringify(reaction));
        doc.myReactions.push(cleanReaction);
      }
    });
  }

  updateProfile(profile: CloutProfile): void {
    this.chronicle.change("update profile", (doc: any) => {
      // FIX: Sanitize profile and convert Set to Array
      const cleanProfile = JSON.parse(JSON.stringify({
          ...profile,
          trustGraph: Array.from(profile.trustGraph)
      }));
      doc.profile = cleanProfile;
    });
  }

  /**
   * Sync with a peer using WASM binary format
   */
  merge(remoteBinary: Uint8Array): void {
    // 1. Load binary into an Automerge Doc
    // This is necessary because Chronicle.merge() expects a Doc object
    const remoteDoc = A.load<CloutState>(remoteBinary);
    
    // 2. Pass Doc to Chronicle (which handles the WASM merge internally)
    this.chronicle.merge(remoteDoc); 
  }

  exportSync(): Uint8Array {
    // Returns WASM-optimized binary format
    return this.chronicle.save();
  }
}