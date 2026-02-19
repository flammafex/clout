/**
 * Browser-side cryptographic primitives for Clout
 *
 * Mirrors the server's Crypto API using @noble/* libraries
 * which work identically in browser and Node.js environments.
 */

import { sha256 } from '@noble/hashes/sha256';
import { hkdf } from '@noble/hashes/hkdf';
import { bytesToHex, hexToBytes, concatBytes } from '@noble/hashes/utils';
import { x25519, ed25519, edwardsToMontgomeryPub, edwardsToMontgomeryPriv } from '@noble/curves/ed25519';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { managedNonce } from '@noble/ciphers/webcrypto';

/**
 * Domain separation constants for HKDF key derivation
 */
const KDF_SALT_EPHEMERAL = new TextEncoder().encode('CLOUT_EPHEMERAL_KEY_V1');
const KDF_SALT_ENCRYPTION = new TextEncoder().encode('CLOUT_ENCRYPTION_KEY_V1');

/**
 * Browser-compatible Crypto class
 * API matches server's src/crypto.ts
 */
export class Crypto {
  /**
   * Generate cryptographically secure random bytes
   */
  static randomBytes(length) {
    return crypto.getRandomValues(new Uint8Array(length));
  }

  /**
   * Hash arbitrary data with SHA-256
   */
  static hash(...inputs) {
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
  static toHex(bytes) {
    return bytesToHex(bytes);
  }

  /**
   * Convert hex string to bytes
   */
  static fromHex(hex) {
    return hexToBytes(hex);
  }

  /**
   * Validate a hex-encoded public key
   */
  static isValidPublicKeyHex(publicKeyHex) {
    if (typeof publicKeyHex !== 'string') {
      return false;
    }
    if (publicKeyHex.length !== 64) {
      return false;
    }
    return /^[0-9a-fA-F]{64}$/.test(publicKeyHex);
  }

  /**
   * Validate a public key as Uint8Array
   */
  static isValidPublicKeyBytes(publicKey) {
    if (!(publicKey instanceof Uint8Array)) {
      return false;
    }
    return publicKey.length === 32;
  }

  /**
   * Validate and parse a hex-encoded public key
   */
  static parsePublicKey(publicKeyHex) {
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
   * Hash a string and return hex string
   */
  static hashString(input) {
    const hash = this.hash(input);
    return this.toHex(hash);
  }

  /**
   * Deterministic JSON stringify with sorted keys
   */
  static stableStringify(obj) {
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

    const sortedKeys = Object.keys(obj).sort();
    const pairs = sortedKeys.map(key => {
      const value = obj[key];
      return JSON.stringify(key) + ':' + this.stableStringify(value);
    });

    return '{' + pairs.join(',') + '}';
  }

  /**
   * Hash an object deterministically
   */
  static hashObject(obj) {
    return this.hashString(this.stableStringify(obj));
  }

  /**
   * Derive a key using HKDF
   */
  static deriveKey(ikm, salt, info, length = 32) {
    const infoBytes = typeof info === 'string'
      ? new TextEncoder().encode(info)
      : info;
    return hkdf(sha256, ikm, salt, infoBytes, length);
  }

  /**
   * Encrypt a message for a recipient using their public key
   * Uses X25519 key exchange + XChaCha20-Poly1305 AEAD
   */
  static encrypt(message, recipientPublicKey) {
    const ephemeralSecret = this.randomBytes(32);
    const ephemeralPublic = x25519.getPublicKey(ephemeralSecret);

    const sharedSecret = x25519.getSharedSecret(ephemeralSecret, recipientPublicKey);

    const info = concatBytes(ephemeralPublic, recipientPublicKey);
    const encryptionKey = this.deriveKey(sharedSecret, KDF_SALT_ENCRYPTION, info, 32);

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
   */
  static decrypt(ephemeralPublicKey, ciphertext, secretKey, ourPublicKey) {
    const sharedSecret = x25519.getSharedSecret(secretKey, ephemeralPublicKey);

    const recipientPublic = ourPublicKey ?? x25519.getPublicKey(secretKey);
    const info = concatBytes(ephemeralPublicKey, recipientPublic);
    const encryptionKey = this.deriveKey(sharedSecret, KDF_SALT_ENCRYPTION, info, 32);

    const cipher = managedNonce(xchacha20poly1305)(encryptionKey);
    const plaintext = cipher.decrypt(ciphertext);

    return new TextDecoder().decode(plaintext);
  }

  /**
   * Derive an ephemeral keypair from master key for a specific time window
   */
  static deriveEphemeralKey(masterKey, rotationPeriodMs = 24 * 60 * 60 * 1000, timestamp = Date.now()) {
    const epoch = Math.floor(timestamp / rotationPeriodMs);

    const infoBuffer = new ArrayBuffer(16);
    const infoView = new DataView(infoBuffer);
    infoView.setBigUint64(0, BigInt(epoch), false);
    infoView.setBigUint64(8, BigInt(rotationPeriodMs), false);
    const info = new Uint8Array(infoBuffer);

    const ephemeralSecret = this.deriveKey(masterKey, KDF_SALT_EPHEMERAL, info, 32);
    const ephemeralPublic = x25519.getPublicKey(ephemeralSecret);

    return { ephemeralSecret, ephemeralPublic };
  }

  /**
   * Create a proof linking an ephemeral key to a master key
   */
  static createEphemeralKeyProof(ephemeralPublicKey, masterPrivateKey) {
    const domainSeparator = new TextEncoder().encode('CLOUT_EPHEMERAL_KEY_PROOF_V1:');
    const message = concatBytes(domainSeparator, ephemeralPublicKey);
    return ed25519.sign(message, masterPrivateKey);
  }

  /**
   * Verify that an ephemeral key proof is valid
   */
  static verifyEphemeralKeyProof(ephemeralPublicKey, proof, masterPublicKey) {
    try {
      if (proof.length !== 64) {
        return false;
      }

      const masterPubBytes = typeof masterPublicKey === 'string'
        ? this.fromHex(masterPublicKey)
        : masterPublicKey;

      const domainSeparator = new TextEncoder().encode('CLOUT_EPHEMERAL_KEY_PROOF_V1:');
      const message = concatBytes(domainSeparator, ephemeralPublicKey);

      return ed25519.verify(proof, message, masterPubBytes);
    } catch {
      return false;
    }
  }

  /**
   * Sign a message using Ed25519
   */
  static sign(message, privateKey) {
    return ed25519.sign(message, privateKey);
  }

  /**
   * Verify an Ed25519 signature
   */
  static verify(message, signature, publicKey) {
    try {
      return ed25519.verify(signature, message, publicKey);
    } catch {
      return false;
    }
  }

  /**
   * Get Ed25519 public key from private key
   */
  static getPublicKey(privateKey) {
    return ed25519.getPublicKey(privateKey);
  }

  /**
   * Get X25519 public key from private key (for encryption)
   */
  static getX25519PublicKey(privateKey) {
    return x25519.getPublicKey(privateKey);
  }

  /**
   * Convert Ed25519 public key to X25519 public key
   */
  static ed25519ToX25519(ed25519PublicKey) {
    const pubBytes = typeof ed25519PublicKey === 'string'
      ? this.fromHex(ed25519PublicKey)
      : ed25519PublicKey;
    return edwardsToMontgomeryPub(pubBytes);
  }

  /**
   * Convert Ed25519 private key (seed) to X25519 private key (scalar)
   */
  static ed25519PrivToX25519(ed25519PrivateKey) {
    return edwardsToMontgomeryPriv(ed25519PrivateKey);
  }

  // =================================================================
  //  ENCRYPTED TRUST SIGNAL HELPERS
  // =================================================================

  /**
   * Create an encrypted trust signal
   */
  static createEncryptedTrustSignal(trusterPrivateKey, trusterPublicKey, trusteePublicKey, weight, timestamp) {
    // 1. Generate random nonce for commitment
    const nonce = this.toHex(this.randomBytes(32));

    // 2. Create commitment: H(trustee || nonce)
    const commitmentInput = trusteePublicKey + nonce;
    const trusteeCommitment = this.hashString(commitmentInput);

    // 3. Encrypt trustee data for the trustee
    const trusteeData = JSON.stringify({ trustee: trusteePublicKey, nonce });
    const trusteeX25519Key = this.ed25519ToX25519(trusteePublicKey);
    const encrypted = this.encrypt(trusteeData, trusteeX25519Key);

    // 4. Sign the commitment + metadata
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
   */
  static decryptTrustSignal(encryptedTrustee, trusteeCommitment, trusterPublicKey, signature, weight, timestamp, recipientPrivateKey, recipientPublicKey) {
    try {
      // 1. Decrypt the trustee data
      const x25519PrivKey = this.ed25519PrivToX25519(recipientPrivateKey);
      const x25519PubKey = recipientPublicKey
        ? this.ed25519ToX25519(recipientPublicKey)
        : x25519.getPublicKey(x25519PrivKey);
      const decrypted = this.decrypt(
        encryptedTrustee.ephemeralPublicKey,
        encryptedTrustee.ciphertext,
        x25519PrivKey,
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
      return null;
    }
  }

  /**
   * Verify an encrypted trust signal's signature (as a third party)
   */
  static verifyEncryptedTrustSignature(trusteeCommitment, trusterPublicKey, signature, weight, timestamp) {
    try {
      const canonicalWeight = weight.toFixed(2);
      const signatureInput = `CLOUT_TRUST_SIGNAL_V1:${trusteeCommitment}:${canonicalWeight}:${timestamp}`;
      const signatureBytes = new TextEncoder().encode(signatureInput);
      const trusterPubBytes = this.fromHex(trusterPublicKey);

      return this.verify(signatureBytes, signature, trusterPubBytes);
    } catch {
      return false;
    }
  }

  // =================================================================
  //  POST SIGNING HELPERS
  // =================================================================

  /**
   * Build canonical payload for post signature binding
   */
  static buildPostSignaturePayload(post) {
    return {
      content: post.content,
      author: post.author,
      timestamp: post.timestamp,
      replyTo: post.replyTo ?? null,
      mediaCid: post.mediaCid ?? null,
      link: post.link ?? null,
      nsfw: post.nsfw === true,
      contentWarning: post.contentWarning ?? null
    };
  }

  /**
   * Sign a post for submission to the server
   *
   * @param content - Post content
   * @param authorPrivateKey - Author's Ed25519 private key
   * @param options - Optional: replyTo, media metadata, etc.
   * @returns Signed post data ready for submission
   */
  static signPost(content, authorPrivateKey, options = {}) {
    const authorPublicKey = this.getPublicKey(authorPrivateKey);
    const authorPublicKeyHex = this.toHex(authorPublicKey);
    const timestamp = Date.now();

    // Create content hash as post ID
    const id = this.hashString(content);

    const unsignedPost = {
      id,
      content,
      author: authorPublicKeyHex,
      timestamp,
      replyTo: options.replyTo,
      mediaCid: options.mediaCid,
      link: options.link,
      nsfw: options.nsfw,
      contentWarning: options.contentWarning
    };
    const signaturePayload = this.buildPostSignaturePayload(unsignedPost);
    const signatureMessage = `CLOUT_POST_V2:${this.hashObject(signaturePayload)}`;
    const signatureBytes = new TextEncoder().encode(signatureMessage);
    const signature = this.sign(signatureBytes, authorPrivateKey);

    // Derive ephemeral key for forward secrecy
    const { ephemeralSecret, ephemeralPublic } = this.deriveEphemeralKey(authorPrivateKey);
    const ephemeralKeyProof = this.createEphemeralKeyProof(ephemeralPublic, authorPrivateKey);

    return {
      id,
      content,
      author: authorPublicKeyHex,
      signature: this.toHex(signature),
      ephemeralPublicKey: this.toHex(ephemeralPublic),
      ephemeralKeyProof: this.toHex(ephemeralKeyProof),
      timestamp,
      ...options
    };
  }

  /**
   * Verify a post's signature
   */
  static verifyPostSignature(content, signature, authorPublicKey, options = {}) {
    try {
      if (typeof options.timestamp !== 'number') {
        return false;
      }
      const signaturePayload = this.buildPostSignaturePayload({
        content,
        author: typeof authorPublicKey === 'string' ? authorPublicKey : this.toHex(authorPublicKey),
        timestamp: options.timestamp,
        replyTo: options.replyTo,
        mediaCid: options.mediaCid,
        link: options.link,
        nsfw: options.nsfw,
        contentWarning: options.contentWarning
      });
      const signatureMessage = `CLOUT_POST_V2:${this.hashObject(signaturePayload)}`;
      const contentBytes = new TextEncoder().encode(signatureMessage);
      const sigBytes = typeof signature === 'string' ? this.fromHex(signature) : signature;
      const pubBytes = typeof authorPublicKey === 'string' ? this.fromHex(authorPublicKey) : authorPublicKey;
      return this.verify(contentBytes, sigBytes, pubBytes);
    } catch {
      return false;
    }
  }
}

// Export for use as ES module
export default Crypto;
