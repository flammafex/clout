/**
 * OwnerRegistry - Instance owner public key management
 *
 * The owner is a BROWSER USER's public key (not the server identity).
 * The first user to redeem a bootstrap invitation becomes the owner.
 * Once set, the owner cannot be changed.
 *
 * Owner is loaded from (in priority order):
 * 1. INSTANCE_OWNER_PUBLIC_KEY env var (64-char hex)
 * 2. {CLOUT_DATA_DIR}/owner.json (persisted from first redemption)
 *
 * Extracted from CloutWebServer as part of Tier 3 Phase 1 decomposition.
 */

import { existsSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export class OwnerRegistry {
  private ownerPublicKey?: string;

  /**
   * Load the instance owner public key from environment or file.
   * The owner is a BROWSER USER's public key, not the server identity.
   */
  load(): void {
    // First check environment variable
    const envOwner = process.env.INSTANCE_OWNER_PUBLIC_KEY;
    if (envOwner && envOwner.length === 64 && /^[a-fA-F0-9]+$/.test(envOwner)) {
      this.ownerPublicKey = envOwner;
      console.log(`[Owner] Loaded from INSTANCE_OWNER_PUBLIC_KEY: ${envOwner.slice(0, 16)}...`);
      return;
    }

    // Then check persisted file
    try {
      const dataDir = process.env.CLOUT_DATA_DIR || join(homedir(), '.clout');
      const ownerFile = join(dataDir, 'owner.json');

      if (existsSync(ownerFile)) {
        const data = JSON.parse(readFileSync(ownerFile, 'utf-8'));
        if (data.publicKey && data.publicKey.length === 64) {
          this.ownerPublicKey = data.publicKey;
          console.log(`[Owner] Loaded from owner.json: ${data.publicKey.slice(0, 16)}...`);
          console.log(`[Owner] Set at: ${new Date(data.setAt).toISOString()}`);
          return;
        }
      }
    } catch (error: any) {
      console.warn(`[Owner] Error loading owner.json: ${error.message}`);
    }

    // No owner set yet
    this.ownerPublicKey = undefined;
  }

  /**
   * Get the current owner public key (or undefined if not set).
   */
  get(): string | undefined {
    return this.ownerPublicKey;
  }

  /**
   * Set the instance owner public key (persists to file).
   * Called when the first bootstrap invitation is redeemed.
   * Once set, the owner cannot be overwritten.
   *
   * @returns true if the owner was set, false if an owner was already set.
   */
  setIfAbsent(publicKey: string): boolean {
    if (this.ownerPublicKey) {
      console.log(`[Owner] Owner already set to ${this.ownerPublicKey.slice(0, 16)}..., ignoring new owner ${publicKey.slice(0, 16)}...`);
      return false;
    }

    this.ownerPublicKey = publicKey;

    try {
      const dataDir = process.env.CLOUT_DATA_DIR || join(homedir(), '.clout');
      const ownerFile = join(dataDir, 'owner.json');

      writeFileSync(ownerFile, JSON.stringify({
        publicKey,
        setAt: Date.now(),
        source: 'first_bootstrap_redeemer'
      }, null, 2));

      console.log(`[Owner] ✅ Set instance owner: ${publicKey.slice(0, 16)}...`);
      console.log(`[Owner] Saved to: ${ownerFile}`);
    } catch (error: any) {
      console.error(`[Owner] Error saving owner.json: ${error.message}`);
    }

    return true;
  }
}
