/**
 * Backup Module - Data export and import
 *
 * Handles:
 * - Exporting user data for backup
 * - Importing backup data
 * - Backwards compatibility with legacy formats
 */

import type { CloutStateManager } from '../chronicle/clout-state.js';
import type { CloutLocalData } from './local-data.js';
import type { TrustSignal, PostPackage, CloutProfile } from '../clout-types.js';

export interface BackupConfig {
  publicKey: string;
  state: CloutStateManager;
  localData: CloutLocalData;
  trustGraph: Set<string>;
  getProfile: () => CloutProfile;
}

export interface BackupData {
  version: string;
  exportedAt: number;
  identity: { publicKey: string };
  profile: {
    trustSignals: TrustSignal[];
    settings: any;
  };
  localData: {
    tags: Record<string, string[]>;
    nicknames: Record<string, string>;
    muted: string[];
  };
}

export class CloutBackup {
  private readonly publicKeyHex: string;
  private readonly state: CloutStateManager;
  private readonly localData: CloutLocalData;
  private readonly trustGraph: Set<string>;
  private readonly getProfile: () => CloutProfile;

  constructor(config: BackupConfig) {
    this.publicKeyHex = config.publicKey;
    this.state = config.state;
    this.localData = config.localData;
    this.trustGraph = config.trustGraph;
    this.getProfile = config.getProfile;
  }

  /**
   * Export all user data for backup
   */
  async exportBackup(): Promise<BackupData> {
    const state = this.state.getState();
    const exportedLocalData = this.localData.export();

    return {
      version: '1.0',
      exportedAt: Date.now(),
      identity: {
        publicKey: this.publicKeyHex
      },
      profile: {
        trustSignals: state.myTrustSignals || [],
        settings: state.profile ? {
          metadata: state.profile.metadata,
          trustSettings: state.profile.trustSettings,
          trustGraph: Array.from(state.profile.trustGraph || [])
        } : null
      },
      localData: exportedLocalData
    };
  }

  /**
   * Import user data from backup
   */
  async importBackup(
    backup: {
      version: string;
      profile?: {
        trustSignals?: TrustSignal[];
        settings?: any;
      };
      chronicleState?: {
        posts?: PostPackage[];
        trustSignals?: TrustSignal[];
        profile?: any;
      };
      localData?: {
        tags?: Record<string, string[]>;
        nicknames?: Record<string, string>;
        muted?: string[];
      };
    },
    options?: { replaceLocalData?: boolean }
  ): Promise<{ postsImported: number; trustSignalsImported: number; localDataImported: boolean }> {
    const replaceLocalData = options?.replaceLocalData ?? false;

    let postsImported = 0;
    let trustSignalsImported = 0;

    // Handle new format (profile)
    if (backup.profile) {
      // Import trust signals
      if (backup.profile.trustSignals && backup.profile.trustSignals.length > 0) {
        for (const signal of backup.profile.trustSignals) {
          try {
            this.state.addTrustSignal(signal);
            this.trustGraph.add(signal.trustee);
            trustSignalsImported++;
          } catch (e) {
            console.warn(`[Clout] Skipped trust signal`);
          }
        }
        console.log(`[Clout] 📥 Imported ${trustSignalsImported} trust signals`);
      }

      // Import profile settings
      if (backup.profile.settings) {
        const currentProfile = this.getProfile();
        this.state.updateProfile({
          ...currentProfile,
          trustSettings: {
            ...currentProfile.trustSettings,
            ...backup.profile.settings.trustSettings
          },
          metadata: {
            ...currentProfile.metadata,
            ...backup.profile.settings.metadata
          }
        });
        console.log(`[Clout] 📥 Imported profile settings`);
      }
    }

    // Handle legacy format (chronicleState) for backwards compatibility
    if (backup.chronicleState) {
      // Import trust signals from legacy format
      if (backup.chronicleState.trustSignals && backup.chronicleState.trustSignals.length > 0) {
        for (const signal of backup.chronicleState.trustSignals) {
          try {
            this.state.addTrustSignal(signal);
            this.trustGraph.add(signal.trustee);
            trustSignalsImported++;
          } catch (e) {
            console.warn(`[Clout] Skipped trust signal`);
          }
        }
        console.log(`[Clout] 📥 Imported ${trustSignalsImported} trust signals (legacy format)`);
      }

      // Import profile settings from legacy format
      if (backup.chronicleState.profile && backup.chronicleState.profile.publicKey === this.publicKeyHex) {
        const currentProfile = this.getProfile();
        this.state.updateProfile({
          ...currentProfile,
          trustSettings: {
            ...currentProfile.trustSettings,
            ...backup.chronicleState.profile.trustSettings
          },
          metadata: {
            ...currentProfile.metadata,
            ...backup.chronicleState.profile.metadata
          }
        });
        console.log(`[Clout] 📥 Imported profile settings (legacy format)`);
      }

      // Note: Posts from legacy backups are ignored (posts now live on server)
      if (backup.chronicleState.posts && backup.chronicleState.posts.length > 0) {
        console.log(`[Clout] ℹ️ Skipped ${backup.chronicleState.posts.length} posts (posts are now stored on server)`);
      }
    }

    // Import local data
    let localDataImported = false;
    if (backup.localData) {
      if (replaceLocalData) {
        // Note: We'd need clear methods, but for now just import (which adds)
      }
      this.localData.import(backup.localData);
      localDataImported = true;
      console.log(`[Clout] 📥 Imported local data (tags, nicknames, muted)`);
    }

    return { postsImported, trustSignalsImported, localDataImported };
  }
}
