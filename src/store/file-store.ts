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

/**
 * Serialized ticket for persistence (Uint8Array fields as base64)
 */
interface SerializedTicket {
  owner: string;
  expiry: number;
  proof: string;           // base64
  signature: {             // Attestation serialized
    hash: string;
    timestamp: number;
    signatures: string[];
    witnessIds: string[];
    raw?: any;
  };
  durationHours: number;
  delegatedFrom?: string;
}

/**
 * Member invitation quota entry
 */
interface MemberQuotaEntry {
  publicKey: string;
  quota: number;           // Total quota granted
  used: number;            // Number of invitations created
  grantedAt: number;       // Timestamp when quota was first granted
  lastGrantedAt: number;   // Timestamp of most recent quota grant
}

/**
 * Created invitation tracking
 */
interface CreatedInvitation {
  code: string;
  creatorPublicKey: string;
  createdAt: number;
  expiresAt: number;
  redeemed: boolean;
  redeemedBy?: string;
  redeemedAt?: number;
}

interface LocalData {
  version: string;
  posts: { [id: string]: PostPackage };
  slides: { [id: string]: SlidePackage };
  trustGraph?: TrustGraphEntry[];
  deletions?: { [postId: string]: PostDeletePackage };
  reactions?: { [reactionId: string]: ReactionPackage };
  bookmarks?: string[];  // Array of bookmarked post IDs
  ticket?: SerializedTicket;  // Current Freebird day pass (persists across restarts)
  // Dark Social Graph fields (isomorphic with browser IndexedDB)
  nicknames?: { [publicKey: string]: string };
  tags?: { [tag: string]: string[] };  // tag -> publicKeys
  muted?: string[];  // muted publicKeys
  notifications?: {
    lastSeenSlides: number;
    lastSeenReplies: number;
    lastSeenMentions: number;
  };
  // Invitation quota system
  memberQuotas?: { [publicKey: string]: MemberQuotaEntry };
  createdInvitations?: { [code: string]: CreatedInvitation };
}

export class FileSystemStore implements CloutStore {
  private path: string;
  private data: LocalData;
  private initialized = false;

  constructor(customPath?: string) {
    this.path = customPath || join(getCloutDataDir(), 'local-data.json');
    this.data = { version: '1.0', posts: {}, slides: {} };
  }

  async init(): Promise<void> {
    // Prevent multiple initializations - this fixes race condition where
    // initializeDataLayer() calls init() after posts have been added
    if (this.initialized) {
      console.log(`[FileStore] Already initialized at ${this.path}`);
      return;
    }
    this.initialized = true;
    this.ensureDir();
    this.load();
    console.log(`[FileStore] ✅ Initialized at ${this.path} (existing posts: ${Object.keys(this.data.posts).length})`);
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
    try {
      writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (error) {
      console.error(`[FileStore] ❌ Failed to save to ${this.path}:`, error);
      throw error;
    }
  }

  async addPost(post: PostPackage): Promise<void> {
    if (!this.data.posts[post.id]) {
      this.data.posts[post.id] = post;
      this.save();
      console.log(`[FileStore] 📝 Saved post ${post.id.slice(0, 8)} (total: ${Object.keys(this.data.posts).length})`);
    }
  }

  async getFeed(): Promise<PostPackage[]> {
    const posts = Object.values(this.data.posts)
      .sort((a, b) => b.proof.timestamp - a.proof.timestamp);
    console.log(`[FileStore] 📖 getFeed returning ${posts.length} posts`);
    return posts;
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
   * Save a post retraction
   * (Field name kept as 'deletions' for storage compatibility)
   */
  async addDeletion(retraction: PostDeletePackage): Promise<void> {
    if (!this.data.deletions) {
      this.data.deletions = {};
    }

    if (!this.data.deletions[retraction.postId]) {
      this.data.deletions[retraction.postId] = retraction;
      this.save();
    }
  }

  /**
   * Get all post retractions
   */
  async getDeletions(): Promise<PostDeletePackage[]> {
    if (!this.data.deletions) {
      return [];
    }
    return Object.values(this.data.deletions);
  }

  /**
   * Get all post retractions (synchronous version)
   */
  getDeletionsSync(): PostDeletePackage[] {
    if (!this.data.deletions) {
      return [];
    }
    return Object.values(this.data.deletions);
  }

  /**
   * Check if a post is retracted
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
   * Get all reactions (synchronous version for hot path)
   */
  getReactionsSync(): ReactionPackage[] {
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

  // =================================================================
  //  TICKET PERSISTENCE (survives Docker restarts)
  // =================================================================

  /**
   * Save a ticket (Freebird day pass)
   * Serializes Uint8Array fields to base64 for JSON storage
   */
  saveTicket(ticket: {
    owner: string;
    expiry: number;
    proof: Uint8Array;
    signature: { hash: string; timestamp: number; signatures: string[]; witnessIds: string[]; raw?: any };
    durationHours: number;
    delegatedFrom?: string;
  }): void {
    // Convert Uint8Array fields to base64 for JSON serialization
    const serialized: SerializedTicket = {
      owner: ticket.owner,
      expiry: ticket.expiry,
      proof: Buffer.from(ticket.proof).toString('base64'),
      signature: {
        hash: ticket.signature.hash,
        timestamp: ticket.signature.timestamp,
        signatures: ticket.signature.signatures,
        witnessIds: ticket.signature.witnessIds,
        raw: ticket.signature.raw
      },
      durationHours: ticket.durationHours,
      delegatedFrom: ticket.delegatedFrom
    };

    this.data.ticket = serialized;
    this.save();
  }

  /**
   * Get saved ticket (deserializes base64 back to Uint8Array)
   * Returns null if no ticket or ticket is expired
   */
  getTicket(): {
    owner: string;
    expiry: number;
    proof: Uint8Array;
    signature: { hash: string; timestamp: number; signatures: string[]; witnessIds: string[]; raw?: any };
    durationHours: number;
    delegatedFrom?: string;
  } | null {
    if (!this.data.ticket) {
      return null;
    }

    const serialized = this.data.ticket;

    // Check if expired
    if (Date.now() > serialized.expiry) {
      // Clear expired ticket
      delete this.data.ticket;
      this.save();
      return null;
    }

    // Check for old ticket format (had 'signature' string instead of 'signatures' array)
    // If found, clear it so a new ticket will be minted
    if (!serialized.signature.signatures || !Array.isArray(serialized.signature.signatures)) {
      console.log('[FileStore] Clearing old format ticket - will mint new one');
      delete this.data.ticket;
      this.save();
      return null;
    }

    // Deserialize base64 back to Uint8Array for proof, keep signature as-is
    return {
      owner: serialized.owner,
      expiry: serialized.expiry,
      proof: new Uint8Array(Buffer.from(serialized.proof, 'base64')),
      signature: {
        hash: serialized.signature.hash,
        timestamp: serialized.signature.timestamp,
        signatures: serialized.signature.signatures,
        witnessIds: serialized.signature.witnessIds,
        raw: serialized.signature.raw
      },
      durationHours: serialized.durationHours,
      delegatedFrom: serialized.delegatedFrom
    };
  }

  /**
   * Clear saved ticket
   */
  clearTicket(): void {
    delete this.data.ticket;
    this.save();
  }

  /**
   * Check if a valid (non-expired) ticket exists
   */
  hasValidTicket(): boolean {
    if (!this.data.ticket) return false;
    return Date.now() <= this.data.ticket.expiry;
  }

  // =================================================================
  //  NICKNAMES (Dark Social Graph)
  // =================================================================

  /**
   * Set a nickname for a user
   */
  setNickname(publicKey: string, nickname: string): void {
    if (!this.data.nicknames) {
      this.data.nicknames = {};
    }
    if (nickname.trim()) {
      this.data.nicknames[publicKey] = nickname.trim();
    } else {
      delete this.data.nicknames[publicKey];
    }
    this.save();
  }

  /**
   * Get nickname for a user
   */
  getNickname(publicKey: string): string | undefined {
    return this.data.nicknames?.[publicKey];
  }

  /**
   * Get all nicknames
   */
  getAllNicknames(): { [publicKey: string]: string } {
    return this.data.nicknames || {};
  }

  // =================================================================
  //  TAGS (Dark Social Graph)
  // =================================================================

  /**
   * Add a tag to a user
   */
  addTag(publicKey: string, tag: string): void {
    const normalizedTag = tag.toLowerCase().trim();
    if (!this.data.tags) {
      this.data.tags = {};
    }
    if (!this.data.tags[normalizedTag]) {
      this.data.tags[normalizedTag] = [];
    }
    if (!this.data.tags[normalizedTag].includes(publicKey)) {
      this.data.tags[normalizedTag].push(publicKey);
      this.save();
    }
  }

  /**
   * Remove a tag from a user
   */
  removeTag(publicKey: string, tag: string): void {
    const normalizedTag = tag.toLowerCase().trim();
    if (this.data.tags?.[normalizedTag]) {
      this.data.tags[normalizedTag] = this.data.tags[normalizedTag].filter(k => k !== publicKey);
      if (this.data.tags[normalizedTag].length === 0) {
        delete this.data.tags[normalizedTag];
      }
      this.save();
    }
  }

  /**
   * Get tags for a user
   */
  getTagsForUser(publicKey: string): string[] {
    if (!this.data.tags) return [];
    const tags: string[] = [];
    for (const [tag, users] of Object.entries(this.data.tags)) {
      if (users.includes(publicKey)) {
        tags.push(tag);
      }
    }
    return tags;
  }

  /**
   * Get all tags with their users
   */
  getAllTags(): { [tag: string]: string[] } {
    return this.data.tags || {};
  }

  // =================================================================
  //  MUTED USERS (Dark Social Graph)
  // =================================================================

  /**
   * Mute a user
   */
  mute(publicKey: string): void {
    if (!this.data.muted) {
      this.data.muted = [];
    }
    if (!this.data.muted.includes(publicKey)) {
      this.data.muted.push(publicKey);
      this.save();
    }
  }

  /**
   * Unmute a user
   */
  unmute(publicKey: string): void {
    if (this.data.muted) {
      this.data.muted = this.data.muted.filter(k => k !== publicKey);
      this.save();
    }
  }

  /**
   * Check if a user is muted
   */
  isMuted(publicKey: string): boolean {
    return this.data.muted?.includes(publicKey) || false;
  }

  /**
   * Get all muted users
   */
  getMutedUsers(): string[] {
    return this.data.muted || [];
  }

  // =================================================================
  //  NOTIFICATIONS (Dark Social Graph)
  // =================================================================

  /**
   * Get notification state
   */
  getNotificationState(): { lastSeenSlides: number; lastSeenReplies: number; lastSeenMentions: number } {
    return this.data.notifications || {
      lastSeenSlides: 0,
      lastSeenReplies: 0,
      lastSeenMentions: 0
    };
  }

  /**
   * Mark notifications as seen
   */
  markSeen(type: 'slides' | 'replies' | 'mentions'): void {
    if (!this.data.notifications) {
      this.data.notifications = {
        lastSeenSlides: 0,
        lastSeenReplies: 0,
        lastSeenMentions: 0
      };
    }
    if (type === 'slides') this.data.notifications.lastSeenSlides = Date.now();
    if (type === 'replies') this.data.notifications.lastSeenReplies = Date.now();
    if (type === 'mentions') this.data.notifications.lastSeenMentions = Date.now();
    this.save();
  }

  // =================================================================
  //  DARK SOCIAL GRAPH IMPORT/EXPORT
  //  Compatible with browser IndexedDB export format
  // =================================================================

  /**
   * Export Dark Social Graph in browser-compatible format
   */
  exportDarkSocialGraph(myPublicKey: string): {
    version: string;
    exportedAt: number;
    trustGraph: { trustedKey: string; weight: number; created: number }[];
    nicknames: { [publicKey: string]: string };
    tags: { [tag: string]: string[] };
    muted: string[];
    bookmarks: string[];
    notifications: { lastSeenSlides: number; lastSeenReplies: number; lastSeenMentions: number };
  } {
    // Convert CLI trust graph format to browser format
    const trustGraph: { trustedKey: string; weight: number; created: number }[] = [];
    if (this.data.trustGraph) {
      for (const edge of this.data.trustGraph) {
        if (edge.truster === myPublicKey) {
          trustGraph.push({
            trustedKey: edge.trustee,
            weight: 1.0,
            created: edge.timestamp
          });
        }
      }
    }

    return {
      version: '1.0',
      exportedAt: Date.now(),
      trustGraph,
      nicknames: this.data.nicknames || {},
      tags: this.data.tags || {},
      muted: this.data.muted || [],
      bookmarks: this.data.bookmarks || [],
      notifications: this.getNotificationState()
    };
  }

  /**
   * Import Dark Social Graph from browser export format
   */
  importDarkSocialGraph(myPublicKey: string, data: {
    version?: string;
    trustGraph?: { trustedKey: string; weight?: number; created?: number }[];
    nicknames?: { [publicKey: string]: string };
    tags?: { [tag: string]: string[] };
    muted?: string[];
    bookmarks?: string[];
    notifications?: { lastSeenSlides?: number; lastSeenReplies?: number; lastSeenMentions?: number };
  }): { imported: { trust: number; nicknames: number; tags: number; muted: number; bookmarks: number } } {
    const stats = { trust: 0, nicknames: 0, tags: 0, muted: 0, bookmarks: 0 };

    // Import trust graph
    if (data.trustGraph && Array.isArray(data.trustGraph)) {
      if (!this.data.trustGraph) {
        this.data.trustGraph = [];
      }
      for (const entry of data.trustGraph) {
        const exists = this.data.trustGraph.some(
          e => e.truster === myPublicKey && e.trustee === entry.trustedKey
        );
        if (!exists) {
          this.data.trustGraph.push({
            truster: myPublicKey,
            trustee: entry.trustedKey,
            timestamp: entry.created || Date.now()
          });
          stats.trust++;
        }
      }
    }

    // Import nicknames
    if (data.nicknames) {
      if (!this.data.nicknames) {
        this.data.nicknames = {};
      }
      for (const [publicKey, nickname] of Object.entries(data.nicknames)) {
        if (!this.data.nicknames[publicKey]) {
          this.data.nicknames[publicKey] = nickname;
          stats.nicknames++;
        }
      }
    }

    // Import tags
    if (data.tags) {
      if (!this.data.tags) {
        this.data.tags = {};
      }
      for (const [tag, users] of Object.entries(data.tags)) {
        if (!this.data.tags[tag]) {
          this.data.tags[tag] = [];
        }
        for (const publicKey of users) {
          if (!this.data.tags[tag].includes(publicKey)) {
            this.data.tags[tag].push(publicKey);
            stats.tags++;
          }
        }
      }
    }

    // Import muted
    if (data.muted && Array.isArray(data.muted)) {
      if (!this.data.muted) {
        this.data.muted = [];
      }
      for (const publicKey of data.muted) {
        if (!this.data.muted.includes(publicKey)) {
          this.data.muted.push(publicKey);
          stats.muted++;
        }
      }
    }

    // Import bookmarks
    if (data.bookmarks && Array.isArray(data.bookmarks)) {
      if (!this.data.bookmarks) {
        this.data.bookmarks = [];
      }
      for (const postId of data.bookmarks) {
        if (!this.data.bookmarks.includes(postId)) {
          this.data.bookmarks.push(postId);
          stats.bookmarks++;
        }
      }
    }

    // Import notifications
    if (data.notifications) {
      if (!this.data.notifications) {
        this.data.notifications = { lastSeenSlides: 0, lastSeenReplies: 0, lastSeenMentions: 0 };
      }
      if (data.notifications.lastSeenSlides) {
        this.data.notifications.lastSeenSlides = Math.max(
          this.data.notifications.lastSeenSlides,
          data.notifications.lastSeenSlides
        );
      }
      if (data.notifications.lastSeenReplies) {
        this.data.notifications.lastSeenReplies = Math.max(
          this.data.notifications.lastSeenReplies,
          data.notifications.lastSeenReplies
        );
      }
      if (data.notifications.lastSeenMentions) {
        this.data.notifications.lastSeenMentions = Math.max(
          this.data.notifications.lastSeenMentions,
          data.notifications.lastSeenMentions
        );
      }
    }

    this.save();

    console.log(`[FileStore] 📥 Imported Dark Social Graph: ${stats.trust} trust edges, ${stats.nicknames} nicknames, ${stats.tags} tags, ${stats.muted} muted, ${stats.bookmarks} bookmarks`);

    return { imported: stats };
  }

  // =================================================================
  //  INVITATION QUOTA SYSTEM
  // =================================================================

  /**
   * Grant invitation quota to a member
   * Adds to existing quota if member already has some
   */
  grantQuota(publicKey: string, amount: number): MemberQuotaEntry {
    if (!this.data.memberQuotas) {
      this.data.memberQuotas = {};
    }

    const existing = this.data.memberQuotas[publicKey];
    const now = Date.now();

    if (existing) {
      existing.quota += amount;
      existing.lastGrantedAt = now;
    } else {
      this.data.memberQuotas[publicKey] = {
        publicKey,
        quota: amount,
        used: 0,
        grantedAt: now,
        lastGrantedAt: now
      };
    }

    this.save();
    console.log(`[FileStore] 🎫 Granted ${amount} invitation quota to ${publicKey.slice(0, 16)}... (total: ${this.data.memberQuotas[publicKey].quota})`);
    return this.data.memberQuotas[publicKey];
  }

  /**
   * Get a member's quota entry
   */
  getQuota(publicKey: string): MemberQuotaEntry | null {
    return this.data.memberQuotas?.[publicKey] || null;
  }

  /**
   * Get remaining quota for a member
   */
  getRemainingQuota(publicKey: string): number {
    const entry = this.data.memberQuotas?.[publicKey];
    if (!entry) return 0;
    return Math.max(0, entry.quota - entry.used);
  }

  /**
   * Get all members with quota
   */
  getAllMemberQuotas(): MemberQuotaEntry[] {
    if (!this.data.memberQuotas) return [];
    return Object.values(this.data.memberQuotas);
  }

  /**
   * Use quota to create an invitation
   * Returns false if not enough quota
   */
  useQuota(publicKey: string, count: number = 1): boolean {
    const entry = this.data.memberQuotas?.[publicKey];
    if (!entry) return false;

    const remaining = entry.quota - entry.used;
    if (remaining < count) return false;

    entry.used += count;
    this.save();
    return true;
  }

  /**
   * Record a created invitation
   */
  recordInvitation(invitation: CreatedInvitation): void {
    if (!this.data.createdInvitations) {
      this.data.createdInvitations = {};
    }

    this.data.createdInvitations[invitation.code] = invitation;
    this.save();
    console.log(`[FileStore] 📝 Recorded invitation ${invitation.code.slice(0, 8)}... by ${invitation.creatorPublicKey.slice(0, 16)}...`);
  }

  /**
   * Get invitations created by a member
   */
  getInvitationsByCreator(publicKey: string): CreatedInvitation[] {
    if (!this.data.createdInvitations) return [];
    return Object.values(this.data.createdInvitations)
      .filter(inv => inv.creatorPublicKey === publicKey)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Get all created invitations
   */
  getAllInvitations(): CreatedInvitation[] {
    if (!this.data.createdInvitations) return [];
    return Object.values(this.data.createdInvitations)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Get invitation by code
   */
  getInvitation(code: string): CreatedInvitation | null {
    return this.data.createdInvitations?.[code] || null;
  }

  /**
   * Mark invitation as redeemed
   */
  markInvitationRedeemed(code: string, redeemerPublicKey: string): boolean {
    const invitation = this.data.createdInvitations?.[code];
    if (!invitation) return false;

    invitation.redeemed = true;
    invitation.redeemedBy = redeemerPublicKey;
    invitation.redeemedAt = Date.now();
    this.save();
    console.log(`[FileStore] ✅ Marked invitation ${code.slice(0, 8)}... as redeemed by ${redeemerPublicKey.slice(0, 16)}...`);
    return true;
  }

  /**
   * Get invitation by redeemer's public key
   * Returns the invitation that was redeemed by this user, if any
   */
  getInvitationByRedeemer(redeemerPublicKey: string): CreatedInvitation | null {
    if (!this.data.createdInvitations) return null;

    for (const inv of Object.values(this.data.createdInvitations)) {
      if (inv.redeemedBy === redeemerPublicKey) {
        return inv;
      }
    }
    return null;
  }

  /**
   * Get invitation statistics for a member
   */
  getInvitationStats(publicKey: string): {
    quotaTotal: number;
    quotaUsed: number;
    quotaRemaining: number;
    invitationsCreated: number;
    invitationsRedeemed: number;
    inviteePublicKeys: string[];
  } {
    const quota = this.data.memberQuotas?.[publicKey];
    const invitations = this.getInvitationsByCreator(publicKey);

    const redeemed = invitations.filter(inv => inv.redeemed);

    return {
      quotaTotal: quota?.quota || 0,
      quotaUsed: quota?.used || 0,
      quotaRemaining: quota ? Math.max(0, quota.quota - quota.used) : 0,
      invitationsCreated: invitations.length,
      invitationsRedeemed: redeemed.length,
      inviteePublicKeys: redeemed
        .filter(inv => inv.redeemedBy)
        .map(inv => inv.redeemedBy!)
    };
  }
}

// Re-export types for use in routes
export type { MemberQuotaEntry, CreatedInvitation };