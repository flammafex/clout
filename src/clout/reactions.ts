/**
 * Reactions Module - Trust-weighted post reactions
 *
 * Handles:
 * - Adding/removing reactions to posts
 * - Trust-weighted reaction aggregation
 * - Reaction persistence across restarts
 */

import { Crypto } from '../crypto.js';
import type { CloutStateManager } from '../chronicle/clout-state.js';
import type { ReputationValidator } from '../reputation.js';
import type { WitnessClient } from '../types.js';
import type { ContentGossip } from '../post.js';
import type { CloutStore, ReactionPackage } from '../clout-types.js';

export interface ReactionsConfig {
  publicKey: string;
  privateKey: Uint8Array;
  witness: WitnessClient;
  gossip?: ContentGossip;
  store?: CloutStore;
  state: CloutStateManager;
  reputationValidator: ReputationValidator;
}

/**
 * Available reaction emojis (common quick-react options)
 * Note: Any valid emoji is allowed, this is just for UI suggestions
 */
export const REACTION_EMOJIS = ['👍', '❤️', '🔥', '😂', '😮', '🙏'];

/**
 * Validate that a string is a valid emoji reaction
 * Allows any emoji character (including multi-codepoint emojis)
 */
function isValidEmoji(str: string): boolean {
  // Must be a short string (emojis are typically 1-8 chars due to combining characters)
  if (!str || str.length > 8) return false;

  // Check for emoji patterns - this regex matches most emoji
  // Including: basic emojis, skin tones, ZWJ sequences, flags, etc.
  const emojiRegex = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}][\u{FE0F}\u{200D}\p{Emoji_Modifier}\p{Emoji_Component}]*$/u;
  return emojiRegex.test(str);
}

export class CloutReactions {
  private readonly publicKeyHex: string;
  private readonly privateKey: Uint8Array;
  private readonly witness: WitnessClient;
  private readonly gossip?: ContentGossip;
  private readonly store?: CloutStore;
  private readonly state: CloutStateManager;
  private readonly reputationValidator: ReputationValidator;

  constructor(config: ReactionsConfig) {
    this.publicKeyHex = config.publicKey;
    this.privateKey = config.privateKey;
    this.witness = config.witness;
    this.gossip = config.gossip;
    this.store = config.store;
    this.state = config.state;
    this.reputationValidator = config.reputationValidator;
  }

  /**
   * React to a post
   *
   * @param postId - The post to react to
   * @param emoji - The reaction emoji (default: 👍)
   */
  async react(postId: string, emoji: string = '👍'): Promise<ReactionPackage> {
    // Validate emoji - allow any valid emoji character
    if (!isValidEmoji(emoji)) {
      throw new Error('Invalid reaction. Please use a valid emoji.');
    }

    // Remove any existing reaction on this post first (one reaction per post)
    const existingReaction = this.getMyReaction(postId);
    if (existingReaction && existingReaction !== emoji) {
      await this.unreact(postId, existingReaction);
    }

    // Create reaction ID
    const reactionId = Crypto.hashString(`${postId}:${this.publicKeyHex}:${emoji}`);

    // Sign the reaction
    const reactionPayload = {
      postId,
      reactor: this.publicKeyHex,
      emoji,
      timestamp: Date.now()
    };
    const payloadHash = Crypto.hashObject(reactionPayload);
    const signature = Crypto.hash(payloadHash, this.privateKey);
    const proof = await this.witness.timestamp(payloadHash);

    const reaction: ReactionPackage = {
      id: reactionId,
      postId,
      reactor: this.publicKeyHex,
      emoji,
      signature,
      proof
    };

    // Store in Chronicle state
    this.state.addReaction(reaction);

    // Persist to file store for cross-restart persistence
    if (this.store && 'addReaction' in this.store) {
      await (this.store as any).addReaction(reaction);
    }

    // Broadcast via gossip
    if (this.gossip) {
      await this.gossip.publish({
        type: 'reaction',
        reaction,
        timestamp: Date.now()
      });
    }

    console.log(`[Clout] ${emoji} Reacted to ${postId.slice(0, 8)}`);
    return reaction;
  }

  /**
   * Remove a reaction from a post
   */
  async unreact(postId: string, emoji: string = '👍'): Promise<void> {
    const reactionId = Crypto.hashString(`${postId}:${this.publicKeyHex}:${emoji}`);

    // Create removal signal
    const payloadHash = Crypto.hashObject({ id: reactionId, removed: true });
    const signature = Crypto.hash(payloadHash, this.privateKey);
    const proof = await this.witness.timestamp(payloadHash);

    const removal: ReactionPackage = {
      id: reactionId,
      postId,
      reactor: this.publicKeyHex,
      emoji,
      signature,
      proof,
      removed: true
    };

    // Update state (addReaction handles removal)
    this.state.addReaction(removal);

    // Remove from file store for cross-restart persistence
    if (this.store && 'removeReaction' in this.store) {
      await (this.store as any).removeReaction(reactionId);
    }

    // Broadcast removal
    if (this.gossip) {
      await this.gossip.publish({
        type: 'reaction',
        reaction: removal,
        timestamp: Date.now()
      });
    }

    console.log(`[Clout] Removed ${emoji} from ${postId.slice(0, 8)}`);
  }

  /**
   * Get reactions for a post (trust-weighted)
   *
   * Returns aggregated reactions with counts, weighted by trust distance.
   * Reactions from closer users (lower distance) count more.
   */
  getReactionsForPost(postId: string): {
    reactions: Map<string, { count: number; weightedCount: number; reactors: string[] }>;
    myReaction?: string;
  } {
    // Read from file store (persistent) rather than CRDT state
    let allReactions: ReactionPackage[] = [];
    if (this.store && 'getReactionsSync' in this.store) {
      allReactions = (this.store as any).getReactionsSync() || [];
    } else {
      // Fallback to CRDT state
      const state = this.state.getState();
      allReactions = state.myReactions || [];
    }

    // Filter reactions for this post
    const postReactions = allReactions.filter(r => r.postId === postId && !r.removed);

    // Aggregate by emoji
    const reactions = new Map<string, { count: number; weightedCount: number; reactors: string[] }>();
    let myReaction: string | undefined;

    for (const r of postReactions) {
      // Check if it's my reaction
      if (r.reactor === this.publicKeyHex) {
        myReaction = r.emoji;
      }

      // Calculate trust weight (closer = higher weight)
      const rep = this.reputationValidator.computeReputation(r.reactor);
      const weight = rep.visible ? Math.max(0.1, 1 - (rep.distance * 0.2)) : 0.1;

      const existing = reactions.get(r.emoji) || { count: 0, weightedCount: 0, reactors: [] };
      existing.count++;
      existing.weightedCount += weight;
      existing.reactors.push(r.reactor);
      reactions.set(r.emoji, existing);
    }

    return { reactions, myReaction };
  }

  /**
   * Get my reaction to a specific post
   */
  getMyReaction(postId: string): string | undefined {
    // Read from file store for consistency with getReactionsForPost
    let allReactions: ReactionPackage[] = [];
    if (this.store && 'getReactionsSync' in this.store) {
      allReactions = (this.store as any).getReactionsSync() || [];
    } else {
      const state = this.state.getState();
      allReactions = state.myReactions || [];
    }
    const myReactions = allReactions.filter(
      r => r.reactor === this.publicKeyHex && r.postId === postId && !r.removed
    );
    return myReactions[0]?.emoji;
  }

  /**
   * Load saved reactions from file store
   */
  async loadSavedReactions(): Promise<void> {
    if (!this.store || !('getReactions' in this.store)) {
      return;
    }

    const savedReactions = await (this.store as any).getReactions();
    if (savedReactions && savedReactions.length > 0) {
      console.log(`[Clout] 📂 Restoring ${savedReactions.length} saved reactions from local storage`);

      for (const reaction of savedReactions) {
        this.state.addReaction(reaction);
      }
    }
  }
}
