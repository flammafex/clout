/**
 * CloutLocalData - Local-only data management
 *
 * Handles features that are never synced to the network:
 * - Trust Tags: Organize contacts into groups (friends, work, family)
 * - Nicknames: Personal address book for remembering who's who
 *
 * This data stays on the user's device for privacy.
 */

export class CloutLocalData {
  private readonly trustTags: Map<string, Set<string>>; // tag -> Set<publicKey>
  private readonly nicknames: Map<string, string>; // publicKey -> nickname
  private readonly trustGraph: Set<string>; // Reference to validate tag operations

  constructor(trustGraph: Set<string>) {
    this.trustGraph = trustGraph;
    this.trustTags = new Map<string, Set<string>>();
    this.nicknames = new Map<string, string>();
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
  //  PERSISTENCE (Future)
  // =================================================================

  /**
   * Export all local data for backup
   */
  export(): { tags: Record<string, string[]>; nicknames: Record<string, string> } {
    const tags: Record<string, string[]> = {};
    for (const [tag, users] of this.trustTags.entries()) {
      tags[tag] = Array.from(users);
    }

    const nicknames: Record<string, string> = {};
    for (const [key, name] of this.nicknames.entries()) {
      nicknames[key] = name;
    }

    return { tags, nicknames };
  }

  /**
   * Import local data from backup
   */
  import(data: { tags?: Record<string, string[]>; nicknames?: Record<string, string> }): void {
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
  }
}
