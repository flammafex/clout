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
        autoMutualOnInvite: true,
        maxPendingOutgoing: 20,
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

    // Hydrate the state for the application layer
    // Automerge returns proxy objects that look like arrays but aren't real JS arrays
    const state = { ...doc } as any;

    // Ensure all array fields are real JS arrays (Automerge proxies don't have .filter, .map, etc.)
    if (state.myPosts && !Array.isArray(state.myPosts)) {
      state.myPosts = Array.from(state.myPosts);
    }
    if (state.myTrustSignals && !Array.isArray(state.myTrustSignals)) {
      state.myTrustSignals = Array.from(state.myTrustSignals);
    }
    if (state.myReactions && !Array.isArray(state.myReactions)) {
      state.myReactions = Array.from(state.myReactions);
    }
    if (state.myPostDeletions && !Array.isArray(state.myPostDeletions)) {
      state.myPostDeletions = Array.from(state.myPostDeletions);
    }

    // Hydrate trustGraph to a Set
    if (state.profile?.trustGraph) {
      const trustArray = Array.isArray(state.profile.trustGraph)
        ? state.profile.trustGraph
        : Array.from(state.profile.trustGraph);
      state.profile.trustGraph = new Set(trustArray);
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

  /**
   * Add a post retraction to CRDT state
   * (Function name kept as addPostDeletion for CRDT field compatibility)
   */
  addPostDeletion(retraction: PostDeletePackage): void {
    this.chronicle.change("add post retraction", (doc: any) => {
      // Ensure myPostDeletions exists (field name kept for CRDT compatibility)
      if (!doc.myPostDeletions) doc.myPostDeletions = [];

      // Check if retraction already exists for this post
      const exists = doc.myPostDeletions.some(
        (d: any) => d.postId === retraction.postId
      );

      if (!exists) {
        const cleanRetraction = sanitizeForAutomerge(retraction);
        doc.myPostDeletions.push(cleanRetraction);
      }
    });
  }

  /**
   * Check if a post has been retracted
   * (Function name kept for backward compatibility)
   */
  isPostDeleted(postId: string): boolean {
    const state = this.getState();
    return (state.myPostDeletions || []).some((d: any) => d.postId === postId);
  }

  /**
   * Get all post retractions
   * (Function name kept for backward compatibility)
   */
  getPostDeletions(): PostDeletePackage[] {
    const state = this.getState();
    const deletions = state.myPostDeletions;
    // Ensure we always return an actual array (Automerge may return array-like objects)
    if (!deletions) return [];
    if (Array.isArray(deletions)) return deletions;
    // Handle Automerge's array-like objects
    return Array.from(deletions as any);
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

    // 3. Enforce monotonic decay - if any post was decayed on either side,
    // ensure it stays decayed (prevents resurrection from conservative peers)
    this.enforceMonotonicDecay(remoteDoc);
  }

  /**
   * Enforce monotonic decay after CRDT merge
   *
   * If a post was decayed on EITHER side before merge, it must stay decayed.
   * This prevents "resurrection" attacks where a peer with more conservative
   * decay settings could restore content that was intentionally decayed.
   *
   * The rule: decay can only happen, never un-happen.
   */
  private enforceMonotonicDecay(remoteDoc: A.Doc<CloutState>): void {
    const localState = this.getState();
    const remotePosts = (remoteDoc as any).myPosts || [];

    // Build set of decayed post IDs from both sides
    const decayedIds = new Map<string, number>(); // postId -> earliest decayedAt

    // Collect decay timestamps from local state
    for (const post of localState.myPosts || []) {
      if (post.decayedAt) {
        decayedIds.set(post.id, post.decayedAt);
      }
    }

    // Collect decay timestamps from remote state (take earliest)
    for (const post of remotePosts) {
      if (post.decayedAt) {
        const existing = decayedIds.get(post.id);
        if (!existing || post.decayedAt < existing) {
          decayedIds.set(post.id, post.decayedAt);
        }
      }
    }

    // Re-apply decay to any posts that were decayed on either side
    // but may have been "resurrected" by the merge
    const currentState = this.getState();
    for (const post of currentState.myPosts || []) {
      const shouldBeDecayedAt = decayedIds.get(post.id);
      if (shouldBeDecayedAt && !post.decayedAt) {
        // Post was decayed on one side but merge restored it - re-decay
        this.chronicle.change("enforce monotonic decay", (doc: any) => {
          const idx = doc.myPosts.findIndex((p: any) => p.id === post.id);
          if (idx !== -1) {
            doc.myPosts[idx].content = null;
            doc.myPosts[idx].media = null;
            doc.myPosts[idx].decayedAt = shouldBeDecayedAt;
          }
        });
      }
    }
  }

  exportSync(): Uint8Array {
    // Returns WASM-optimized binary format
    return this.chronicle.save();
  }

  /**
   * Decay a post's content while preserving the envelope
   * The post ID, author, signature, and proof remain to prevent resurrection
   * but the actual content is nulled out.
   */
  decayPost(postId: string): boolean {
    let decayed = false;
    this.chronicle.change("decay post content", (doc: any) => {
      const idx = doc.myPosts.findIndex((p: any) => p.id === postId);
      if (idx !== -1 && !doc.myPosts[idx].decayedAt) {
        // Null out the content but keep the envelope
        doc.myPosts[idx].content = null;
        doc.myPosts[idx].media = null;
        doc.myPosts[idx].decayedAt = Date.now();
        decayed = true;
      }
    });
    return decayed;
  }

  /**
   * Process content decay for all posts based on settings
   * Call this periodically (e.g., on feed load) to decay old content
   *
   * @param settings - Decay settings from TrustSettings.contentDecay
   * @returns Number of posts that were decayed
   */
  processContentDecay(settings: { enabled: boolean; decayAfterDays: number; retractedDecayDays: number }): number {
    if (!settings.enabled) return 0;

    const state = this.getState();
    const now = Date.now();
    const normalDecayMs = settings.decayAfterDays * 24 * 60 * 60 * 1000;
    const retractedDecayMs = settings.retractedDecayDays * 24 * 60 * 60 * 1000;

    let decayedCount = 0;

    for (const post of state.myPosts || []) {
      // Skip already decayed posts
      if (post.decayedAt) continue;

      // Get post timestamp from proof
      const postTimestamp = post.proof?.timestamp || 0;
      if (!postTimestamp) continue;

      // Check if this post was retracted (shorter decay window for propagation)
      const isRetracted = this.isPostDeleted(post.id);
      const decayThreshold = isRetracted ? retractedDecayMs : normalDecayMs;

      // Check if post is old enough to decay
      if (now - postTimestamp > decayThreshold) {
        if (this.decayPost(post.id)) {
          decayedCount++;
        }
      }
    }

    return decayedCount;
  }
}