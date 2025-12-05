/**
 * CloutLocalData - Local-only data management
 *
 * Handles features that are never synced to the network:
 * - Trust Tags: Organize contacts into groups (friends, work, family)
 * - Nicknames: Personal address book for remembering who's who
 * - Muted Users: Hide posts from specific users without untrusting them
 * - Bookmarks: Save posts locally for later reference
 *
 * This data stays on the user's device for privacy.
 */

// Notification types
export interface NotificationState {
  lastSeenSlides: number;
  lastSeenReplies: number;
  lastSeenMentions: number;
}

export class CloutLocalData {
  private readonly trustTags: Map<string, Set<string>>; // tag -> Set<publicKey>
  private readonly nicknames: Map<string, string>; // publicKey -> nickname
  private readonly mutedUsers: Set<string>; // publicKeys of muted users
  private readonly bookmarks: Set<string>; // postIds of bookmarked posts
  private readonly trustGraph: Set<string>; // Reference to validate tag operations
  private notifications: NotificationState; // Track last seen timestamps

  constructor(trustGraph: Set<string>) {
    this.trustGraph = trustGraph;
    this.trustTags = new Map<string, Set<string>>();
    this.nicknames = new Map<string, string>();
    this.mutedUsers = new Set<string>();
    this.bookmarks = new Set<string>();
    this.notifications = {
      lastSeenSlides: Date.now(),
      lastSeenReplies: Date.now(),
      lastSeenMentions: Date.now()
    };
  }

  // =================================================================
  //  TRUST TAGS
  // =================================================================

  /**
   * Add a tag to a trusted user (e.g., "friends", "work", "family")
   *
   * Tags are local only and not synced to the network for privacy.
   * Use tags to filter your feed and organize your trust network.
   */
  addTag(publicKey: string, tag: string): void {
    if (!this.trustGraph.has(publicKey)) {
      throw new Error(`Cannot tag ${publicKey}: not in trust graph`);
    }

    const normalizedTag = tag.toLowerCase().trim();

    if (!this.trustTags.has(normalizedTag)) {
      this.trustTags.set(normalizedTag, new Set<string>());
    }

    this.trustTags.get(normalizedTag)!.add(publicKey);
    console.log(`[Clout] 🏷️ Tagged ${publicKey.slice(0, 8)} as '${normalizedTag}'`);
  }

  /**
   * Remove a tag from a user
   */
  removeTag(publicKey: string, tag: string): void {
    const normalizedTag = tag.toLowerCase().trim();
    const taggedUsers = this.trustTags.get(normalizedTag);

    if (taggedUsers) {
      taggedUsers.delete(publicKey);

      // Clean up empty tags
      if (taggedUsers.size === 0) {
        this.trustTags.delete(normalizedTag);
      }

      console.log(`[Clout] 🏷️ Removed tag '${normalizedTag}' from ${publicKey.slice(0, 8)}`);
    }
  }

  /**
   * Get all users with a specific tag
   */
  getUsersByTag(tag: string): string[] {
    const normalizedTag = tag.toLowerCase().trim();
    const users = this.trustTags.get(normalizedTag);
    return users ? Array.from(users) : [];
  }

  /**
   * Get all tags for a specific user
   */
  getTagsForUser(publicKey: string): string[] {
    const tags: string[] = [];

    for (const [tag, users] of this.trustTags.entries()) {
      if (users.has(publicKey)) {
        tags.push(tag);
      }
    }

    return tags;
  }

  /**
   * Get all tags and their member counts
   */
  getAllTags(): Map<string, number> {
    const tagCounts = new Map<string, number>();

    for (const [tag, users] of this.trustTags.entries()) {
      tagCounts.set(tag, users.size);
    }

    return tagCounts;
  }

  /**
   * Check if a user has a specific tag
   */
  hasTag(publicKey: string, tag: string): boolean {
    const normalizedTag = tag.toLowerCase().trim();
    const users = this.trustTags.get(normalizedTag);
    return users ? users.has(publicKey) : false;
  }

  // =================================================================
  //  NICKNAMES
  // =================================================================

  /**
   * Set a nickname for a user (like naming a contact in your phone)
   *
   * Nicknames are local only - they're never shared with the network.
   * Use them to identify people in your feed by memorable names.
   */
  setNickname(publicKey: string, nickname: string): void {
    const trimmedNickname = nickname.trim();

    if (!trimmedNickname) {
      // Empty nickname = remove it
      this.nicknames.delete(publicKey);
      console.log(`[Clout] 📇 Removed nickname for ${publicKey.slice(0, 8)}`);
    } else {
      this.nicknames.set(publicKey, trimmedNickname);
      console.log(`[Clout] 📇 Set nickname for ${publicKey.slice(0, 8)}: "${trimmedNickname}"`);
    }
  }

  /**
   * Get the nickname for a user (returns undefined if not set)
   */
  getNickname(publicKey: string): string | undefined {
    return this.nicknames.get(publicKey);
  }

  /**
   * Get display name for a user - nickname if set, otherwise truncated public key
   */
  getDisplayName(publicKey: string): string {
    const nickname = this.nicknames.get(publicKey);
    if (nickname) {
      return nickname;
    }
    // Fallback to truncated key
    return publicKey.slice(0, 8) + '...';
  }

  /**
   * Get all nicknames (for backup/export)
   */
  getAllNicknames(): Map<string, string> {
    return new Map(this.nicknames);
  }

  /**
   * Check if a user has a nickname set
   */
  hasNickname(publicKey: string): boolean {
    return this.nicknames.has(publicKey);
  }

  // =================================================================
  //  MUTED USERS
  // =================================================================

  /**
   * Mute a user - their posts will be hidden from your feed
   *
   * Unlike untrusting, muting is local-only and doesn't affect the trust graph.
   * You still trust them (their content propagates), you just don't see it.
   */
  mute(publicKey: string): void {
    this.mutedUsers.add(publicKey);
    console.log(`[Clout] 🔇 Muted ${publicKey.slice(0, 8)}`);
  }

  /**
   * Unmute a user - their posts will appear in your feed again
   */
  unmute(publicKey: string): void {
    this.mutedUsers.delete(publicKey);
    console.log(`[Clout] 🔊 Unmuted ${publicKey.slice(0, 8)}`);
  }

  /**
   * Check if a user is muted
   */
  isMuted(publicKey: string): boolean {
    return this.mutedUsers.has(publicKey);
  }

  /**
   * Get all muted users
   */
  getMutedUsers(): string[] {
    return Array.from(this.mutedUsers);
  }

  /**
   * Get count of muted users
   */
  getMutedCount(): number {
    return this.mutedUsers.size;
  }

  // =================================================================
  //  BOOKMARKS
  // =================================================================

  /**
   * Bookmark a post for later reference
   *
   * Bookmarks are local-only and never synced to the network.
   * Use them to save posts you want to revisit.
   */
  bookmark(postId: string): void {
    this.bookmarks.add(postId);
    console.log(`[Clout] 🔖 Bookmarked post ${postId.slice(0, 8)}`);
  }

  /**
   * Remove a bookmark from a post
   */
  unbookmark(postId: string): void {
    this.bookmarks.delete(postId);
    console.log(`[Clout] 🔖 Removed bookmark from ${postId.slice(0, 8)}`);
  }

  /**
   * Check if a post is bookmarked
   */
  isBookmarked(postId: string): boolean {
    return this.bookmarks.has(postId);
  }

  /**
   * Get all bookmarked post IDs
   */
  getBookmarks(): string[] {
    return Array.from(this.bookmarks);
  }

  /**
   * Get count of bookmarks
   */
  getBookmarkCount(): number {
    return this.bookmarks.size;
  }

  // =================================================================
  //  NOTIFICATIONS
  // =================================================================

  /**
   * Get the notification state
   */
  getNotificationState(): NotificationState {
    return { ...this.notifications };
  }

  /**
   * Mark slides as seen (updates lastSeenSlides timestamp)
   */
  markSlidesSeen(): void {
    this.notifications.lastSeenSlides = Date.now();
    console.log(`[Clout] 📬 Marked slides as seen`);
  }

  /**
   * Mark replies as seen
   */
  markRepliesSeen(): void {
    this.notifications.lastSeenReplies = Date.now();
    console.log(`[Clout] 💬 Marked replies as seen`);
  }

  /**
   * Mark mentions as seen
   */
  markMentionsSeen(): void {
    this.notifications.lastSeenMentions = Date.now();
    console.log(`[Clout] 📢 Marked mentions as seen`);
  }

  /**
   * Get last seen timestamp for a notification type
   */
  getLastSeen(type: 'slides' | 'replies' | 'mentions'): number {
    switch (type) {
      case 'slides': return this.notifications.lastSeenSlides;
      case 'replies': return this.notifications.lastSeenReplies;
      case 'mentions': return this.notifications.lastSeenMentions;
    }
  }

  // =================================================================
  //  PERSISTENCE (Future)
  // =================================================================

  /**
   * Export all local data for backup
   */
  export(): { tags: Record<string, string[]>; nicknames: Record<string, string>; muted: string[]; bookmarks: string[] } {
    const tags: Record<string, string[]> = {};
    for (const [tag, users] of this.trustTags.entries()) {
      tags[tag] = Array.from(users);
    }

    const nicknames: Record<string, string> = {};
    for (const [key, name] of this.nicknames.entries()) {
      nicknames[key] = name;
    }

    const muted = Array.from(this.mutedUsers);
    const bookmarks = Array.from(this.bookmarks);

    return { tags, nicknames, muted, bookmarks };
  }

  /**
   * Import local data from backup
   */
  import(data: { tags?: Record<string, string[]>; nicknames?: Record<string, string>; muted?: string[]; bookmarks?: string[] }): void {
    if (data.tags) {
      for (const [tag, users] of Object.entries(data.tags)) {
        for (const user of users) {
          if (this.trustGraph.has(user)) {
            if (!this.trustTags.has(tag)) {
              this.trustTags.set(tag, new Set<string>());
            }
            this.trustTags.get(tag)!.add(user);
          }
        }
      }
    }

    if (data.nicknames) {
      for (const [key, name] of Object.entries(data.nicknames)) {
        this.nicknames.set(key, name);
      }
    }

    if (data.muted) {
      for (const key of data.muted) {
        this.mutedUsers.add(key);
      }
    }

    if (data.bookmarks) {
      for (const postId of data.bookmarks) {
        this.bookmarks.add(postId);
      }
    }
  }
}
