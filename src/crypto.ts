/**
 * Cryptographic primitives for Scarcity protocol
 */

import { sha256 } from '@noble/hashes/sha256';
import { hkdf } from '@noble/hashes/hkdf';
import { bytesToHex, hexToBytes, concatBytes } from '@noble/hashes/utils';
import { randomBytes } from 'crypto';
import { x25519, ed25519, edwardsToMontgomeryPub, edwardsToMontgomeryPriv } from '@noble/curves/ed25519';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { managedNonce } from '@noble/ciphers/webcrypto';

/**
 * Domain separation constants for HKDF key derivation
 * Using unique strings prevents cross-protocol attacks
 */
const KDF_SALT_EPHEMERAL = new TextEncoder().encode('CLOUT_EPHEMERAL_KEY_V1');
const KDF_SALT_ENCRYPTION = new TextEncoder().encode('CLOUT_ENCRYPTION_KEY_V1');

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
   * Validate a hex-encoded public key
   *
   * Checks:
   * - Is a valid hex string (lowercase or uppercase)
   * - Is exactly 64 characters (32 bytes)
   * - Contains only valid hex characters
   *
   * @param publicKeyHex - Hex-encoded public key
   * @returns true if valid, false otherwise
   */
  static isValidPublicKeyHex(publicKeyHex: string): boolean {
    if (typeof publicKeyHex !== 'string') {
      return false;
    }

    // Must be 64 hex characters (32 bytes)
    if (publicKeyHex.length !== 64) {
      return false;
    }

    // Must contain only valid hex characters
    return /^[0-9a-fA-F]{64}$/.test(publicKeyHex);
  }

  /**
   * Validate a public key as Uint8Array
   *
   * @param publicKey - Public key bytes
   * @returns true if valid length, false otherwise
   */
  static isValidPublicKeyBytes(publicKey: Uint8Array): boolean {
    if (!(publicKey instanceof Uint8Array)) {
      return false;
    }

    // Ed25519 and X25519 public keys are 32 bytes
    return publicKey.length === 32;
  }

  /**
   * Validate and parse a hex-encoded public key
   *
   * @param publicKeyHex - Hex-encoded public key
   * @returns Uint8Array if valid
   * @throws Error if invalid
   */
  static parsePublicKey(publicKeyHex: string): Uint8Array {
    if (!this.isValidPublicKeyHex(publicKeyHex)) {
      throw new Error(
        `Invalid public key: expected 64 hex characters, got ${
          typeof publicKeyHex === 'string' ? publicKeyHex.length : typeof publicKeyHex
        }`
      );
    }

    return this.fromHex(publicKeyHex);
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
   * Derive a key using HKDF (HMAC-based Key Derivation Function)
   *
   * HKDF provides proper key derivation with:
   * - Extract phase: Concentrates entropy from input key material
   * - Expand phase: Produces cryptographically strong output keys
   * - Domain separation: Salt and info prevent cross-protocol attacks
   *
   * @param ikm - Input key material (the secret to derive from)
   * @param salt - Domain separation salt (use unique value per context)
   * @param info - Context-specific info (e.g., epoch, purpose)
   * @param length - Desired output length in bytes (default: 32)
   * @returns Derived key of specified length
   */
  static deriveKey(
    ikm: Uint8Array,
    salt: Uint8Array,
    info: Uint8Array | string,
    length: number = 32
  ): Uint8Array {
    const infoBytes = typeof info === 'string'
      ? new TextEncoder().encode(info)
      : info;

    return hkdf(sha256, ikm, salt, infoBytes, length);
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
   * Deterministic JSON stringify with sorted keys
   *
   * Standard JSON.stringify() does not guarantee key ordering, which can cause
   * different hashes for semantically identical objects across JavaScript engines.
   * This function recursively sorts object keys to ensure deterministic output.
   *
   * @param obj - Any JSON-serializable value
   * @returns Deterministic JSON string
   */
  static stableStringify(obj: unknown): string {
    if (obj === null || obj === undefined) {
      return JSON.stringify(obj);
    }

    if (typeof obj !== 'object') {
      return JSON.stringify(obj);
    }

    if (Array.isArray(obj)) {
      const items = obj.map(item => this.stableStringify(item));
      return '[' + items.join(',') + ']';
    }

    // Sort keys and recursively stringify values
    const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
    const pairs = sortedKeys.map(key => {
      const value = (obj as Record<string, unknown>)[key];
      return JSON.stringify(key) + ':' + this.stableStringify(value);
    });

    return '{' + pairs.join(',') + '}';
  }

  /**
   * Hash an object deterministically
   *
   * Uses stableStringify to ensure consistent hashing regardless of
   * object key insertion order.
   *
   * @param obj - Any JSON-serializable object
   * @returns Hex-encoded hash
   */
  static hashObject(obj: unknown): string {
    return this.hashString(this.stableStringify(obj));
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
   * Key derivation uses HKDF with:
   * - IKM: ECDH shared secret
   * - Salt: Domain separation constant
   * - Info: Both public keys (prevents key reuse attacks)
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

    // Derive encryption key using HKDF
    // Info includes both public keys to bind the key to this specific exchange
    const info = concatBytes(ephemeralPublic, recipientPublicKey);
    const encryptionKey = this.deriveKey(sharedSecret, KDF_SALT_ENCRYPTION, info, 32);

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
   * Uses same HKDF derivation as encrypt() for key consistency.
   *
   * @param ephemeralPublicKey - Sender's ephemeral public key
   * @param ciphertext - The encrypted message
   * @param secretKey - Our 32-byte secret key
   * @param ourPublicKey - Our public key (needed for HKDF info)
   * @returns The decrypted plaintext message
   */
  static decrypt(
    ephemeralPublicKey: Uint8Array,
    ciphertext: Uint8Array,
    secretKey: Uint8Array,
    ourPublicKey?: Uint8Array
  ): string {
    // Perform ECDH to get same shared secret
    const sharedSecret = x25519.getSharedSecret(secretKey, ephemeralPublicKey);

    // Derive same encryption key using HKDF
    // Note: If ourPublicKey not provided, derive it from secretKey
    const recipientPublic = ourPublicKey ?? x25519.getPublicKey(secretKey);
    const info = concatBytes(ephemeralPublicKey, recipientPublic);
    const encryptionKey = this.deriveKey(sharedSecret, KDF_SALT_ENCRYPTION, info, 32);

    // Decrypt message
    const cipher = managedNonce(xchacha20poly1305)(encryptionKey);
    const plaintext = cipher.decrypt(ciphertext);

    return new TextDecoder().decode(plaintext);
  }

  /**
   * Derive an ephemeral keypair from master key for a specific time window
   *
   * Uses HKDF for proper key derivation with:
   * - IKM: Master secret key
   * - Salt: Domain separation constant (CLOUT_EPHEMERAL_KEY_V1)
   * - Info: Epoch number + rotation period (prevents epoch collision across configs)
   *
   * This enables deterministic key rotation without storing ephemeral keys.
   *
   * @param masterKey - Master secret key (32 bytes)
   * @param rotationPeriodMs - Key rotation period in milliseconds (default: 24 hours)
   * @param timestamp - Current timestamp (default: now)
   * @returns Object with ephemeral secret and public keys
   */
  static deriveEphemeralKey(
    masterKey: Uint8Array,
    rotationPeriodMs: number = 24 * 60 * 60 * 1000, // 24 hours
    timestamp: number = Date.now()
  ): { ephemeralSecret: Uint8Array; ephemeralPublic: Uint8Array } {
    // Calculate key epoch (which rotation period this timestamp falls into)
    const epoch = Math.floor(timestamp / rotationPeriodMs);

    // Create info that includes epoch and rotation period
    // This prevents accidental key reuse if rotation period changes
    const infoBuffer = new ArrayBuffer(16);
    const infoView = new DataView(infoBuffer);
    infoView.setBigUint64(0, BigInt(epoch), false);
    infoView.setBigUint64(8, BigInt(rotationPeriodMs), false);
    const info = new Uint8Array(infoBuffer);

    // Derive ephemeral secret using proper HKDF
    const ephemeralSecret = this.deriveKey(masterKey, KDF_SALT_EPHEMERAL, info, 32);

    // Derive public key from secret
    const ephemeralPublic = x25519.getPublicKey(ephemeralSecret);

    return { ephemeralSecret, ephemeralPublic };
  }

  /**
   * Create a proof linking an ephemeral key to a master key
   *
   * Uses Ed25519 signature over a structured message containing:
   * - Domain separator to prevent cross-protocol attacks
   * - The ephemeral public key being proven
   *
   * @param ephemeralPublicKey - Ephemeral public key to sign
   * @param masterPrivateKey - Master Ed25519 private key for signing
   * @returns 64-byte Ed25519 signature proving ephemeral key ownership
   */
  static createEphemeralKeyProof(
    ephemeralPublicKey: Uint8Array,
    masterPrivateKey: Uint8Array
  ): Uint8Array {
    // Create structured message for signing
    // Domain separator prevents signature reuse in other contexts
    const domainSeparator = new TextEncoder().encode('CLOUT_EPHEMERAL_KEY_PROOF_V1:');
    const message = concatBytes(domainSeparator, ephemeralPublicKey);

    // Sign with Ed25519
    return ed25519.sign(message, masterPrivateKey);
  }

  /**
   * Verify that an ephemeral key proof is valid
   *
   * Verifies that the ephemeral key was signed by the claimed master key.
   *
   * @param ephemeralPublicKey - Ephemeral public key
   * @param proof - 64-byte Ed25519 signature
   * @param masterPublicKey - Master public key (hex string or Uint8Array)
   * @returns true if proof is valid
   */
  static verifyEphemeralKeyProof(
    ephemeralPublicKey: Uint8Array,
    proof: Uint8Array,
    masterPublicKey: string | Uint8Array
  ): boolean {
    try {
      // Verify signature length
      if (proof.length !== 64) {
        return false;
      }

      // Convert master public key if needed
      const masterPubBytes = typeof masterPublicKey === 'string'
        ? this.fromHex(masterPublicKey)
        : masterPublicKey;

      // Reconstruct the signed message
      const domainSeparator = new TextEncoder().encode('CLOUT_EPHEMERAL_KEY_PROOF_V1:');
      const message = concatBytes(domainSeparator, ephemeralPublicKey);

      // Verify Ed25519 signature
      return ed25519.verify(proof, message, masterPubBytes);
    } catch {
      return false;
    }
  }

  /**
   * Sign a message using Ed25519
   *
   * @param message - The message bytes to sign
   * @param privateKey - 32-byte Ed25519 private key
   * @returns 64-byte Ed25519 signature
   */
  static sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
    return ed25519.sign(message, privateKey);
  }

  /**
   * Verify an Ed25519 signature
   *
   * @param message - The original message bytes
   * @param signature - 64-byte Ed25519 signature
   * @param publicKey - 32-byte Ed25519 public key
   * @returns true if signature is valid
   */
  static verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
    try {
      return ed25519.verify(signature, message, publicKey);
    } catch {
      return false;
    }
  }

  /**
   * Get Ed25519 public key from private key
   *
   * @param privateKey - 32-byte Ed25519 private key
   * @returns 32-byte Ed25519 public key
   */
  static getPublicKey(privateKey: Uint8Array): Uint8Array {
    return ed25519.getPublicKey(privateKey);
  }

  /**
   * Get X25519 public key from private key (for encryption)
   *
   * @param privateKey - 32-byte private key
   * @returns 32-byte X25519 public key
   */
  static getX25519PublicKey(privateKey: Uint8Array): Uint8Array {
    return x25519.getPublicKey(privateKey);
  }

  /**
   * Convert Ed25519 public key to X25519 public key
   *
   * Ed25519 (signing) and X25519 (encryption) use different curve representations
   * but are mathematically related. This allows using a single identity key (Ed25519)
   * while deriving the corresponding encryption key (X25519) when needed.
   *
   * IMPORTANT: The resulting X25519 key corresponds to the Ed25519 scalar
   * (sha512(seed)[0:32]), not the raw seed. Use ed25519PrivToX25519 for
   * private key conversion to ensure they match.
   *
   * @param ed25519PublicKey - 32-byte Ed25519 public key (or hex string)
   * @returns 32-byte X25519 public key
   */
  static ed25519ToX25519(ed25519PublicKey: Uint8Array | string): Uint8Array {
    const pubBytes = typeof ed25519PublicKey === 'string'
      ? this.fromHex(ed25519PublicKey)
      : ed25519PublicKey;
    return edwardsToMontgomeryPub(pubBytes);
  }

  /**
   * Convert Ed25519 private key (seed) to X25519 private key (scalar)
   *
   * Ed25519 derives its scalar by hashing the seed: scalar = sha512(seed)[0:32]
   * This function extracts that scalar for use with X25519 operations.
   *
   * Use this alongside ed25519ToX25519 for public keys to ensure the
   * private and public keys correspond to each other.
   *
   * @param ed25519PrivateKey - 32-byte Ed25519 seed
   * @returns 32-byte X25519 scalar (derived from Ed25519 scalar)
   */
  static ed25519PrivToX25519(ed25519PrivateKey: Uint8Array): Uint8Array {
    return edwardsToMontgomeryPriv(ed25519PrivateKey);
  }

  // =================================================================
  //  ENCRYPTED TRUST SIGNAL HELPERS
  // =================================================================

  /**
   * Create an encrypted trust signal
   *
   * Privacy guarantees:
   * - Trustee identity is encrypted and only visible to trustee
   * - Commitment allows duplicate detection without revealing trustee
   * - Truster can be verified via signature
   *
   * @param trusterPrivateKey - Truster's Ed25519 private key for signing
   * @param trusterPublicKey - Truster's public key (hex)
   * @param trusteePublicKey - Trustee's public key (hex) - used for encryption
   * @param weight - Trust weight (0.1-1.0)
   * @param timestamp - Current timestamp
   * @returns Encrypted trust signal components
   */
  static createEncryptedTrustSignal(
    trusterPrivateKey: Uint8Array,
    trusterPublicKey: string,
    trusteePublicKey: string,
    weight: number,
    timestamp: number
  ): {
    trusteeCommitment: string;
    encryptedTrustee: { ephemeralPublicKey: Uint8Array; ciphertext: Uint8Array };
    signature: Uint8Array;
  } {
    // 1. Generate random nonce for commitment
    const nonce = this.toHex(this.randomBytes(32));

    // 2. Create commitment: H(trustee || nonce)
    const commitmentInput = trusteePublicKey + nonce;
    const trusteeCommitment = this.hashString(commitmentInput);

    // 3. Encrypt trustee data for the trustee
    // The trustee needs both their key and the nonce to verify commitment
    // Note: trusteePublicKey is an Ed25519 identity key, but encryption uses X25519
    // We auto-convert to ensure callers can just pass their identity key
    const trusteeData = JSON.stringify({ trustee: trusteePublicKey, nonce });
    const trusteeX25519Key = this.ed25519ToX25519(trusteePublicKey);
    const encrypted = this.encrypt(trusteeData, trusteeX25519Key);

    // 4. Sign the commitment + metadata
    // This binds the signature to this specific trust signal
    // Note: weight.toFixed(2) ensures consistent float representation across
    // signing and verification, preventing precision-related signature failures
    const canonicalWeight = weight.toFixed(2);
    const signatureInput = `CLOUT_TRUST_SIGNAL_V1:${trusteeCommitment}:${canonicalWeight}:${timestamp}`;
    const signatureBytes = new TextEncoder().encode(signatureInput);
    const signature = this.sign(signatureBytes, trusterPrivateKey);

    return {
      trusteeCommitment,
      encryptedTrustee: {
        ephemeralPublicKey: encrypted.ephemeralPublicKey,
        ciphertext: encrypted.ciphertext
      },
      signature
    };
  }

  /**
   * Decrypt and verify an encrypted trust signal (as the trustee)
   *
   * Call this when you receive an encrypted trust signal to:
   * 1. Decrypt the trustee identity
   * 2. Verify the commitment matches
   * 3. Verify the signature is valid
   *
   * @param encryptedTrustee - The encrypted trustee data
   * @param trusteeCommitment - The commitment to verify
   * @param trusterPublicKey - Truster's public key for signature verification (Ed25519)
   * @param signature - The signature to verify
   * @param weight - Trust weight from the signal
   * @param timestamp - Timestamp from the proof
   * @param recipientPrivateKey - Your private key (to decrypt)
   * @param recipientPublicKey - Your Ed25519 public key (optional, will be derived if not provided)
   * @returns Decrypted trustee key if valid, null if invalid
   */
  static decryptTrustSignal(
    encryptedTrustee: { ephemeralPublicKey: Uint8Array; ciphertext: Uint8Array },
    trusteeCommitment: string,
    trusterPublicKey: string,
    signature: Uint8Array,
    weight: number,
    timestamp: number,
    recipientPrivateKey: Uint8Array,
    recipientPublicKey?: Uint8Array
  ): { trustee: string; nonce: string } | null {
    try {
      // 1. Decrypt the trustee data
      // The encryption used Ed25519 public key converted to X25519 via edwardsToMontgomeryPub.
      // We must use the corresponding X25519 private key (Ed25519 scalar) for decryption.
      const x25519PrivKey = this.ed25519PrivToX25519(recipientPrivateKey);
      const x25519PubKey = recipientPublicKey
        ? this.ed25519ToX25519(recipientPublicKey)
        : x25519.getPublicKey(x25519PrivKey);  // Derive from converted private key
      const decrypted = this.decrypt(
        encryptedTrustee.ephemeralPublicKey,
        encryptedTrustee.ciphertext,
        x25519PrivKey,  // Use converted private key
        x25519PubKey
      );

      const { trustee, nonce } = JSON.parse(decrypted);

      // 2. Verify the commitment matches
      const expectedCommitment = this.hashString(trustee + nonce);
      if (expectedCommitment !== trusteeCommitment) {
        console.warn('[Crypto] Trust signal commitment mismatch');
        return null;
      }

      // 3. Verify the signature
      // Note: weight.toFixed(2) ensures consistent float representation
      const canonicalWeight = weight.toFixed(2);
      const signatureInput = `CLOUT_TRUST_SIGNAL_V1:${trusteeCommitment}:${canonicalWeight}:${timestamp}`;
      const signatureBytes = new TextEncoder().encode(signatureInput);
      const trusterPubBytes = this.fromHex(trusterPublicKey);

      if (!this.verify(signatureBytes, signature, trusterPubBytes)) {
        console.warn('[Crypto] Trust signal signature invalid');
        return null;
      }

      return { trustee, nonce };
    } catch (error) {
      // Decryption failed - we're not the intended recipient
      return null;
    }
  }

  /**
   * Verify an encrypted trust signal's signature (as a third party)
   *
   * Third parties can verify the signature is valid from the truster,
   * but cannot determine who the trustee is.
   *
   * @param trusteeCommitment - The commitment
   * @param trusterPublicKey - Truster's public key
   * @param signature - The signature
   * @param weight - Trust weight
   * @param timestamp - Timestamp from proof
   * @returns true if signature is valid
   */
  static verifyEncryptedTrustSignature(
    trusteeCommitment: string,
    trusterPublicKey: string,
    signature: Uint8Array,
    weight: number,
    timestamp: number
  ): boolean {
    try {
      // Note: weight.toFixed(2) ensures consistent float representation
      // to match the canonical form used during signing
      const canonicalWeight = weight.toFixed(2);
      const signatureInput = `CLOUT_TRUST_SIGNAL_V1:${trusteeCommitment}:${canonicalWeight}:${timestamp}`;
      const signatureBytes = new TextEncoder().encode(signatureInput);
      const trusterPubBytes = this.fromHex(trusterPublicKey);

      return this.verify(signatureBytes, signature, trusterPubBytes);
    } catch {
      return false;
    }
  }
}
