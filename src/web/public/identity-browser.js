/**
 * Browser-side identity management for Clout
 *
 * Handles:
 * - Key generation (Ed25519)
 * - Secure storage in IndexedDB
 * - Password-protected export/import for backup
 * - Session management
 */

import { Crypto } from './crypto-browser.js';

const DB_NAME = 'clout-identity';
const DB_VERSION = 1;
const STORE_NAME = 'identity';

/**
 * Open IndexedDB connection
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(new Error('Failed to open IndexedDB'));

    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

/**
 * Browser identity manager
 */
export class BrowserIdentity {
  /**
   * Generate a new identity (Ed25519 keypair)
   *
   * @returns {{ privateKey: Uint8Array, publicKey: Uint8Array, publicKeyHex: string }}
   */
  static generate() {
    const privateKey = Crypto.randomBytes(32);
    const publicKey = Crypto.getPublicKey(privateKey);
    const publicKeyHex = Crypto.toHex(publicKey);

    return {
      privateKey,
      publicKey,
      publicKeyHex,
      created: Date.now()
    };
  }

  /**
   * Store identity in IndexedDB
   *
   * @param {Object} identity - Identity with privateKey, publicKey, publicKeyHex
   */
  static async store(identity) {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      // Store with 'current' as the key for the active identity
      const record = {
        id: 'current',
        privateKey: Array.from(identity.privateKey), // Convert Uint8Array to regular array for storage
        publicKey: Array.from(identity.publicKey),
        publicKeyHex: identity.publicKeyHex,
        created: identity.created || Date.now()
      };

      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to store identity'));

      tx.oncomplete = () => db.close();
    });
  }

  /**
   * Load existing identity from IndexedDB
   *
   * @returns {Object|null} Identity or null if none exists
   */
  static async load() {
    try {
      const db = await openDB();

      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get('current');

        request.onsuccess = () => {
          const record = request.result;
          if (!record) {
            resolve(null);
            return;
          }

          resolve({
            privateKey: new Uint8Array(record.privateKey),
            publicKey: new Uint8Array(record.publicKey),
            publicKeyHex: record.publicKeyHex,
            created: record.created
          });
        };

        request.onerror = () => reject(new Error('Failed to load identity'));

        tx.oncomplete = () => db.close();
      });
    } catch (error) {
      console.error('[BrowserIdentity] Failed to load:', error);
      return null;
    }
  }

  /**
   * Check if an identity exists
   *
   * @returns {boolean}
   */
  static async exists() {
    const identity = await this.load();
    return identity !== null;
  }

  /**
   * Delete the stored identity
   */
  static async clear() {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete('current');

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to clear identity'));

      tx.oncomplete = () => db.close();
    });
  }

  /**
   * Export identity with password protection
   *
   * Uses PBKDF2 for key derivation and AES-GCM for encryption
   *
   * @param {Object} identity - Identity to export
   * @param {string} password - Password for encryption
   * @returns {string} Encrypted JSON string (base64)
   */
  static async export(identity, password) {
    // Derive encryption key from password using PBKDF2
    const salt = Crypto.randomBytes(16);
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    const encryptionKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );

    // Encrypt the private key
    const iv = Crypto.randomBytes(12);
    const plaintext = new TextEncoder().encode(JSON.stringify({
      privateKey: Array.from(identity.privateKey),
      publicKeyHex: identity.publicKeyHex,
      created: identity.created
    }));

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      encryptionKey,
      plaintext
    );

    // Package everything together
    const exportData = {
      version: 1,
      salt: Array.from(salt),
      iv: Array.from(iv),
      ciphertext: Array.from(new Uint8Array(ciphertext))
    };

    return btoa(JSON.stringify(exportData));
  }

  /**
   * Import identity from password-protected backup
   *
   * @param {string} encryptedData - Encrypted JSON string (base64)
   * @param {string} password - Password for decryption
   * @returns {Object} Decrypted identity
   */
  static async import(encryptedData, password) {
    const exportData = JSON.parse(atob(encryptedData));

    if (exportData.version !== 1) {
      throw new Error('Unsupported backup version');
    }

    const salt = new Uint8Array(exportData.salt);
    const iv = new Uint8Array(exportData.iv);
    const ciphertext = new Uint8Array(exportData.ciphertext);

    // Derive decryption key from password
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    const decryptionKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    // Decrypt
    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        decryptionKey,
        ciphertext
      );

      const data = JSON.parse(new TextDecoder().decode(plaintext));

      const privateKey = new Uint8Array(data.privateKey);
      const publicKey = Crypto.getPublicKey(privateKey);

      // Verify the public key matches
      const derivedPublicKeyHex = Crypto.toHex(publicKey);
      if (derivedPublicKeyHex !== data.publicKeyHex) {
        throw new Error('Key verification failed');
      }

      return {
        privateKey,
        publicKey,
        publicKeyHex: data.publicKeyHex,
        created: data.created
      };
    } catch (error) {
      if (error.name === 'OperationError') {
        throw new Error('Incorrect password');
      }
      throw error;
    }
  }

  /**
   * Get or create identity
   *
   * If an identity exists in IndexedDB, load it.
   * Otherwise, return null (caller should generate new one during onboarding).
   *
   * @returns {Object|null}
   */
  static async getOrCreate() {
    const existing = await this.load();
    if (existing) {
      return existing;
    }
    return null;
  }

  /**
   * Trigger download of encrypted backup file
   *
   * @param {Object} identity - Identity to backup
   * @param {string} password - Password for encryption
   */
  static async downloadBackup(identity, password) {
    const encrypted = await this.export(identity, password);

    const blob = new Blob([encrypted], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `clout-identity-${identity.publicKeyHex.slice(0, 8)}.backup`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
  }

  /**
   * Import from file input
   *
   * @param {File} file - Backup file
   * @param {string} password - Password for decryption
   * @returns {Object} Imported identity
   */
  static async importFromFile(file, password) {
    const text = await file.text();
    return this.import(text, password);
  }
}

// Export for use as ES module
export default BrowserIdentity;
