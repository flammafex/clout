/**
 * Submit Routes - Pre-signed endpoints for browser-side identity
 *
 * These endpoints accept payloads that have been signed by the browser
 * using the user's private key stored in IndexedDB. The server verifies
 * signatures using the public key and then broadcasts to the gossip network.
 *
 * This enables multi-user web deployment where the server never has access
 * to users' private keys.
 */

import { Router } from 'express';
import type { Clout } from '../../clout.js';
import { Crypto } from '../../crypto.js';

/**
 * Validate a hex-encoded public key
 */
function validatePublicKey(publicKey: unknown, fieldName = 'publicKey'): string {
  if (!publicKey || typeof publicKey !== 'string') {
    throw new Error(`${fieldName} is required`);
  }

  if (!Crypto.isValidPublicKeyHex(publicKey)) {
    throw new Error(`Invalid ${fieldName}: must be 64 hex characters (32 bytes)`);
  }

  return publicKey;
}

/**
 * Validate and convert a hex signature to Uint8Array
 */
function validateSignature(signature: unknown, fieldName = 'signature'): Uint8Array {
  if (!signature || typeof signature !== 'string') {
    throw new Error(`${fieldName} is required`);
  }

  // Ed25519 signature is 64 bytes = 128 hex chars
  if (signature.length !== 128 || !/^[0-9a-fA-F]+$/.test(signature)) {
    throw new Error(`Invalid ${fieldName}: must be 128 hex characters (64 bytes)`);
  }

  return Crypto.fromHex(signature);
}

export interface SubmitRoutesConfig {
  getClout: () => Clout | undefined;
  isInitialized: () => boolean;
  /** Store for per-user data (tickets, profiles) */
  getUserTicket?: (publicKey: string) => Promise<any>;
  setUserTicket?: (publicKey: string, ticket: any) => Promise<void>;
}

export function createSubmitRoutes(config: SubmitRoutesConfig): Router {
  const { getClout, isInitialized, getUserTicket, setUserTicket } = config;
  const router = Router();

  /**
   * Submit a pre-signed post
   *
   * The browser signs the post content with the user's private key,
   * and sends the signature along with the content. The server verifies
   * the signature and broadcasts the post to the gossip network.
   */
  router.post('/post/submit', async (req, res) => {
    try {
      if (!isInitialized()) {
        throw new Error('Server not initialized');
      }

      const clout = getClout()!;
      const {
        content,
        author,
        signature,
        timestamp,
        replyTo,
        mediaCid,
        nsfw,
        contentWarning,
        ephemeralPublicKey,
        ephemeralKeyProof
      } = req.body;

      // Validate required fields
      if (!content || typeof content !== 'string') {
        throw new Error('content is required');
      }
      if (content.length > 500) {
        throw new Error('content exceeds 500 character limit');
      }

      const authorKey = validatePublicKey(author, 'author');
      const signatureBytes = validateSignature(signature);

      // Verify the content signature
      const contentBytes = new TextEncoder().encode(content);
      const authorKeyBytes = Crypto.fromHex(authorKey);

      if (!Crypto.verify(contentBytes, signatureBytes, authorKeyBytes)) {
        return res.status(401).json({
          success: false,
          error: 'Invalid signature - content was not signed by the claimed author'
        });
      }

      // Verify ephemeral key proof if provided (for forward secrecy)
      if (ephemeralPublicKey && ephemeralKeyProof) {
        const ephPubBytes = Crypto.fromHex(ephemeralPublicKey);
        const ephProofBytes = Crypto.fromHex(ephemeralKeyProof);

        if (!Crypto.verifyEphemeralKeyProof(ephPubBytes, ephProofBytes, authorKey)) {
          return res.status(401).json({
            success: false,
            error: 'Invalid ephemeral key proof'
          });
        }
      }

      // Check for valid Day Pass for this user
      // In browser-identity mode, we need to look up the ticket by author public key
      let ticket = null;
      if (getUserTicket) {
        ticket = await getUserTicket(authorKey);
      }

      if (!ticket || ticket.expiry < Date.now()) {
        return res.status(403).json({
          success: false,
          error: 'No valid Day Pass. Please obtain a Freebird token first.',
          code: 'NO_DAYPASS'
        });
      }

      // Create post ID from content hash
      const id = Crypto.hashString(content + authorKey + (timestamp || Date.now()));

      // Build post package for gossip
      const postPackage = {
        id,
        content,
        author: authorKey,
        signature: signatureBytes,
        ephemeralPublicKey: ephemeralPublicKey ? Crypto.fromHex(ephemeralPublicKey) : undefined,
        ephemeralKeyProof: ephemeralKeyProof ? Crypto.fromHex(ephemeralKeyProof) : undefined,
        replyTo,
        nsfw,
        contentWarning,
        media: mediaCid ? { cid: mediaCid } : undefined,
        // Include Day Pass as authorship proof
        authorshipProof: ticket.proof
      };

      // Get witness proof and broadcast via gossip
      // The clout instance handles this as a relay
      const proof = await clout.relayPost(postPackage);

      res.json({
        success: true,
        data: {
          id,
          author: authorKey,
          timestamp: proof.timestamp,
          ticketExpiry: ticket.expiry
        }
      });
    } catch (error: any) {
      console.error('[Submit] Post error:', error.message);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  /**
   * Submit a pre-signed trust signal
   *
   * The browser creates an encrypted trust signal using the user's private key,
   * and sends the components to the server. The server verifies the signature
   * and broadcasts to the gossip network.
   */
  router.post('/trust/submit', async (req, res) => {
    try {
      if (!isInitialized()) {
        throw new Error('Server not initialized');
      }

      const clout = getClout()!;
      const {
        truster,
        trusteeCommitment,
        encryptedTrustee,
        signature,
        weight,
        timestamp
      } = req.body;

      // Validate required fields
      const trusterKey = validatePublicKey(truster, 'truster');

      if (!trusteeCommitment || typeof trusteeCommitment !== 'string') {
        throw new Error('trusteeCommitment is required');
      }

      if (!encryptedTrustee || !encryptedTrustee.ephemeralPublicKey || !encryptedTrustee.ciphertext) {
        throw new Error('encryptedTrustee with ephemeralPublicKey and ciphertext is required');
      }

      const signatureBytes = validateSignature(signature);

      const signalWeight = typeof weight === 'number'
        ? Math.max(0.1, Math.min(1.0, weight))
        : 1.0;

      const signalTimestamp = timestamp || Date.now();

      // Verify the trust signal signature
      const isValidSig = Crypto.verifyEncryptedTrustSignature(
        trusteeCommitment,
        trusterKey,
        signatureBytes,
        signalWeight,
        signalTimestamp
      );

      if (!isValidSig) {
        return res.status(401).json({
          success: false,
          error: 'Invalid trust signal signature'
        });
      }

      // Build encrypted trust signal for gossip
      const encryptedTrustSignal = {
        truster: trusterKey,
        trusteeCommitment,
        encryptedTrustee: {
          ephemeralPublicKey: Crypto.fromHex(encryptedTrustee.ephemeralPublicKey),
          ciphertext: Crypto.fromHex(encryptedTrustee.ciphertext)
        },
        signature: signatureBytes,
        weight: signalWeight,
        version: 'encrypted-v1' as const
      };

      // Get witness proof and broadcast via gossip
      const proof = await clout.relayTrustSignal(encryptedTrustSignal);

      res.json({
        success: true,
        data: {
          truster: trusterKey,
          trusteeCommitment,
          weight: signalWeight,
          timestamp: proof.timestamp
        }
      });
    } catch (error: any) {
      console.error('[Submit] Trust signal error:', error.message);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  /**
   * Register a new user's public key with the server
   *
   * Called after browser generates identity, before redeeming invite.
   * This allows the server to track which public keys are associated
   * with which invitation codes.
   */
  router.post('/identity/register', async (req, res) => {
    try {
      const { publicKey } = req.body;
      const validatedKey = validatePublicKey(publicKey);

      // For now, just acknowledge the registration
      // In the future, this could store user metadata, check for banned keys, etc.

      res.json({
        success: true,
        data: {
          publicKey: validatedKey,
          registered: true
        }
      });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  /**
   * Request a Day Pass for a user
   *
   * The user provides their Freebird token (obtained via the blinding flow)
   * and the server mints a Day Pass ticket for them.
   */
  router.post('/daypass/mint', async (req, res) => {
    try {
      if (!isInitialized()) {
        throw new Error('Server not initialized');
      }

      const clout = getClout()!;
      const { publicKey, token } = req.body;

      const userKey = validatePublicKey(publicKey);

      if (!token || typeof token !== 'string') {
        throw new Error('token is required (base64 encoded Freebird token)');
      }

      // Decode the token from base64
      const tokenBytes = Uint8Array.from(atob(token), c => c.charCodeAt(0));

      // Verify the token with Freebird
      const isValid = await clout.verifyFreebirdToken(tokenBytes);
      if (!isValid) {
        return res.status(401).json({
          success: false,
          error: 'Invalid Freebird token'
        });
      }

      // Mint Day Pass for this user
      // New users get 24-hour passes
      const now = Date.now();
      const expiry = now + (24 * 60 * 60 * 1000); // 24 hours

      const ticket = {
        owner: userKey,
        expiry,
        durationHours: 24,
        ticketType: 'browser-identity' as const,
        freebirdProof: tokenBytes,
        created: now
      };

      // Get witness attestation
      const ticketHash = Crypto.hashObject({
        owner: userKey,
        expiry,
        created: now
      });
      const proof = await clout.getWitnessProof(ticketHash);
      const ticketWithProof = { ...ticket, proof };

      // Store the ticket for this user
      if (setUserTicket) {
        await setUserTicket(userKey, ticketWithProof);
      }

      res.json({
        success: true,
        data: {
          publicKey: userKey,
          expiry,
          durationHours: 24,
          timestamp: proof.timestamp
        }
      });
    } catch (error: any) {
      console.error('[Submit] Day Pass mint error:', error.message);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  /**
   * Get current Day Pass status for a user
   */
  router.get('/daypass/status/:publicKey', async (req, res) => {
    try {
      const userKey = validatePublicKey(req.params.publicKey);

      let ticket = null;
      if (getUserTicket) {
        ticket = await getUserTicket(userKey);
      }

      if (!ticket) {
        return res.json({
          success: true,
          data: {
            publicKey: userKey,
            hasTicket: false
          }
        });
      }

      const now = Date.now();
      const isExpired = ticket.expiry < now;
      const remainingMs = Math.max(0, ticket.expiry - now);

      res.json({
        success: true,
        data: {
          publicKey: userKey,
          hasTicket: true,
          isExpired,
          expiry: ticket.expiry,
          remainingMs,
          remainingHours: Math.floor(remainingMs / (1000 * 60 * 60))
        }
      });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  return router;
}
