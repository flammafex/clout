/**
 * Backup Module - Data export and import
 *
 * Handles:
 * - Exporting user data for backup
 * - Importing backup data
 */

import type { CloutStateManager } from '../chronicle/clout-state.js';
import type { CloutLocalData } from './local-data.js';
import type { TrustSignal, CloutProfile } from '../clout-types.js';

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
    backup: BackupData,
    options?: { replaceLocalData?: boolean }
  ): Promise<{ trustSignalsImported: number; localDataImported: boolean }> {
    let trustSignalsImported = 0;

    // Import trust signals
    if (backup.profile?.trustSignals?.length > 0) {
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
    if (backup.profile?.settings) {
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

    // Import local data
    let localDataImported = false;
    if (backup.localData) {
      this.localData.import(backup.localData);
      localDataImported = true;
      console.log(`[Clout] 📥 Imported local data (tags, nicknames, muted)`);
    }

    return { trustSignalsImported, localDataImported };
  }
}
