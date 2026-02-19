/**
 * UserDataStore - Per-user data persistence for multi-user web deployment
 *
 * In browser-identity mode, each user's data is namespaced by their public key.
 * This includes:
 * - Day Pass tickets (from Freebird)
 * - Trust graph (who they trust)
 * - Local data (nicknames, tags, muted users, bookmarks)
 * - Profile metadata (display name, bio, avatar)
 * - Notification state
 *
 * Data is stored at: ~/.clout/users/{publicKey}/
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Get Clout data directory from environment or default
 */
function getCloutDataDir(): string {
  return process.env.CLOUT_DATA_DIR || join(homedir(), '.clout');
}

/**
 * Truncate public key for logging
 */
function shortKey(publicKey: string): string {
  return publicKey.slice(0, 12) + '...';
}

/**
 * User ticket data (Day Pass)
 */
export interface UserTicket {
  owner: string;
  expiry: number;
  durationHours: number;
  ticketType: 'browser-identity';
  freebirdProof?: Uint8Array | number[];
  created: number;
  proof?: any;
}

/**
 * User profile metadata
 */
export interface UserProfile {
  publicKey: string;
  displayName?: string;
  bio?: string;
  avatar?: string;
  created: number;
  lastUpdated: number;
}

/**
 * User local data (not synced to network)
 */
export interface UserLocalData {
  trustGraph: string[];           // Array of trusted public keys
  tags: Record<string, string[]>; // tag -> publicKeys
  nicknames: Record<string, string>; // publicKey -> nickname
  muted: string[];                // muted publicKeys
  bookmarks: string[];            // bookmarked postIds
  trustWeights: Record<string, number>; // publicKey -> weight (0.1-1.0)
  notifications: {
    lastSeenSlides: number;
    lastSeenReplies: number;
    lastSeenMentions: number;
  };
  /**
   * Whether the user is registered with Freebird (can renew Day Pass without invitation)
   * Set to true after first successful token issuance with invitation mode.
   */
  isFreebirdRegistered?: boolean;
}

/**
 * Complete user data bundle
 */
export interface UserData {
  version: string;
  publicKey: string;
  ticket: UserTicket | null;
  profile: UserProfile;
  localData: UserLocalData;
}

/**
 * UserDataStore - Manages per-user data persistence
 */
export class UserDataStore {
  private usersDir: string;
  private cache: Map<string, UserData> = new Map();

  constructor() {
    const dataDir = getCloutDataDir();
    this.usersDir = join(dataDir, 'users');
  }

  /**
   * Initialize the store - creates directories
   */
  async init(): Promise<void> {
    if (!existsSync(this.usersDir)) {
      mkdirSync(this.usersDir, { recursive: true });
      console.log(`[UserDataStore] 📁 Created users directory: ${this.usersDir}`);
    }
  }

  /**
   * Get the directory path for a user
   */
  private getUserDir(publicKey: string): string {
    return join(this.usersDir, publicKey);
  }

  /**
   * Ensure user directory exists
   */
  private ensureUserDir(publicKey: string): string {
    const userDir = this.getUserDir(publicKey);
    if (!existsSync(userDir)) {
      mkdirSync(userDir, { recursive: true });
    }
    return userDir;
  }

  /**
   * Get user data file path
   */
  private getUserDataPath(publicKey: string): string {
    return join(this.getUserDir(publicKey), 'data.json');
  }

  /**
   * Create default user data structure
   */
  private createDefaultUserData(publicKey: string): UserData {
    const now = Date.now();
    return {
      version: '1.0',
      publicKey,
      ticket: null,
      profile: {
        publicKey,
        created: now,
        lastUpdated: now
      },
      localData: {
        trustGraph: [],
        tags: {},
        nicknames: {},
        muted: [],
        bookmarks: [],
        trustWeights: {},
        notifications: {
          lastSeenSlides: now,
          lastSeenReplies: now,
          lastSeenMentions: now
        }
      }
    };
  }

  /**
   * Load user data from disk (with caching)
   */
  async loadUserData(publicKey: string): Promise<UserData> {
    // Check cache first
    if (this.cache.has(publicKey)) {
      return this.cache.get(publicKey)!;
    }

    const dataPath = this.getUserDataPath(publicKey);

    if (!existsSync(dataPath)) {
      // New user - create default data
      const userData = this.createDefaultUserData(publicKey);
      this.cache.set(publicKey, userData);
      return userData;
    }

    try {
      const raw = readFileSync(dataPath, 'utf-8');
      const userData = JSON.parse(raw) as UserData;
      this.cache.set(publicKey, userData);
      console.log(`[UserDataStore] 📂 Loaded data for user ${shortKey(publicKey)}`);
      return userData;
    } catch (error) {
      console.warn(`[UserDataStore] Failed to load data for ${shortKey(publicKey)}, starting fresh`);
      const userData = this.createDefaultUserData(publicKey);
      this.cache.set(publicKey, userData);
      return userData;
    }
  }

  /**
   * Save user data to disk
   */
  async saveUserData(publicKey: string, userData: UserData): Promise<void> {
    this.ensureUserDir(publicKey);
    const dataPath = this.getUserDataPath(publicKey);

    userData.profile.lastUpdated = Date.now();

    writeFileSync(dataPath, JSON.stringify(userData, null, 2), 'utf-8');
    this.cache.set(publicKey, userData);
    console.log(`[UserDataStore] 💾 Saved data for user ${shortKey(publicKey)}`);
  }

  // =========================================================================
  //  TICKET OPERATIONS
  // =========================================================================

  /**
   * Get user's Day Pass ticket
   */
  async getTicket(publicKey: string): Promise<UserTicket | null> {
    const userData = await this.loadUserData(publicKey);
    return userData.ticket;
  }

  /**
   * Set user's Day Pass ticket
   */
  async setTicket(publicKey: string, ticket: UserTicket): Promise<void> {
    const userData = await this.loadUserData(publicKey);
    userData.ticket = ticket;
    await this.saveUserData(publicKey, userData);
  }

  /**
   * Clear user's Day Pass ticket
   */
  async clearTicket(publicKey: string): Promise<void> {
    const userData = await this.loadUserData(publicKey);
    userData.ticket = null;
    await this.saveUserData(publicKey, userData);
  }

  /**
   * Check if user has valid (non-expired) ticket
   */
  async hasValidTicket(publicKey: string): Promise<boolean> {
    const ticket = await this.getTicket(publicKey);
    if (!ticket) return false;
    return ticket.expiry > Date.now();
  }

  // =========================================================================
  //  PROFILE OPERATIONS
  // =========================================================================

  /**
   * Get user profile
   */
  async getProfile(publicKey: string): Promise<UserProfile> {
    const userData = await this.loadUserData(publicKey);
    return userData.profile;
  }

  /**
   * Update user profile metadata
   */
  async updateProfile(publicKey: string, metadata: {
    displayName?: string;
    bio?: string;
    avatar?: string;
  }): Promise<UserProfile> {
    const userData = await this.loadUserData(publicKey);

    if (metadata.displayName !== undefined) {
      userData.profile.displayName = metadata.displayName;
    }
    if (metadata.bio !== undefined) {
      userData.profile.bio = metadata.bio;
    }
    if (metadata.avatar !== undefined) {
      userData.profile.avatar = metadata.avatar;
    }

    await this.saveUserData(publicKey, userData);
    return userData.profile;
  }

  // =========================================================================
  //  TRUST GRAPH OPERATIONS
  // =========================================================================

  /**
   * Get user's trust graph (list of trusted public keys)
   */
  async getTrustGraph(publicKey: string): Promise<string[]> {
    const userData = await this.loadUserData(publicKey);
    return userData.localData.trustGraph;
  }

  /**
   * Add a user to trust graph
   */
  async trust(publicKey: string, trustedKey: string, weight: number = 1.0): Promise<void> {
    const userData = await this.loadUserData(publicKey);

    if (!userData.localData.trustGraph.includes(trustedKey)) {
      userData.localData.trustGraph.push(trustedKey);
    }
    userData.localData.trustWeights[trustedKey] = Math.max(0.1, Math.min(1.0, weight));

    await this.saveUserData(publicKey, userData);
    console.log(`[UserDataStore] 🤝 ${shortKey(publicKey)} trusts ${shortKey(trustedKey)} (weight: ${weight})`);
  }

  /**
   * Remove a user from trust graph
   */
  async untrust(publicKey: string, untrustedKey: string): Promise<void> {
    const userData = await this.loadUserData(publicKey);

    userData.localData.trustGraph = userData.localData.trustGraph.filter(k => k !== untrustedKey);
    delete userData.localData.trustWeights[untrustedKey];

    await this.saveUserData(publicKey, userData);
    console.log(`[UserDataStore] 💔 ${shortKey(publicKey)} untrusted ${shortKey(untrustedKey)}`);
  }

  /**
   * Get trust weight for a user
   */
  async getTrustWeight(publicKey: string, trustedKey: string): Promise<number | undefined> {
    const userData = await this.loadUserData(publicKey);
    return userData.localData.trustWeights[trustedKey];
  }

  /**
   * Check if user trusts another user
   */
  async isTrusted(publicKey: string, targetKey: string): Promise<boolean> {
    const userData = await this.loadUserData(publicKey);
    return userData.localData.trustGraph.includes(targetKey);
  }

  // =========================================================================
  //  TAG OPERATIONS
  // =========================================================================

  /**
   * Add a tag to a trusted user
   */
  async addTag(publicKey: string, targetKey: string, tag: string): Promise<void> {
    const userData = await this.loadUserData(publicKey);
    const normalizedTag = tag.toLowerCase().trim();

    if (!userData.localData.tags[normalizedTag]) {
      userData.localData.tags[normalizedTag] = [];
    }
    if (!userData.localData.tags[normalizedTag].includes(targetKey)) {
      userData.localData.tags[normalizedTag].push(targetKey);
    }

    await this.saveUserData(publicKey, userData);
  }

  /**
   * Remove a tag from a user
   */
  async removeTag(publicKey: string, targetKey: string, tag: string): Promise<void> {
    const userData = await this.loadUserData(publicKey);
    const normalizedTag = tag.toLowerCase().trim();

    if (userData.localData.tags[normalizedTag]) {
      userData.localData.tags[normalizedTag] = userData.localData.tags[normalizedTag].filter(k => k !== targetKey);
      if (userData.localData.tags[normalizedTag].length === 0) {
        delete userData.localData.tags[normalizedTag];
      }
    }

    await this.saveUserData(publicKey, userData);
  }

  /**
   * Get all tags for a user
   */
  async getTagsForUser(publicKey: string, targetKey: string): Promise<string[]> {
    const userData = await this.loadUserData(publicKey);
    const tags: string[] = [];

    for (const [tag, users] of Object.entries(userData.localData.tags)) {
      if (users.includes(targetKey)) {
        tags.push(tag);
      }
    }

    return tags;
  }

  /**
   * Get all users with a specific tag
   */
  async getUsersByTag(publicKey: string, tag: string): Promise<string[]> {
    const userData = await this.loadUserData(publicKey);
    const normalizedTag = tag.toLowerCase().trim();
    return userData.localData.tags[normalizedTag] || [];
  }

  /**
   * Get all tags with counts
   */
  async getAllTags(publicKey: string): Promise<Map<string, number>> {
    const userData = await this.loadUserData(publicKey);
    const tagCounts = new Map<string, number>();

    for (const [tag, users] of Object.entries(userData.localData.tags)) {
      tagCounts.set(tag, users.length);
    }

    return tagCounts;
  }

  // =========================================================================
  //  NICKNAME OPERATIONS
  // =========================================================================

  /**
   * Set nickname for a user
   */
  async setNickname(publicKey: string, targetKey: string, nickname: string): Promise<void> {
    const userData = await this.loadUserData(publicKey);

    if (nickname.trim()) {
      userData.localData.nicknames[targetKey] = nickname.trim();
    } else {
      delete userData.localData.nicknames[targetKey];
    }

    await this.saveUserData(publicKey, userData);
  }

  /**
   * Get nickname for a user
   */
  async getNickname(publicKey: string, targetKey: string): Promise<string | undefined> {
    const userData = await this.loadUserData(publicKey);
    return userData.localData.nicknames[targetKey];
  }

  /**
   * Get display name (nickname or truncated key)
   */
  async getDisplayName(publicKey: string, targetKey: string): Promise<string> {
    const nickname = await this.getNickname(publicKey, targetKey);
    return nickname || shortKey(targetKey);
  }

  /**
   * Get all nicknames
   */
  async getAllNicknames(publicKey: string): Promise<Map<string, string>> {
    const userData = await this.loadUserData(publicKey);
    return new Map(Object.entries(userData.localData.nicknames));
  }

  // =========================================================================
  //  MUTE OPERATIONS
  // =========================================================================

  /**
   * Mute a user
   */
  async mute(publicKey: string, targetKey: string): Promise<void> {
    const userData = await this.loadUserData(publicKey);

    if (!userData.localData.muted.includes(targetKey)) {
      userData.localData.muted.push(targetKey);
    }

    await this.saveUserData(publicKey, userData);
  }

  /**
   * Unmute a user
   */
  async unmute(publicKey: string, targetKey: string): Promise<void> {
    const userData = await this.loadUserData(publicKey);
    userData.localData.muted = userData.localData.muted.filter(k => k !== targetKey);
    await this.saveUserData(publicKey, userData);
  }

  /**
   * Check if user is muted
   */
  async isMuted(publicKey: string, targetKey: string): Promise<boolean> {
    const userData = await this.loadUserData(publicKey);
    return userData.localData.muted.includes(targetKey);
  }

  /**
   * Get all muted users
   */
  async getMutedUsers(publicKey: string): Promise<string[]> {
    const userData = await this.loadUserData(publicKey);
    return userData.localData.muted;
  }

  // =========================================================================
  //  BOOKMARK OPERATIONS
  // =========================================================================

  /**
   * Bookmark a post
   */
  async bookmark(publicKey: string, postId: string): Promise<void> {
    const userData = await this.loadUserData(publicKey);

    if (!userData.localData.bookmarks.includes(postId)) {
      userData.localData.bookmarks.push(postId);
    }

    await this.saveUserData(publicKey, userData);
  }

  /**
   * Remove bookmark
   */
  async unbookmark(publicKey: string, postId: string): Promise<void> {
    const userData = await this.loadUserData(publicKey);
    userData.localData.bookmarks = userData.localData.bookmarks.filter(id => id !== postId);
    await this.saveUserData(publicKey, userData);
  }

  /**
   * Check if post is bookmarked
   */
  async isBookmarked(publicKey: string, postId: string): Promise<boolean> {
    const userData = await this.loadUserData(publicKey);
    return userData.localData.bookmarks.includes(postId);
  }

  /**
   * Get all bookmarks
   */
  async getBookmarks(publicKey: string): Promise<string[]> {
    const userData = await this.loadUserData(publicKey);
    return userData.localData.bookmarks;
  }

  // =========================================================================
  //  NOTIFICATION OPERATIONS
  // =========================================================================

  /**
   * Get notification state
   */
  async getNotificationState(publicKey: string): Promise<UserLocalData['notifications']> {
    const userData = await this.loadUserData(publicKey);
    return { ...userData.localData.notifications };
  }

  /**
   * Mark slides as seen
   */
  async markSlidesSeen(publicKey: string): Promise<void> {
    const userData = await this.loadUserData(publicKey);
    userData.localData.notifications.lastSeenSlides = Date.now();
    await this.saveUserData(publicKey, userData);
  }

  /**
   * Mark replies as seen
   */
  async markRepliesSeen(publicKey: string): Promise<void> {
    const userData = await this.loadUserData(publicKey);
    userData.localData.notifications.lastSeenReplies = Date.now();
    await this.saveUserData(publicKey, userData);
  }

  /**
   * Mark mentions as seen
   */
  async markMentionsSeen(publicKey: string): Promise<void> {
    const userData = await this.loadUserData(publicKey);
    userData.localData.notifications.lastSeenMentions = Date.now();
    await this.saveUserData(publicKey, userData);
  }

  // =========================================================================
  //  FREEBIRD REGISTRATION OPERATIONS
  // =========================================================================

  /**
   * Check if user is registered with Freebird (can renew Day Pass without invitation)
   */
  async isFreebirdRegistered(publicKey: string): Promise<boolean> {
    const userData = await this.loadUserData(publicKey);
    return userData.localData.isFreebirdRegistered ?? false;
  }

  /**
   * Mark user as registered with Freebird
   * Call this after successful token issuance with invitation mode
   */
  async setFreebirdRegistered(publicKey: string, registered: boolean): Promise<void> {
    const userData = await this.loadUserData(publicKey);
    userData.localData.isFreebirdRegistered = registered;
    await this.saveUserData(publicKey, userData);
    console.log(`[UserDataStore] 🎫 ${shortKey(publicKey)} Freebird registered: ${registered}`);
  }

  // =========================================================================
  //  UTILITY OPERATIONS
  // =========================================================================

  /**
   * List all registered users
   */
  listUsers(): string[] {
    if (!existsSync(this.usersDir)) {
      return [];
    }

    return readdirSync(this.usersDir).filter(name => {
      // Only include directories that look like public keys (64 hex chars)
      return name.length === 64 && /^[0-9a-fA-F]+$/.test(name);
    });
  }

  /**
   * Check if user exists
   */
  userExists(publicKey: string): boolean {
    return existsSync(this.getUserDataPath(publicKey));
  }

  /**
   * Delete user data
   */
  async deleteUser(publicKey: string): Promise<void> {
    const userDir = this.getUserDir(publicKey);
    if (existsSync(userDir)) {
      // Remove directory recursively
      const { rmSync } = await import('fs');
      rmSync(userDir, { recursive: true, force: true });
      this.cache.delete(publicKey);
      console.log(`[UserDataStore] 🗑️ Deleted data for user ${shortKey(publicKey)}`);
    }
  }

  /**
   * Clear cache (useful for testing)
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Export user data for backup
   */
  async exportUserData(publicKey: string): Promise<UserData> {
    return await this.loadUserData(publicKey);
  }

  /**
   * Import user data from backup
   */
  async importUserData(publicKey: string, data: Partial<UserData>): Promise<void> {
    const existing = await this.loadUserData(publicKey);

    // Merge imported data
    if (data.ticket) {
      existing.ticket = data.ticket;
    }
    if (data.profile) {
      existing.profile = { ...existing.profile, ...data.profile };
    }
    if (data.localData) {
      // Merge arrays (union)
      if (data.localData.trustGraph) {
        existing.localData.trustGraph = [...new Set([
          ...existing.localData.trustGraph,
          ...data.localData.trustGraph
        ])];
      }
      if (data.localData.muted) {
        existing.localData.muted = [...new Set([
          ...existing.localData.muted,
          ...data.localData.muted
        ])];
      }
      if (data.localData.bookmarks) {
        existing.localData.bookmarks = [...new Set([
          ...existing.localData.bookmarks,
          ...data.localData.bookmarks
        ])];
      }
      // Merge objects (override)
      if (data.localData.tags) {
        existing.localData.tags = { ...existing.localData.tags, ...data.localData.tags };
      }
      if (data.localData.nicknames) {
        existing.localData.nicknames = { ...existing.localData.nicknames, ...data.localData.nicknames };
      }
      if (data.localData.trustWeights) {
        existing.localData.trustWeights = { ...existing.localData.trustWeights, ...data.localData.trustWeights };
      }
    }

    await this.saveUserData(publicKey, existing);
  }
}
