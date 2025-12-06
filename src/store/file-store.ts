import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import type { CloutStore, PostPackage, SlidePackage, PostDeletePackage, ReactionPackage } from '../clout-types.js';

/**
 * Get Clout data directory from environment or default
 */
function getCloutDataDir(): string {
  return process.env.CLOUT_DATA_DIR || join(homedir(), '.clout');
}

/**
 * Persisted trust graph entry: who trusts whom
 */
interface TrustGraphEntry {
  truster: string;
  trustee: string;
  timestamp: number;
}

interface LocalData {
  version: string;
  posts: { [id: string]: PostPackage };
  slides: { [id: string]: SlidePackage };
  trustGraph?: TrustGraphEntry[];
  deletions?: { [postId: string]: PostDeletePackage };
  reactions?: { [reactionId: string]: ReactionPackage };
  bookmarks?: string[];  // Array of bookmarked post IDs
}

export class FileSystemStore implements CloutStore {
  private path: string;
  private data: LocalData;

  constructor(customPath?: string) {
    this.path = customPath || join(getCloutDataDir(), 'local-data.json');
    this.data = { version: '1.0', posts: {}, slides: {} };
  }

  async init(): Promise<void> {
    this.ensureDir();
    this.load();
  }

  private ensureDir(): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private load(): void {
    if (!existsSync(this.path)) {
      return;
    }
    try {
      const raw = readFileSync(this.path, 'utf-8');
      this.data = JSON.parse(raw);
    } catch (e) {
      console.warn('Failed to load local store, starting fresh');
    }
  }

  private save(): void {
    writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  async addPost(post: PostPackage): Promise<void> {
    if (!this.data.posts[post.id]) {
      this.data.posts[post.id] = post;
      this.save();
    }
  }

  async getFeed(): Promise<PostPackage[]> {
    return Object.values(this.data.posts)
      .sort((a, b) => b.proof.timestamp - a.proof.timestamp);
  }

  async addSlide(slide: SlidePackage): Promise<void> {
    if (!this.data.slides[slide.id]) {
      this.data.slides[slide.id] = slide;
      this.save();
    }
  }

  async getInbox(): Promise<SlidePackage[]> {
    return Object.values(this.data.slides)
      .sort((a, b) => b.proof.timestamp - a.proof.timestamp);
  }

  /**
   * Save a trust graph edge (who trusts whom)
   */
  async saveTrustEdge(truster: string, trustee: string): Promise<void> {
    if (!this.data.trustGraph) {
      this.data.trustGraph = [];
    }

    // Check if edge already exists
    const exists = this.data.trustGraph.some(
      e => e.truster === truster && e.trustee === trustee
    );

    if (!exists) {
      this.data.trustGraph.push({
        truster,
        trustee,
        timestamp: Date.now()
      });
      this.save();
    }
  }

  /**
   * Remove a trust graph edge
   */
  async removeTrustEdge(truster: string, trustee: string): Promise<void> {
    if (!this.data.trustGraph) return;

    this.data.trustGraph = this.data.trustGraph.filter(
      e => !(e.truster === truster && e.trustee === trustee)
    );
    this.save();
  }

  /**
   * Get all trust graph edges
   * Returns Map<truster, Set<trustee>>
   */
  async getTrustGraph(): Promise<Map<string, Set<string>>> {
    const graph = new Map<string, Set<string>>();

    if (this.data.trustGraph) {
      for (const edge of this.data.trustGraph) {
        if (!graph.has(edge.truster)) {
          graph.set(edge.truster, new Set());
        }
        graph.get(edge.truster)!.add(edge.trustee);
      }
    }

    return graph;
  }

  /**
   * Save a post deletion
   */
  async addDeletion(deletion: PostDeletePackage): Promise<void> {
    if (!this.data.deletions) {
      this.data.deletions = {};
    }

    if (!this.data.deletions[deletion.postId]) {
      this.data.deletions[deletion.postId] = deletion;
      this.save();
    }
  }

  /**
   * Get all deletions
   */
  async getDeletions(): Promise<PostDeletePackage[]> {
    if (!this.data.deletions) {
      return [];
    }
    return Object.values(this.data.deletions);
  }

  /**
   * Check if a post is deleted
   */
  isDeleted(postId: string): boolean {
    return !!(this.data.deletions && this.data.deletions[postId]);
  }

  // =================================================================
  //  REACTIONS PERSISTENCE
  // =================================================================

  /**
   * Save a reaction
   */
  async addReaction(reaction: ReactionPackage): Promise<void> {
    if (!this.data.reactions) {
      this.data.reactions = {};
    }

    this.data.reactions[reaction.id] = reaction;
    this.save();
  }

  /**
   * Remove a reaction
   */
  async removeReaction(reactionId: string): Promise<void> {
    if (!this.data.reactions) return;

    delete this.data.reactions[reactionId];
    this.save();
  }

  /**
   * Get all reactions
   */
  async getReactions(): Promise<ReactionPackage[]> {
    if (!this.data.reactions) {
      return [];
    }
    return Object.values(this.data.reactions);
  }

  /**
   * Check if a reaction exists
   */
  hasReaction(reactionId: string): boolean {
    return !!(this.data.reactions && this.data.reactions[reactionId]);
  }

  // =================================================================
  //  BOOKMARKS PERSISTENCE
  // =================================================================

  /**
   * Add a bookmark
   */
  async addBookmark(postId: string): Promise<void> {
    if (!this.data.bookmarks) {
      this.data.bookmarks = [];
    }

    if (!this.data.bookmarks.includes(postId)) {
      this.data.bookmarks.push(postId);
      this.save();
    }
  }

  /**
   * Remove a bookmark
   */
  async removeBookmark(postId: string): Promise<void> {
    if (!this.data.bookmarks) return;

    this.data.bookmarks = this.data.bookmarks.filter(id => id !== postId);
    this.save();
  }

  /**
   * Get all bookmarks
   */
  async getBookmarks(): Promise<string[]> {
    return this.data.bookmarks || [];
  }

  /**
   * Check if a post is bookmarked
   */
  isBookmarked(postId: string): boolean {
    return !!(this.data.bookmarks && this.data.bookmarks.includes(postId));
  }
}