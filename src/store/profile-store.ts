import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

/**
 * Get Clout data directory from environment or default
 */
function getCloutDataDir(): string {
  return process.env.CLOUT_DATA_DIR || join(homedir(), '.clout');
}

/**
 * Profile metadata that gets persisted locally
 */
export interface LocalProfileData {
  version: string;
  publicKey: string;
  metadata: {
    displayName?: string;
    bio?: string;
    avatar?: string;
    avatarCached?: string; // Local path to cached avatar image
  };
  trustSettings: {
    maxTrustDistance?: number;
    showNsfw?: boolean;
    nsfwMinReputation?: number;
  };
  lastUpdated: number;
}

/**
 * ProfileStore - Local persistence for profile data
 *
 * Stores profile metadata (display name, bio, avatar) locally so it
 * survives restarts. Works alongside Chronicle CRDT for network sync.
 */
export class ProfileStore {
  private path: string;
  private avatarCachePath: string;
  private data: LocalProfileData | null = null;

  constructor(customPath?: string) {
    const dataDir = getCloutDataDir();
    this.path = customPath || join(dataDir, 'local-profile.json');
    this.avatarCachePath = join(dataDir, 'avatar-cache');
  }

  /**
   * Initialize the store - creates directories and loads existing data
   */
  async init(): Promise<void> {
    this.ensureDir();
    this.load();
  }

  private ensureDir(): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    if (!existsSync(this.avatarCachePath)) {
      mkdirSync(this.avatarCachePath, { recursive: true });
    }
  }

  private load(): void {
    if (!existsSync(this.path)) {
      return;
    }
    try {
      const raw = readFileSync(this.path, 'utf-8');
      this.data = JSON.parse(raw);
      console.log(`[ProfileStore] 📂 Loaded profile from ${this.path}`);
    } catch (e) {
      console.warn('[ProfileStore] Failed to load profile, starting fresh');
      this.data = null;
    }
  }

  private save(): void {
    if (this.data) {
      this.data.lastUpdated = Date.now();
      writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf-8');
      console.log(`[ProfileStore] 💾 Saved profile to ${this.path}`);
    }
  }

  /**
   * Get the stored profile data (returns null if none exists)
   */
  getProfile(): LocalProfileData | null {
    return this.data;
  }

  /**
   * Save profile data
   */
  saveProfile(publicKey: string, metadata: {
    displayName?: string;
    bio?: string;
    avatar?: string;
  }, trustSettings?: {
    maxTrustDistance?: number;
    showNsfw?: boolean;
    nsfwMinReputation?: number;
  }): void {
    this.data = {
      version: '1.0',
      publicKey,
      metadata: {
        ...this.data?.metadata,
        ...metadata
      },
      trustSettings: {
        ...this.data?.trustSettings,
        ...trustSettings
      },
      lastUpdated: Date.now()
    };
    this.save();
  }

  /**
   * Update just the metadata portion
   */
  updateMetadata(metadata: {
    displayName?: string;
    bio?: string;
    avatar?: string;
  }): void {
    if (this.data) {
      this.data.metadata = {
        ...this.data.metadata,
        ...metadata
      };
      this.save();
    }
  }

  /**
   * Update just the trust settings portion
   */
  updateTrustSettings(trustSettings: {
    maxTrustDistance?: number;
    showNsfw?: boolean;
    nsfwMinReputation?: number;
  }): void {
    if (this.data) {
      this.data.trustSettings = {
        ...this.data.trustSettings,
        ...trustSettings
      };
      this.save();
    }
  }

  /**
   * Cache an avatar image locally (for URL avatars)
   * Returns the local path to the cached image
   */
  async cacheAvatar(url: string): Promise<string | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`[ProfileStore] Failed to fetch avatar: ${response.status}`);
        return null;
      }

      const contentType = response.headers.get('content-type') || 'image/png';
      const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? '.jpg'
                : contentType.includes('gif') ? '.gif'
                : contentType.includes('webp') ? '.webp'
                : '.png';

      const filename = `avatar-${Date.now()}${ext}`;
      const localPath = join(this.avatarCachePath, filename);

      const buffer = Buffer.from(await response.arrayBuffer());
      writeFileSync(localPath, buffer);

      // Update the cached path in profile data
      if (this.data) {
        this.data.metadata.avatarCached = localPath;
        this.save();
      }

      console.log(`[ProfileStore] 🖼️ Cached avatar to ${localPath}`);
      return localPath;
    } catch (error) {
      console.warn(`[ProfileStore] Failed to cache avatar: ${error}`);
      return null;
    }
  }

  /**
   * Get the path to the cached avatar (if it exists)
   */
  getCachedAvatarPath(): string | null {
    if (this.data?.metadata?.avatarCached && existsSync(this.data.metadata.avatarCached)) {
      return this.data.metadata.avatarCached;
    }
    return null;
  }

  /**
   * Check if we have a stored profile
   */
  hasProfile(): boolean {
    return this.data !== null;
  }

  /**
   * Clear the stored profile
   */
  clear(): void {
    this.data = null;
    if (existsSync(this.path)) {
      writeFileSync(this.path, '{}', 'utf-8');
    }
  }
}
