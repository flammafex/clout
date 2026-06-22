/**
 * InvitationRedemptionStore - Filesystem adapter for invitations.json
 *
 * Pure persistence layer: reads and writes the bootstrap invitation ledger.
 * Does NOT own in-memory state or make redemption decisions — that's the
 * InvitationRedemption state machine's job (Phase 3).
 *
 * File format (invitations.json):
 * {
 *   created: string (ISO date),
 *   count: number,
 *   codes: string[],
 *   invitations: Array<{ code: string; signature?: string }>,
 *   inviter: string (public key),
 *   adminUrl?: string,
 *   usedCodes: string[],
 *   redemptions: { [code]: { redeemedBy: string; redeemedAt: number } }
 * }
 *
 * Extracted from CloutWebServer as part of Tier 3 Phase 2 decomposition.
 */

import { existsSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface InvitationFileData {
  created?: string;
  count?: number;
  codes?: string[];
  invitations?: Array<{ code: string; signature?: string }>;
  inviter?: string;
  adminUrl?: string;
  usedCodes?: string[];
  redemptions?: Record<string, { redeemedBy: string; redeemedAt: number }>;
}

export interface Redemption {
  redeemedBy: string;
  redeemedAt: number;
}

export class InvitationRedemptionStore {
  private readonly invitesFile: string;

  constructor() {
    const dataDir = process.env.CLOUT_DATA_DIR || join(homedir(), '.clout');
    this.invitesFile = join(dataDir, 'invitations.json');
  }

  /**
   * Get the file path for logging.
   */
  getFilePath(): string {
    return this.invitesFile;
  }

  /**
   * Check if invitations.json exists.
   */
  exists(): boolean {
    return existsSync(this.invitesFile);
  }

  /**
   * Load and parse invitations.json.
   * Returns null if the file doesn't exist or can't be parsed.
   */
  load(): InvitationFileData | null {
    if (!existsSync(this.invitesFile)) {
      return null;
    }

    try {
      const raw = readFileSync(this.invitesFile, 'utf-8');
      return JSON.parse(raw) as InvitationFileData;
    } catch (error: any) {
      console.error(`[InvitationStore] Error loading invitations.json: ${error.message}`);
      return null;
    }
  }

  /**
   * Write the full bootstrap invitations file (initial creation or re-download).
   */
  saveBootstrapInvitations(data: {
    invitations: Array<{ code: string; signature?: string }>;
    inviter: string;
    adminUrl?: string;
  }): void {
    const fileData: InvitationFileData = {
      created: new Date().toISOString(),
      count: data.invitations.length,
      codes: data.invitations.map(i => i.code),
      invitations: data.invitations.map(i => ({
        code: i.code,
        signature: i.signature || ''
      })),
      inviter: data.inviter,
      usedCodes: [],
      redemptions: {}
    };

    if (data.adminUrl) {
      fileData.adminUrl = data.adminUrl;
    }

    writeFileSync(this.invitesFile, JSON.stringify(fileData, null, 2));
  }

  /**
   * Append a used invitation code and redeemer info to invitations.json.
   * Preserves existing data and adds to usedCodes array + redemptions map.
   */
  appendUsedCode(code: string, redeemerPublicKey?: string): void {
    try {
      if (!existsSync(this.invitesFile)) {
        console.warn(`[InvitationStore] invitations.json not found, cannot persist used code`);
        return;
      }

      const data = JSON.parse(readFileSync(this.invitesFile, 'utf-8'));

      // Legacy array format for backwards compatibility
      const usedCodes = data.usedCodes || [];
      if (!usedCodes.includes(code)) {
        usedCodes.push(code);
        data.usedCodes = usedCodes;
      }

      // New object format mapping code -> redeemer info
      const redemptions = data.redemptions || {};
      if (!redemptions[code] && redeemerPublicKey) {
        redemptions[code] = {
          redeemedBy: redeemerPublicKey,
          redeemedAt: Date.now()
        };
        data.redemptions = redemptions;
      }

      writeFileSync(this.invitesFile, JSON.stringify(data, null, 2));
      console.log(`[InvitationStore] Persisted used invitation code ${code.slice(0, 8)}... to invitations.json`);
    } catch (error: any) {
      console.error(`[InvitationStore] Error saving used invitation code: ${error.message}`);
    }
  }

  /**
   * Get the redeemer public key for a bootstrap invitation code.
   */
  getRedemption(code: string): Redemption | null {
    const data = this.load();
    if (!data?.redemptions) return null;
    return data.redemptions[code] || null;
  }

  /**
   * Find which bootstrap invitation code a public key used to redeem.
   */
  findByRedeemer(redeemerPublicKey: string): { code: string; redeemedAt: number } | null {
    const data = this.load();
    if (!data?.redemptions) return null;

    for (const [code, info] of Object.entries(data.redemptions)) {
      if (info.redeemedBy === redeemerPublicKey) {
        return { code, redeemedAt: info.redeemedAt };
      }
    }
    return null;
  }
}
