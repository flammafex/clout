/**
 * CloutProfile Module - Profile and settings management
 *
 * Handles:
 * - Profile metadata (displayName, bio, avatar)
 * - Trust settings (maxHops, minReputation, NSFW, etc.)
 * - Content type filters
 */

import { CloutStateManager } from '../chronicle/clout-state.js';
import { ProfileStore } from '../store/profile-store.js';
import type { CloutProfile, TrustSettings, ContentTypeFilter, DEFAULT_TRUST_SETTINGS } from '../clout-types.js';

export interface CloutProfileConfig {
  readonly publicKey: string;
  readonly trustGraph: Set<string>;
  readonly state: CloutStateManager;
  readonly profileStore: ProfileStore;
  readonly defaultTrustSettings: TrustSettings;
}

export class CloutProfileModule {
  private readonly publicKeyHex: string;
  private readonly trustGraph: Set<string>;
  private readonly state: CloutStateManager;
  private readonly profileStore: ProfileStore;
  private readonly defaultTrustSettings: TrustSettings;

  constructor(config: CloutProfileConfig) {
    this.publicKeyHex = config.publicKey;
    this.trustGraph = config.trustGraph;
    this.state = config.state;
    this.profileStore = config.profileStore;
    this.defaultTrustSettings = config.defaultTrustSettings;
  }

  /**
   * Get the current profile
   */
  getProfile(): CloutProfile {
    const state = this.state.getState();
    let profile = state.profile || {
      publicKey: this.publicKeyHex,
      trustGraph: this.trustGraph,
      trustSettings: this.defaultTrustSettings
    };

    if (!profile.publicKey) {
      profile = { ...profile, publicKey: this.publicKeyHex };
    }

    let trustGraph: Set<string>;
    if (!profile.trustGraph || !(profile.trustGraph instanceof Set)) {
      trustGraph = new Set(this.trustGraph);
    } else {
      trustGraph = new Set(profile.trustGraph);
    }
    trustGraph.add(this.publicKeyHex);
    profile = { ...profile, trustGraph };

    if (!profile.trustSettings) {
      profile = { ...profile, trustSettings: this.defaultTrustSettings };
    }

    const savedProfile = this.profileStore.getProfile();
    if (savedProfile && savedProfile.publicKey === this.publicKeyHex) {
      profile = {
        ...profile,
        metadata: { ...profile.metadata, ...savedProfile.metadata },
        trustSettings: { ...profile.trustSettings, ...savedProfile.trustSettings }
      };
    }

    return profile;
  }

  /**
   * Set profile metadata (displayName, bio, avatar)
   */
  async setProfileMetadata(metadata: {
    displayName?: string;
    bio?: string;
    avatar?: string;
  }): Promise<void> {
    console.log(`[CloutProfile] 📝 Updating profile metadata`);

    const currentProfile = this.getProfile();
    const updatedMetadata = { ...currentProfile.metadata, ...metadata };

    this.state.updateProfile({
      publicKey: this.publicKeyHex,
      trustGraph: this.trustGraph,
      trustSettings: currentProfile.trustSettings,
      metadata: updatedMetadata
    });

    this.profileStore.saveProfile(
      this.publicKeyHex,
      updatedMetadata,
      currentProfile.trustSettings
    );

    if (metadata.avatar?.startsWith('http://') || metadata.avatar?.startsWith('https://')) {
      this.profileStore.cacheAvatar(metadata.avatar).catch(err => {
        console.warn('[CloutProfile] Failed to cache avatar:', err);
      });
    }
  }

  /**
   * Update trust settings
   */
  async updateTrustSettings(settings: Partial<TrustSettings>): Promise<void> {
    console.log(`[CloutProfile] ⚙️ Updating trust settings`);

    const currentProfile = this.getProfile();
    const updatedSettings = { ...currentProfile.trustSettings, ...settings };

    this.state.updateProfile({
      publicKey: this.publicKeyHex,
      trustGraph: this.trustGraph,
      trustSettings: updatedSettings,
      metadata: currentProfile.metadata
    });

    if (settings.maxHops !== undefined || settings.minReputation !== undefined) {
      console.log(`[CloutProfile] Updated filter settings: maxHops=${updatedSettings.maxHops}, minReputation=${updatedSettings.minReputation}`);
    }

    if (settings.showNsfw !== undefined) {
      console.log(`[CloutProfile] NSFW content: ${settings.showNsfw ? 'enabled' : 'disabled'}`);
    }

    this.profileStore.saveProfile(
      this.publicKeyHex,
      currentProfile.metadata || {},
      updatedSettings
    );
  }

  /**
   * Set a content type filter
   */
  async setContentTypeFilter(
    contentType: string,
    filter: ContentTypeFilter
  ): Promise<void> {
    console.log(`[CloutProfile] 🔧 Setting filter for content type: ${contentType}`);

    const currentProfile = this.getProfile();
    const currentFilters = currentProfile.trustSettings.contentTypeFilters || {};

    await this.updateTrustSettings({
      contentTypeFilters: { ...currentFilters, [contentType]: filter }
    });
  }

  /**
   * Remove a content type filter
   */
  async removeContentTypeFilter(contentType: string): Promise<void> {
    const currentProfile = this.getProfile();
    const currentFilters = { ...currentProfile.trustSettings.contentTypeFilters };

    if (currentFilters[contentType]) {
      delete currentFilters[contentType];
      await this.updateTrustSettings({ contentTypeFilters: currentFilters });
      console.log(`[CloutProfile] 🔧 Removed filter for content type: ${contentType}`);
    }
  }

  /**
   * Set NSFW content visibility
   */
  async setNsfwEnabled(enabled: boolean): Promise<void> {
    await this.updateTrustSettings({ showNsfw: enabled });
  }

  /**
   * Check if NSFW content is enabled
   */
  isNsfwEnabled(): boolean {
    return this.getProfile().trustSettings.showNsfw ?? false;
  }
}
