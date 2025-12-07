/**
 * CloutState - CRDT-based state synchronization
 * Powered by HyperToken Core-RS (Rust/WASM)
 */

import * as A from "@automerge/automerge";
import { Chronicle } from '../vendor/hypertoken/Chronicle.js'; // This is actually ChronicleWasm
import { Emitter } from './events.js';
import type { CloutState, PostPackage, TrustSignal, ReactionPackage, CloutProfile, PostDeletePackage } from '../clout-types.js';

/**
 * Sanitize an object for Automerge storage
 *
 * This function removes `undefined` values (which Automerge doesn't support)
 * while preserving Uint8Array fields (which Automerge handles natively as bytes).
 *
 * The old approach `JSON.parse(JSON.stringify(obj))` corrupted Uint8Array fields
 * by converting them to empty objects `{}` or numeric-keyed objects.
 */
function sanitizeForAutomerge<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Preserve Uint8Array as a defensive copy (Automerge supports bytes natively)
  // We copy to prevent mutation of the original array after insertion
  if (obj instanceof Uint8Array) {
    return new Uint8Array(obj) as T;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj
      .filter(item => item !== undefined)
      .map(item => sanitizeForAutomerge(item)) as T;
  }

  // Handle plain objects
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Skip undefined values (Automerge throws RangeError on undefined)
      if (value !== undefined) {
        result[key] = sanitizeForAutomerge(value);
      }
    }
    return result as T;
  }

  // Primitives pass through unchanged
  return obj;
}

// Default empty state
const INITIAL_STATE: CloutState = {
  myPosts: [],
  myTrustSignals: [],
  myReactions: [],
  myPostDeletions: [],
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
    // We sanitize startState to ensure no undefined values exist while preserving Uint8Array fields
    this.chronicle = new Chronicle(sanitizeForAutomerge(startState));

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
        // Sanitize post to remove 'undefined' fields while preserving Uint8Array (signature, etc.)
        const cleanPost = sanitizeForAutomerge(post);
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

      // Sanitize signal while preserving Uint8Array (signature)
      const cleanSignal = sanitizeForAutomerge(signal);
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
        const cleanReaction = sanitizeForAutomerge(reaction);
        doc.myReactions.push(cleanReaction);
      }
    });
  }

  addPostDeletion(deletion: PostDeletePackage): void {
    this.chronicle.change("add post deletion", (doc: any) => {
      // Ensure myPostDeletions exists
      if (!doc.myPostDeletions) doc.myPostDeletions = [];

      // Check if deletion already exists for this post
      const exists = doc.myPostDeletions.some(
        (d: any) => d.postId === deletion.postId
      );

      if (!exists) {
        const cleanDeletion = sanitizeForAutomerge(deletion);
        doc.myPostDeletions.push(cleanDeletion);
      }
    });
  }

  /**
   * Check if a post has been deleted
   */
  isPostDeleted(postId: string): boolean {
    const state = this.getState();
    return (state.myPostDeletions || []).some((d: any) => d.postId === postId);
  }

  /**
   * Get all post deletions
   */
  getPostDeletions(): PostDeletePackage[] {
    const state = this.getState();
    return state.myPostDeletions || [];
  }

  updateProfile(profile: CloutProfile): void {
    this.chronicle.change("update profile", (doc: any) => {
      // Sanitize profile and convert Set to Array
      const cleanProfile = sanitizeForAutomerge({
          ...profile,
          trustGraph: Array.from(profile.trustGraph)
      });
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