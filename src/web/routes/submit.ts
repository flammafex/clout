/**
 * Submit Routes - Pre-signed endpoints for browser-side identity
 *
 * These endpoints accept payloads that have been signed by the browser
 * using the user's private key stored in IndexedDB. The server verifies
 * signatures using the public key and then broadcasts to the gossip network.
 *
 * This enables multi-user web deployment where the server never has access
 * to users' private keys or their social graph (Dark Social Graph).
 *
 * The server only stores:
 * - Day Pass tickets (needed to verify posting rights)
 * - Posts (public content - the Chronicle)
 * - Media files (public attachments)
 *
 * The server does NOT store:
 * - Who trusts whom (stored in browser)
 * - Nicknames, tags, muted users (stored in browser)
 * - Any social graph information
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
  /** Get Day Pass ticket for a user (needed for posting) */
  getUserTicket?: (publicKey: string) => Promise<any>;
  /** Store Day Pass ticket for a user */
  setUserTicket?: (publicKey: string, ticket: any) => Promise<void>;
}

// In-memory storage for browser-encrypted slides
// In production, this should be persisted to disk
interface EncryptedSlide {
  id: string;
  sender: string;
  recipient: string;
  ephemeralPublicKey: string;
  ciphertext: string;
  signature: string;
  timestamp: number;
}

const slideStore: Map<string, EncryptedSlide[]> = new Map();

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
   *
   * IMPORTANT: This is an encrypted trust signal. The server cannot see WHO
   * is being trusted - only the commitment and encrypted data. This is the
   * foundation of the Dark Social Graph.
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
      // The server only sees the commitment, not who is being trusted
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
   *
   * Note: This does NOT store any social graph information.
   */
  router.post('/identity/register', async (req, res) => {
    try {
      const { publicKey } = req.body;
      const validatedKey = validatePublicKey(publicKey);

      // Just acknowledge the registration
      // We don't store anything about the user - that's all in their browser

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
   *
   * This is the ONLY per-user data the server stores - the proof that
   * they're allowed to post. It does not reveal any social connections.
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
        throw new Error('token is required (base64/base64url encoded Freebird token)');
      }

      // Decode the token from base64 or base64url
      // Base64url uses -_ instead of +/ and no padding
      const normalizedToken = token.replace(/-/g, '+').replace(/_/g, '/');
      const tokenBytes = Uint8Array.from(atob(normalizedToken), c => c.charCodeAt(0));

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

  /**
   * Submit a browser-encrypted slide (DM)
   *
   * The browser encrypts the message with the recipient's public key
   * using X25519 key exchange, then sends the encrypted data to the server.
   * The server stores it indexed by recipient public key.
   *
   * The server cannot read the message content - only the recipient can decrypt.
   */
  router.post('/slide/submit', async (req, res) => {
    try {
      const {
        sender,
        recipient,
        ephemeralPublicKey,
        ciphertext,
        signature,
        timestamp
      } = req.body;

      // Validate required fields
      const senderKey = validatePublicKey(sender, 'sender');
      const recipientKey = validatePublicKey(recipient, 'recipient');

      if (!ephemeralPublicKey || typeof ephemeralPublicKey !== 'string') {
        throw new Error('ephemeralPublicKey is required');
      }
      if (!ciphertext || typeof ciphertext !== 'string') {
        throw new Error('ciphertext is required');
      }

      const signatureBytes = validateSignature(signature);

      // Verify the slide signature
      const signaturePayload = `slide:${senderKey}:${recipientKey}:${timestamp}`;
      const senderKeyBytes = Crypto.fromHex(senderKey);
      const payloadBytes = new TextEncoder().encode(signaturePayload);

      if (!Crypto.verify(payloadBytes, signatureBytes, senderKeyBytes)) {
        return res.status(401).json({
          success: false,
          error: 'Invalid signature - slide was not signed by the claimed sender'
        });
      }

      // Create slide ID
      const slideId = Crypto.hashString(`${senderKey}:${recipientKey}:${timestamp}`);

      // Create slide record
      const slide: EncryptedSlide = {
        id: slideId,
        sender: senderKey,
        recipient: recipientKey,
        ephemeralPublicKey,
        ciphertext,
        signature,
        timestamp: timestamp || Date.now()
      };

      // Store by recipient public key
      if (!slideStore.has(recipientKey)) {
        slideStore.set(recipientKey, []);
      }
      slideStore.get(recipientKey)!.push(slide);

      // Keep only the last 100 slides per recipient
      const slides = slideStore.get(recipientKey)!;
      if (slides.length > 100) {
        slideStore.set(recipientKey, slides.slice(-100));
      }

      console.log(`[Slides] Stored encrypted slide from ${senderKey.slice(0, 12)}... to ${recipientKey.slice(0, 12)}...`);

      res.json({
        success: true,
        data: {
          id: slideId,
          sender: senderKey,
          recipient: recipientKey,
          timestamp: slide.timestamp
        }
      });
    } catch (error: any) {
      console.error('[Submit] Slide error:', error.message);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  /**
   * Get slides addressed to a specific public key
   *
   * Returns encrypted slides that the recipient can decrypt with their private key.
   */
  router.get('/slides/:publicKey', async (req, res) => {
    try {
      const recipientKey = validatePublicKey(req.params.publicKey);

      const slides = slideStore.get(recipientKey) || [];

      // Return slides sorted by timestamp (newest first)
      const sortedSlides = [...slides].sort((a, b) => b.timestamp - a.timestamp);

      res.json({
        success: true,
        data: {
          slides: sortedSlides,
          count: sortedSlides.length
        }
      });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  /**
   * Submit a browser-signed post retraction
   *
   * The browser signs the retraction request with the author's private key,
   * proving they own the post. The server verifies the signature and removes
   * the post from the feed.
   */
  router.post('/retract/submit', async (req, res) => {
    try {
      if (!isInitialized()) {
        throw new Error('Server not initialized');
      }

      const clout = getClout()!;
      const {
        postId,
        author,
        signature,
        timestamp,
        reason
      } = req.body;

      // Validate required fields
      if (!postId || typeof postId !== 'string') {
        throw new Error('postId is required');
      }

      const authorKey = validatePublicKey(author, 'author');
      const signatureBytes = validateSignature(signature);
      const retractionTimestamp = timestamp || Date.now();
      const retractionReason = reason || 'retracted';

      // Verify the retraction signature
      // The browser signs: "retract:{postId}:{author}:{timestamp}"
      const signaturePayload = `retract:${postId}:${authorKey}:${retractionTimestamp}`;
      const authorKeyBytes = Crypto.fromHex(authorKey);
      const payloadBytes = new TextEncoder().encode(signaturePayload);

      if (!Crypto.verify(payloadBytes, signatureBytes, authorKeyBytes)) {
        return res.status(401).json({
          success: false,
          error: 'Invalid signature - retraction was not signed by the claimed author'
        });
      }

      // Verify the post exists and belongs to this author
      const store = clout.getStore();
      if (!store) {
        throw new Error('Store not available');
      }

      const feed = await store.getFeed();
      const post = feed.find(p => p.id === postId);

      if (!post) {
        return res.status(404).json({
          success: false,
          error: `Post ${postId} not found`
        });
      }

      if (post.author !== authorKey) {
        return res.status(403).json({
          success: false,
          error: 'You are not the author of this post'
        });
      }

      // Get witness proof for the retraction
      const retractionPayload = { postId, deletedAt: retractionTimestamp };
      const payloadHash = Crypto.hashObject(retractionPayload);
      const proof = await clout.getWitnessProof(payloadHash);

      // Create retraction package (PostDeletePackage)
      const retraction = {
        postId,
        author: authorKey,
        signature: signatureBytes,
        proof,
        deletedAt: retractionTimestamp,
        reason: retractionReason as 'retracted' | 'edited' | 'mistake' | 'other'
      };

      // Store the retraction (FileSystemStore has addDeletion method)
      if ('addDeletion' in store) {
        await (store as any).addDeletion(retraction);
      }

      console.log(`[Retract] Post ${postId.slice(0, 12)}... retracted by ${authorKey.slice(0, 12)}...`);

      res.json({
        success: true,
        data: {
          postId,
          author: authorKey,
          reason: retractionReason,
          timestamp: retractionTimestamp
        }
      });
    } catch (error: any) {
      console.error('[Submit] Retraction error:', error.message);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  /**
   * Submit a browser-signed post edit
   *
   * Edit creates a new post with editOf reference to the original,
   * then retracts the original post with reason 'edited'.
   */
  router.post('/edit/submit', async (req, res) => {
    try {
      if (!isInitialized()) {
        throw new Error('Server not initialized');
      }

      const clout = getClout()!;
      const {
        originalPostId,
        content,
        author,
        signature,
        timestamp,
        nsfw,
        contentWarning
      } = req.body;

      // Validate required fields
      if (!originalPostId || typeof originalPostId !== 'string') {
        throw new Error('originalPostId is required');
      }
      if (!content || typeof content !== 'string') {
        throw new Error('content is required');
      }
      if (content.length > 500) {
        throw new Error('content exceeds 500 character limit');
      }

      const authorKey = validatePublicKey(author, 'author');
      const signatureBytes = validateSignature(signature);
      const editTimestamp = timestamp || Date.now();

      // Verify the edit signature
      // The browser signs: "edit:{originalPostId}:{content}:{author}:{timestamp}"
      const signaturePayload = `edit:${originalPostId}:${content}:${authorKey}:${editTimestamp}`;
      const authorKeyBytes = Crypto.fromHex(authorKey);
      const payloadBytes = new TextEncoder().encode(signaturePayload);

      if (!Crypto.verify(payloadBytes, signatureBytes, authorKeyBytes)) {
        return res.status(401).json({
          success: false,
          error: 'Invalid signature - edit was not signed by the claimed author'
        });
      }

      // Verify the original post exists and belongs to this author
      const store = clout.getStore();
      if (!store) {
        throw new Error('Store not available');
      }

      const feed = await store.getFeed();
      const originalPost = feed.find(p => p.id === originalPostId);

      if (!originalPost) {
        return res.status(404).json({
          success: false,
          error: `Original post ${originalPostId} not found`
        });
      }

      if (originalPost.author !== authorKey) {
        return res.status(403).json({
          success: false,
          error: 'You are not the author of this post'
        });
      }

      // Check for valid Day Pass
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

      // Create new post ID
      const newPostId = Crypto.hashString(content + authorKey + editTimestamp);

      // Sign the new content
      const contentBytes = new TextEncoder().encode(content);
      // Note: We use the signature provided by the browser for the edit request
      // The new post's content signature is derived from the edit signature

      // Build new post package
      const newPostPackage = {
        id: newPostId,
        content,
        author: authorKey,
        signature: signatureBytes,
        replyTo: originalPost.replyTo,
        editOf: originalPostId,
        nsfw: nsfw ?? originalPost.nsfw,
        contentWarning: contentWarning ?? originalPost.contentWarning,
        authorshipProof: ticket.proof
      };

      // Get witness proof and store the new post
      const proof = await clout.relayPost(newPostPackage);

      // Now retract the original post with reason 'edited'
      const retractionPayload = { postId: originalPostId, deletedAt: editTimestamp };
      const retractionHash = Crypto.hashObject(retractionPayload);
      const retractionProof = await clout.getWitnessProof(retractionHash);

      // Create retraction for original post
      const retraction = {
        postId: originalPostId,
        author: authorKey,
        signature: signatureBytes,
        proof: retractionProof,
        deletedAt: editTimestamp,
        reason: 'edited' as const
      };

      if ('addDeletion' in store) {
        await (store as any).addDeletion(retraction);
      }

      console.log(`[Edit] Post ${originalPostId.slice(0, 12)}... edited by ${authorKey.slice(0, 12)}... -> ${newPostId.slice(0, 12)}...`);

      res.json({
        success: true,
        data: {
          id: newPostId,
          originalPostId,
          author: authorKey,
          timestamp: proof.timestamp
        }
      });
    } catch (error: any) {
      console.error('[Submit] Edit error:', error.message);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  return router;
}
