/**
 * Identity management for CLI
 *
 * Handles secure storage of keys and identity operations
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { Crypto } from '../crypto.js';
import type { PublicKey } from '../types.js';

/**
 * Get Clout data directory from environment or default
 */
function getCloutDataDir(): string {
  return process.env.CLOUT_DATA_DIR || join(homedir(), '.clout');
}

export interface IdentityData {
  name: string;
  publicKey: string;
  secretKey: string;
  created: number;
}

export interface IdentityStore {
  version: string;
  identities: { [name: string]: IdentityData };
  defaultIdentity?: string;
}

export class IdentityManager {
  private identityPath: string;
  private store: IdentityStore;

  constructor(customPath?: string) {
    this.identityPath = customPath || join(getCloutDataDir(), 'identities.json');
    this.ensureIdentityDir();
    this.store = this.loadStore();
  }

  /**
   * Ensure identity directory exists
   */
  private ensureIdentityDir(): void {
    const dir = dirname(this.identityPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Load identity store from disk
   */
  private loadStore(): IdentityStore {
    if (!existsSync(this.identityPath)) {
      return {
        version: '1.0',
        identities: {}
      };
    }

    try {
      const data = readFileSync(this.identityPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.warn('Failed to load identity store, creating new one');
      return {
        version: '1.0',
        identities: {}
      };
    }
  }

  /**
   * Save identity store to disk
   */
  private saveStore(): void {
    const data = JSON.stringify(this.store, null, 2);
    writeFileSync(this.identityPath, data, 'utf-8');
  }

  /**
   * Create a new identity
   */
  createIdentity(name: string, setDefault = true): IdentityData {
    if (this.store.identities[name]) {
      throw new Error(`Identity '${name}' already exists`);
    }

    const secret = Crypto.randomBytes(32);
    const publicKey = Crypto.hash(secret, 'PUBLIC_KEY');

    const identity: IdentityData = {
      name,
      publicKey: Crypto.toHex(publicKey),
      secretKey: Crypto.toHex(secret),
      created: Date.now()
    };

    this.store.identities[name] = identity;

    if (setDefault || !this.store.defaultIdentity) {
      this.store.defaultIdentity = name;
    }

    this.saveStore();
    return identity;
  }

  /**
   * Import an identity from secret key
   */
  importIdentity(name: string, secretKeyHex: string, setDefault = false): IdentityData {
    if (this.store.identities[name]) {
      throw new Error(`Identity '${name}' already exists`);
    }

    const secret = Crypto.fromHex(secretKeyHex);
    const publicKey = Crypto.hash(secret, 'PUBLIC_KEY');

    const identity: IdentityData = {
      name,
      publicKey: Crypto.toHex(publicKey),
      secretKey: secretKeyHex,
      created: Date.now()
    };

    this.store.identities[name] = identity;

    if (setDefault || !this.store.defaultIdentity) {
      this.store.defaultIdentity = name;
    }

    this.saveStore();
    return identity;
  }

  /**
   * Get an identity by name
   */
  getIdentity(name?: string): IdentityData {
    const identityName = name || this.store.defaultIdentity;

    if (!identityName) {
      throw new Error('No identity specified and no default identity set');
    }

    const identity = this.store.identities[identityName];
    if (!identity) {
      throw new Error(`Identity '${identityName}' not found`);
    }

    return identity;
  }

  /**
   * List all identities
   */
  listIdentities(): IdentityData[] {
    return Object.values(this.store.identities);
  }

  /**
   * Delete an identity
   */
  deleteIdentity(name: string): void {
    if (!this.store.identities[name]) {
      throw new Error(`Identity '${name}' not found`);
    }

    delete this.store.identities[name];

    if (this.store.defaultIdentity === name) {
      const remaining = Object.keys(this.store.identities);
      this.store.defaultIdentity = remaining.length > 0 ? remaining[0] : undefined;
    }

    this.saveStore();
  }

  /**
   * Set default identity
   */
  setDefault(name: string): void {
    if (!this.store.identities[name]) {
      throw new Error(`Identity '${name}' not found`);
    }

    this.store.defaultIdentity = name;
    this.saveStore();
  }

  /**
   * Export identity secret (for backup)
   */
  exportSecret(name?: string): string {
    const identity = this.getIdentity(name);
    return identity.secretKey;
  }

  /**
   * Get public key for an identity
   */
  getPublicKey(name?: string): PublicKey {
    const identity = this.getIdentity(name);
    return {
      bytes: Crypto.fromHex(identity.publicKey)
    };
  }

  /**
   * Get secret key for an identity
   */
  getSecretKey(name?: string): Uint8Array {
    const identity = this.getIdentity(name);
    return Crypto.fromHex(identity.secretKey);
  }

  /**
   * Get default identity name
   */
  getDefaultIdentityName(): string | undefined {
    return this.store.defaultIdentity;
  }
}
