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
      if (!doc.myTrustSignals) doc.myTrustSignals = [];
      const idx = doc.myTrustSignals.findIndex(
        (s: any) => s.truster === signal.truster && s.trustee === signal.trustee
      );
      const cleanSignal = sanitizeForAutomerge(signal);
      if (idx === -1) {
        doc.myTrustSignals.push(cleanSignal);
        return;
      }

      const existing = doc.myTrustSignals[idx];
      const existingTs = existing?.proof?.timestamp ?? 0;
      const incomingTs = signal.proof?.timestamp ?? 0;

      // Last-write-wins by attestation timestamp for same logical trust edge.
      if (incomingTs >= existingTs) {
        doc.myTrustSignals[idx] = cleanSignal;
      }
    });
  }

  addReaction(reaction: ReactionPackage): void {
    this.chronicle.change("add reaction", (doc: any) => {
      // Ensure myReactions exists
      if (!doc.myReactions) doc.myReactions = [];

      // Check for existing reaction with same logical key (reactor+post+emoji).
      const idx = doc.myReactions.findIndex(
        (r: any) => r.id === reaction.id || (
          r.reactor === reaction.reactor &&
          r.postId === reaction.postId &&
          r.emoji === reaction.emoji
        )
      );

      const cleanReaction = sanitizeForAutomerge(reaction);
      if (idx === -1) {
        doc.myReactions.push(cleanReaction);
        return;
      }

      const existing = doc.myReactions[idx];
      const existingTs = existing?.proof?.timestamp ?? 0;
      const incomingTs = reaction.proof?.timestamp ?? 0;

      // Last-write-wins by attestation timestamp.
      // On equal timestamps, prefer removed=true to avoid accidental resurrection.
      if (
        incomingTs > existingTs ||
        (incomingTs === existingTs && reaction.removed === true && existing?.removed !== true)
      ) {
        doc.myReactions[idx] = cleanReaction;
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
      const idx = doc.myPostDeletions.findIndex(
        (d: any) => d.postId === retraction.postId
      );
      const cleanRetraction = sanitizeForAutomerge(retraction);

      if (idx === -1) {
        doc.myPostDeletions.push(cleanRetraction);
        return;
      }

      const existing = doc.myPostDeletions[idx];
      const existingTs = existing?.deletedAt ?? existing?.proof?.timestamp ?? 0;
      const incomingTs = retraction.deletedAt ?? retraction.proof?.timestamp ?? 0;

      // Keep the newest retraction update for this post.
      if (incomingTs >= existingTs) {
        doc.myPostDeletions[idx] = cleanRetraction;
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
      // Sanitize profile and convert Set to Array.
      // Apply as field-level updates to preserve concurrent edits on sibling keys.
      const cleanProfile = sanitizeForAutomerge({
        ...profile,
        trustGraph: Array.from(profile.trustGraph)
      }) as any;

      if (!doc.profile || typeof doc.profile !== 'object') {
        doc.profile = {};
      }

      if (typeof cleanProfile.publicKey === 'string') {
        doc.profile.publicKey = cleanProfile.publicKey;
      }

      if (Array.isArray(cleanProfile.trustGraph)) {
        doc.profile.trustGraph = cleanProfile.trustGraph;
      }

      if (cleanProfile.metadata && typeof cleanProfile.metadata === 'object') {
        if (!doc.profile.metadata || typeof doc.profile.metadata !== 'object') {
          doc.profile.metadata = {};
        }
        for (const [key, value] of Object.entries(cleanProfile.metadata)) {
          if (value !== undefined) {
            doc.profile.metadata[key] = value;
          }
        }
      }

      if (cleanProfile.trustSettings && typeof cleanProfile.trustSettings === 'object') {
        if (!doc.profile.trustSettings || typeof doc.profile.trustSettings !== 'object') {
          doc.profile.trustSettings = {};
        }
        for (const [key, value] of Object.entries(cleanProfile.trustSettings)) {
          if (value !== undefined) {
            doc.profile.trustSettings[key] = value;
          }
        }
      }
    });
  }

  /**
   * Sync with a peer using WASM binary format
   */
  merge(remoteBinary: Uint8Array): void {
    const preMergeDecayedAt = this.captureDecayedAtMap(this.getState());

    // 1. Load binary into an Automerge Doc
    // This is necessary because Chronicle.merge() expects a Doc object
    const remoteDoc = A.load<CloutState>(remoteBinary);

    // 2. Pass Doc to Chronicle (which handles the WASM merge internally)
    this.chronicle.merge(remoteDoc);

    // 3. Enforce monotonic decay - if any post was decayed on either side,
    // ensure it stays decayed (prevents resurrection from conservative peers)
    this.enforceMonotonicDecay(preMergeDecayedAt, remoteDoc);

    // 4. Deterministically compact keyed collections to resolve duplicate
    // logical records that can arise from concurrent array edits.
    this.compactMergedKeyedCollections();
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
  private enforceMonotonicDecay(
    preMergeDecayedAt: Map<string, number>,
    remoteDoc: A.Doc<CloutState>
  ): void {
    const remotePosts = (remoteDoc as any).myPosts || [];

    // Build set of decayed post IDs from both sides
    const decayedIds = new Map<string, number>(); // postId -> earliest decayedAt

    // Collect decay timestamps from local PRE-MERGE state
    for (const [postId, decayedAt] of preMergeDecayedAt.entries()) {
      decayedIds.set(postId, decayedAt);
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

  private captureDecayedAtMap(state: Readonly<CloutState>): Map<string, number> {
    const decayed = new Map<string, number>();
    for (const post of state.myPosts || []) {
      if (typeof post.decayedAt === 'number') {
        decayed.set(post.id, post.decayedAt);
      }
    }
    return decayed;
  }

  private compactMergedKeyedCollections(): void {
    this.chronicle.change("compact merged keyed collections", (doc: any) => {
      // Trust signals: one logical edge per (truster, trustee), newest attestation wins.
      if (Array.isArray(doc.myTrustSignals)) {
        const byKey = new Map<string, any>();
        for (const signal of doc.myTrustSignals) {
          const key = `${signal.truster}:${signal.trustee}`;
          const existing = byKey.get(key);
          if (!existing || this.compareTrustSignals(signal, existing) > 0) {
            byKey.set(key, signal);
          }
        }
        doc.myTrustSignals = Array.from(byKey.values());
      }

      // Reactions: one logical reaction per (reactor, postId, emoji), newest wins.
      if (Array.isArray(doc.myReactions)) {
        const byKey = new Map<string, any>();
        for (const reaction of doc.myReactions) {
          const key = reaction.id || `${reaction.reactor}:${reaction.postId}:${reaction.emoji}`;
          const existing = byKey.get(key);
          if (!existing || this.compareReactions(reaction, existing) > 0) {
            byKey.set(key, reaction);
          }
        }
        doc.myReactions = Array.from(byKey.values());
      }

      // Retractions: one logical entry per postId, newest deletedAt/proof timestamp wins.
      if (Array.isArray(doc.myPostDeletions)) {
        const byKey = new Map<string, any>();
        for (const deletion of doc.myPostDeletions) {
          const key = deletion.postId;
          const existing = byKey.get(key);
          if (!existing || this.comparePostDeletions(deletion, existing) > 0) {
            byKey.set(key, deletion);
          }
        }
        doc.myPostDeletions = Array.from(byKey.values());
      }
    });
  }

  private compareTrustSignals(a: any, b: any): number {
    const ats = a?.proof?.timestamp ?? 0;
    const bts = b?.proof?.timestamp ?? 0;
    if (ats !== bts) return ats - bts;
    return this.compareSignatureTieBreak(a?.signature, b?.signature);
  }

  private compareReactions(a: any, b: any): number {
    const ats = a?.proof?.timestamp ?? 0;
    const bts = b?.proof?.timestamp ?? 0;
    if (ats !== bts) return ats - bts;

    // On same timestamp, tombstone (removed=true) wins to prevent resurrection.
    const aRemoved = a?.removed === true;
    const bRemoved = b?.removed === true;
    if (aRemoved !== bRemoved) return aRemoved ? 1 : -1;

    return this.compareSignatureTieBreak(a?.signature, b?.signature);
  }

  private comparePostDeletions(a: any, b: any): number {
    const ats = a?.deletedAt ?? a?.proof?.timestamp ?? 0;
    const bts = b?.deletedAt ?? b?.proof?.timestamp ?? 0;
    if (ats !== bts) return ats - bts;
    return this.compareSignatureTieBreak(a?.signature, b?.signature);
  }

  private compareSignatureTieBreak(aSig: unknown, bSig: unknown): number {
    const aHex = aSig instanceof Uint8Array ? this.bytesToHex(aSig) : '';
    const bHex = bSig instanceof Uint8Array ? this.bytesToHex(bSig) : '';
    if (aHex === bHex) return 0;
    return aHex > bHex ? 1 : -1;
  }

  private bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
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
