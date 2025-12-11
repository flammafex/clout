/**
 * GossipMessageSigner - Handles signing and verification of gossip messages
 *
 * Provides:
 * - Ed25519 signing for outgoing messages
 * - Signature verification for incoming messages
 * - Replay protection via nonce and expiry
 */

import { Crypto } from '../crypto.js';
import type { ContentGossipMessage, SignedContentGossipMessage } from '../clout-types.js';

export interface MessageSignerConfig {
  /**
   * Signing key for gossip message authentication
   */
  readonly signingKey?: {
    readonly publicKey: Uint8Array;
    readonly privateKey: Uint8Array;
  };

  /**
   * Whether to require signatures on incoming messages (default: false)
   */
  readonly requireSignatures?: boolean;

  /**
   * How long signed messages are valid (default: 300000 = 5 minutes)
   */
  readonly messageExpiryMs?: number;

  /**
   * How long to keep seen message IDs for deduplication (default: 600000 = 10 minutes)
   */
  readonly seenMessagesTtlMs?: number;
}

/**
 * Seen message record for replay protection
 */
interface SeenMessageRecord {
  /** When this message was first seen */
  firstSeen: number;
  /** Message expiry (for cleanup) */
  expiresAt: number;
}

export class GossipMessageSigner {
  private readonly signingKey?: {
    readonly publicKey: Uint8Array;
    readonly privateKey: Uint8Array;
  };
  private readonly requireSignatures: boolean;
  private readonly messageExpiryMs: number;
  private readonly seenMessagesTtlMs: number;
  private readonly seenMessages = new Map<string, SeenMessageRecord>();

  constructor(config: MessageSignerConfig) {
    this.signingKey = config.signingKey;
    this.requireSignatures = config.requireSignatures ?? false;
    this.messageExpiryMs = config.messageExpiryMs ?? 300_000; // 5 minutes
    this.seenMessagesTtlMs = config.seenMessagesTtlMs ?? 600_000; // 10 minutes
  }

  /**
   * Sign a gossip message for authentication
   *
   * Includes nonce and expiry for replay protection:
   * - Nonce: Random 32 bytes to ensure message uniqueness
   * - Expiry: Timestamp after which message should be rejected
   *
   * @param message - The message to sign
   * @returns Signed message wrapper, or original message if no signing key
   */
  sign(message: ContentGossipMessage): ContentGossipMessage | SignedContentGossipMessage {
    if (!this.signingKey) {
      return message;
    }

    // Generate nonce and expiry for replay protection
    const nonce = Crypto.toHex(Crypto.randomBytes(32));
    const expiresAt = Date.now() + this.messageExpiryMs;

    // Serialize message + nonce + expiry to bytes for signing
    const signPayload = JSON.stringify({ message, nonce, expiresAt });
    const messageBytes = new TextEncoder().encode(signPayload);

    // Sign with Ed25519
    const signature = Crypto.sign(messageBytes, this.signingKey.privateKey);

    const signedMessage: SignedContentGossipMessage = {
      message,
      senderPublicKey: Crypto.toHex(this.signingKey.publicKey),
      signature: Crypto.toHex(signature),
      nonce,
      expiresAt
    };

    return signedMessage;
  }

  /**
   * Verify a signed gossip message
   *
   * Performs the following checks:
   * 1. Signature verification (Ed25519)
   * 2. Expiry check (message not too old)
   * 3. Replay detection (nonce not seen before)
   *
   * @param data - The incoming message (may be signed or unsigned)
   * @returns The unwrapped message if valid, or null if invalid
   */
  verify(data: ContentGossipMessage | SignedContentGossipMessage): ContentGossipMessage | null {
    // Check if this is a signed message
    if ('message' in data && 'senderPublicKey' in data && 'signature' in data) {
      const signedData = data as SignedContentGossipMessage;
      const now = Date.now();

      try {
        // REPLAY PROTECTION CHECK 1: Expiry
        if (signedData.expiresAt && signedData.expiresAt < now) {
          console.warn(
            `[MessageSigner] ⚠️ Rejecting expired message from ${signedData.senderPublicKey.slice(0, 8)} ` +
            `(expired ${Math.round((now - signedData.expiresAt) / 1000)}s ago)`
          );
          return null;
        }

        // REPLAY PROTECTION CHECK 2: Nonce deduplication
        if (signedData.nonce) {
          const messageId = `${signedData.senderPublicKey}:${signedData.nonce}`;
          if (this.seenMessages.has(messageId)) {
            console.warn(
              `[MessageSigner] ⚠️ Rejecting replayed message from ${signedData.senderPublicKey.slice(0, 8)} ` +
              `(nonce: ${signedData.nonce.slice(0, 8)}...)`
            );
            return null;
          }

          // Track this message to prevent future replays
          this.seenMessages.set(messageId, {
            firstSeen: now,
            expiresAt: signedData.expiresAt ?? (now + this.seenMessagesTtlMs)
          });
        }

        // Deserialize public key and signature
        const publicKey = Crypto.fromHex(signedData.senderPublicKey);
        const signature = Crypto.fromHex(signedData.signature);

        // Serialize the inner message + nonce + expiry for verification (must match signing)
        const signPayload = signedData.nonce
          ? JSON.stringify({ message: signedData.message, nonce: signedData.nonce, expiresAt: signedData.expiresAt })
          : JSON.stringify(signedData.message); // Backward compatibility
        const messageBytes = new TextEncoder().encode(signPayload);

        // Verify signature
        if (!Crypto.verify(messageBytes, signature, publicKey)) {
          console.warn(`[MessageSigner] ⚠️ Invalid signature from ${signedData.senderPublicKey.slice(0, 8)}`);
          return null;
        }

        console.log(`[MessageSigner] ✓ Verified signature from ${signedData.senderPublicKey.slice(0, 8)}`);
        return signedData.message;
      } catch (error) {
        console.warn('[MessageSigner] Failed to verify message signature:', error);
        return null;
      }
    }

    // Unsigned message
    if (this.requireSignatures) {
      console.warn('[MessageSigner] ⚠️ Rejecting unsigned message (requireSignatures=true)');
      return null;
    }

    // Accept unsigned message (backward compatibility)
    return data as ContentGossipMessage;
  }

  /**
   * Cleanup expired seen messages (replay protection)
   * @returns Number of expired messages cleaned up
   */
  cleanupExpiredMessages(): number {
    const now = Date.now();
    let expiredMessages = 0;

    for (const [messageId, record] of this.seenMessages.entries()) {
      if (record.expiresAt < now) {
        this.seenMessages.delete(messageId);
        expiredMessages++;
      }
    }

    if (expiredMessages > 0) {
      console.log(`[MessageSigner] Cleaned up ${expiredMessages} expired message IDs`);
    }

    return expiredMessages;
  }

  /**
   * Get the number of tracked seen messages
   */
  get seenMessageCount(): number {
    return this.seenMessages.size;
  }
}
