/**
 * Cryptographic primitives for Scarcity protocol
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, concatBytes } from '@noble/hashes/utils';
import { randomBytes } from 'crypto';
import { x25519 } from '@noble/curves/ed25519';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { managedNonce } from '@noble/ciphers/webcrypto';

export class Crypto {
  /**
   * Generate cryptographically secure random bytes
   */
  static randomBytes(length: number): Uint8Array {
    return randomBytes(length);
  }
  /**
   * Hash arbitrary data with SHA-256
   */
  static hash(...inputs: (Uint8Array | string | number)[]): Uint8Array {
    const combined = inputs.map(input => {
      if (typeof input === 'string') {
        return new TextEncoder().encode(input);
      } else if (typeof input === 'number') {
        const buf = new ArrayBuffer(8);
        const view = new DataView(buf);
        view.setBigUint64(0, BigInt(input), false);
        return new Uint8Array(buf);
      }
      return input;
    });

    return sha256(concatBytes(...combined));
  }
  /**
   * Convert bytes to hex string
   */
  static toHex(bytes: Uint8Array): string {
    return bytesToHex(bytes);
  }
  /**
   * Convert hex string to bytes
   */
  static fromHex(hex: string): Uint8Array {
    return hexToBytes(hex);
  }
  /**
   * Generate nullifier from secret, token ID, and timestamp
   * Nullifier = H(secret || tokenId || timestamp)
   */
  static generateNullifier(
    secret: Uint8Array,
    tokenId: string
  ): Uint8Array {
    return this.hash(secret, tokenId);
  }
  /**
   * Constant-time comparison of byte arrays
   */
  static constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a[i] ^ b[i];
    }

    return result === 0;
  }
  /**
   * Generate a commitment to recipient public key
   * In production this would use Freebird's blinding
   */
  static async createCommitment(publicKey: Uint8Array): Promise<Uint8Array> {
    const nonce = this.randomBytes(32);
    return this.hash(publicKey, nonce);
  }
  /**
   * Hash transfer package for Witness timestamping
   */
  static hashTransferPackage(pkg: {
    tokenId: string;
    amount: number;
    commitment: Uint8Array;
    nullifier: Uint8Array;
  }): string {
    const hash = this.hash(
      pkg.tokenId,
      pkg.amount,
      pkg.commitment,
      pkg.nullifier
    );
    return this.toHex(hash);
  }

  /**
   * Hash a string and return hex string
   */
  static hashString(input: string): string {
    const hash = this.hash(input);
    return this.toHex(hash);
  }

  /**
   * Solve a proof-of-work challenge by finding a nonce
   * such that Hash(challenge + nonce) has `difficulty` leading zero bits
   *
   * @param challenge - The challenge string
   * @param difficulty - Number of leading zero bits required (default: 16 = ~65k attempts)
   * @returns The nonce that solves the puzzle
   */
  static solveProofOfWork(challenge: string, difficulty: number = 16): number {
    let nonce = 0;
    const targetPrefix = '0'.repeat(Math.floor(difficulty / 4)); // Hex digits
    const targetBits = difficulty % 4;

    while (true) {
      const hash = this.hashString(challenge + nonce);

      // Check if hash meets difficulty requirement
      if (hash.startsWith(targetPrefix)) {
        // For partial hex digit, check the bits
        if (targetBits === 0) {
          return nonce;
        }

        const nextChar = hash[targetPrefix.length];
        const nextValue = parseInt(nextChar, 16);
        const mask = (1 << (4 - targetBits)) - 1;

        if ((nextValue & ~mask) === 0) {
          return nonce;
        }
      }

      nonce++;

      // Safety check to prevent infinite loops (should never happen)
      if (nonce > 10_000_000) {
        throw new Error('Proof-of-work failed: exceeded max attempts');
      }
    }
  }

  /**
   * Verify a proof-of-work solution
   *
   * @param challenge - The challenge string
   * @param nonce - The nonce to verify
   * @param difficulty - Number of leading zero bits required
   * @returns true if the nonce is a valid solution
   */
  static verifyProofOfWork(challenge: string, nonce: number, difficulty: number = 16): boolean {
    const hash = this.hashString(challenge + nonce);
    const targetPrefix = '0'.repeat(Math.floor(difficulty / 4));
    const targetBits = difficulty % 4;

    if (!hash.startsWith(targetPrefix)) {
      return false;
    }

    if (targetBits === 0) {
      return true;
    }

    const nextChar = hash[targetPrefix.length];
    const nextValue = parseInt(nextChar, 16);
    const mask = (1 << (4 - targetBits)) - 1;

    return (nextValue & ~mask) === 0;
  }

  /**
   * Encrypt a message for a recipient using their public key
   * Uses X25519 key exchange + XChaCha20-Poly1305 AEAD
   *
   * @param message - The plaintext message to encrypt
   * @param recipientPublicKey - Recipient's 32-byte public key
   * @returns Object with ephemeral public key and ciphertext
   */
  static encrypt(message: string, recipientPublicKey: Uint8Array): {
    ephemeralPublicKey: Uint8Array;
    ciphertext: Uint8Array;
  } {
    // Generate ephemeral keypair for this message
    const ephemeralSecret = this.randomBytes(32);
    const ephemeralPublic = x25519.getPublicKey(ephemeralSecret);

    // Perform ECDH to get shared secret
    const sharedSecret = x25519.getSharedSecret(ephemeralSecret, recipientPublicKey);

    // Derive encryption key from shared secret
    const encryptionKey = this.hash(sharedSecret, 'ENCRYPTION_KEY').slice(0, 32);

    // Encrypt message with XChaCha20-Poly1305
    const plaintext = new TextEncoder().encode(message);
    const cipher = managedNonce(xchacha20poly1305)(encryptionKey);
    const ciphertext = cipher.encrypt(plaintext);

    return {
      ephemeralPublicKey: ephemeralPublic,
      ciphertext
    };
  }

  /**
   * Decrypt a message using our secret key
   *
   * @param ephemeralPublicKey - Sender's ephemeral public key
   * @param ciphertext - The encrypted message
   * @param secretKey - Our 32-byte secret key
   * @returns The decrypted plaintext message
   */
  static decrypt(
    ephemeralPublicKey: Uint8Array,
    ciphertext: Uint8Array,
    secretKey: Uint8Array
  ): string {
    // Perform ECDH to get same shared secret
    const sharedSecret = x25519.getSharedSecret(secretKey, ephemeralPublicKey);

    // Derive same encryption key
    const encryptionKey = this.hash(sharedSecret, 'ENCRYPTION_KEY').slice(0, 32);

    // Decrypt message
    const cipher = managedNonce(xchacha20poly1305)(encryptionKey);
    const plaintext = cipher.decrypt(ciphertext);

    return new TextDecoder().decode(plaintext);
  }
}
