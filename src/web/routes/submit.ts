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
import type { Request, Response } from 'express';
import type { Clout } from '../../clout.js';
import { Crypto } from '../../crypto.js';
import { buildPostSignatureMessage } from '../../post-canonical.js';
import { validatePublicKey, validateSignature, getErrorMessage } from './validation.js';

export interface SubmitRoutesConfig {
  getClout: () => Clout | undefined;
  isInitialized: () => boolean;
  /** Get Day Pass ticket for a user (needed for posting) */
  getUserTicket?: (publicKey: string) => Promise<any>;
  /** Store Day Pass ticket for a user */
  setUserTicket?: (publicKey: string, ticket: any) => Promise<void>;
  /** Clear Day Pass ticket for rollback safety */
  clearUserTicket?: (publicKey: string) => Promise<void>;
  /** Check if user is registered with Freebird (can renew Day Pass without invitation) */
  isUserRegistered?: (publicKey: string) => Promise<boolean>;
  /** Mark user as registered with Freebird after successful invitation-backed mint */
  setUserRegistered?: (publicKey: string, registered: boolean) => Promise<void>;
  /** Get instance owner public key (gets 7-day passes) */
  getOwnerPublicKey?: () => string | undefined;
  /** Mark invitation code as consumed after successful Day Pass mint */
  consumeInvitationCode?: (code: string, publicKey: string) => Promise<boolean>;
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
const usedPostSignatures: Map<string, number> = new Map();
const usedMutationSignatures: Map<string, number> = new Map();
const usedMintTokenHashes: Map<string, { publicKey: string; usedAt: number }> = new Map();
const POST_SIGNATURE_WINDOW_MS = 5 * 60 * 1000;
const POST_SIGNATURE_REPLAY_TTL_MS = 10 * 60 * 1000;
const DAYPASS_TOKEN_REPLAY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function cleanupExpiredPostSignatures(now: number): void {
  for (const [sig, expiresAt] of usedPostSignatures.entries()) {
    if (expiresAt <= now) {
      usedPostSignatures.delete(sig);
    }
  }
}

function cleanupExpiredMutationSignatures(now: number): void {
  for (const [sig, expiresAt] of usedMutationSignatures.entries()) {
    if (expiresAt <= now) {
      usedMutationSignatures.delete(sig);
    }
  }
}

function cleanupExpiredMintTokens(now: number): void {
  for (const [tokenHash, record] of usedMintTokenHashes.entries()) {
    if (now - record.usedAt > DAYPASS_TOKEN_REPLAY_TTL_MS) {
      usedMintTokenHashes.delete(tokenHash);
    }
  }
}

export function createSubmitRoutes(config: SubmitRoutesConfig): Router {
  const {
    getClout,
    isInitialized,
    getUserTicket,
    setUserTicket,
    clearUserTicket,
    isUserRegistered,
    setUserRegistered,
    getOwnerPublicKey,
    consumeInvitationCode
  } = config;
  const router = Router();

  /**
   * Submit a pre-signed post
   *
   * The browser signs the post content with the user's private key,
   * and sends the signature along with the content. The server verifies
   * the signature and broadcasts the post to the gossip network.
   */
  router.post('/post/submit', async (req: Request, res: Response) => {
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
        link,
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
      const signatureKey = Crypto.toHex(signatureBytes);

      if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
        throw new Error('timestamp is required and must be a number');
      }

      const now = Date.now();
      if (Math.abs(now - timestamp) > POST_SIGNATURE_WINDOW_MS) {
        return res.status(401).json({
          success: false,
          error: 'Post signature timestamp is outside the allowed window'
        });
      }

      cleanupExpiredPostSignatures(now);
      if (usedPostSignatures.has(signatureKey)) {
        return res.status(409).json({
          success: false,
          error: 'Duplicate signed post submission detected'
        });
      }

      const signatureMessage = buildPostSignatureMessage({
        content,
        author: authorKey,
        timestamp,
        replyTo,
        mediaCid,
        link,
        nsfw,
        contentWarning
      });
      const messageBytes = new TextEncoder().encode(signatureMessage);
      const authorKeyBytes = Crypto.fromHex(authorKey);

      if (!Crypto.verify(messageBytes, signatureBytes, authorKeyBytes)) {
        return res.status(401).json({
          success: false,
          error: 'Invalid signature - post payload was not signed by the claimed author'
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
      const id = Crypto.hashString(content);

      // Validate media/link mutual exclusivity
      if (mediaCid && link) {
        return res.status(400).json({
          success: false,
          error: 'A post cannot have both media and a link preview. Please choose one.'
        });
      }

      // Build post package for gossip
      const postPackage = {
        id,
        content,
        author: authorKey,
        signature: signatureBytes,
        signatureTimestamp: timestamp,
        ephemeralPublicKey: ephemeralPublicKey ? Crypto.fromHex(ephemeralPublicKey) : undefined,
        ephemeralKeyProof: ephemeralKeyProof ? Crypto.fromHex(ephemeralKeyProof) : undefined,
        replyTo,
        nsfw,
        contentWarning,
        media: mediaCid ? { cid: mediaCid } : undefined,
        // OpenGraph link preview (mutually exclusive with media)
        link: link || undefined,
        // Include Day Pass as authorship proof
        authorshipProof: ticket.proof
      };

      // Get witness proof and broadcast via gossip
      // The clout instance handles this as a relay
      const proof = await clout.relayPost(postPackage);
      usedPostSignatures.set(signatureKey, now + POST_SIGNATURE_REPLAY_TTL_MS);

      res.json({
        success: true,
        data: {
          id,
          author: authorKey,
          timestamp: proof.timestamp,
          ticketExpiry: ticket.expiry
        }
      });
    } catch (error) {
      console.error('[Submit] Post error:', getErrorMessage(error));
      res.status(400).json({ success: false, error: getErrorMessage(error) });
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
  router.post('/trust/submit', async (req: Request, res: Response) => {
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
    } catch (error) {
      console.error('[Submit] Trust signal error:', getErrorMessage(error));
      res.status(400).json({ success: false, error: getErrorMessage(error) });
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
  router.post('/identity/register', async (req: Request, res: Response) => {
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
    } catch (error) {
      res.status(400).json({ success: false, error: getErrorMessage(error) });
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
  router.post('/daypass/mint', async (req: Request, res: Response) => {
    try {
      if (!isInitialized()) {
        throw new Error('Server not initialized');
      }

      const clout = getClout()!;
      const { publicKey, token, invitationCode } = req.body;

      const userKey = validatePublicKey(publicKey);
      const now = Date.now();
      const ownerKey = getOwnerPublicKey?.();
      const isOwner = !!ownerKey && userKey.toLowerCase() === ownerKey.toLowerCase();
      const registered = isUserRegistered ? await isUserRegistered(userKey) : false;
      const requiresInvitation = !registered && !isOwner;
      let invitationToConsume: string | undefined;

      if (!token || typeof token !== 'string') {
        throw new Error('token is required (base64/base64url encoded Freebird token)');
      }

      // Decode the token from base64 or base64url
      // Base64url uses -_ instead of +/ and no padding
      let tokenBytes: Uint8Array;
      try {
        const normalizedToken = token.replace(/-/g, '+').replace(/_/g, '/');
        tokenBytes = Uint8Array.from(atob(normalizedToken), c => c.charCodeAt(0));
      } catch {
        return res.status(400).json({
          success: false,
          error: 'token is not valid base64/base64url'
        });
      }

      // One-time token replay protection to prevent cross-identity mint replay.
      const tokenHash = Crypto.hashObject({ tokenHex: Crypto.toHex(tokenBytes) });
      cleanupExpiredMintTokens(now);
      const previousUse = usedMintTokenHashes.get(tokenHash);
      if (previousUse) {
        return res.status(409).json({
          success: false,
          error: previousUse.publicKey === userKey
            ? 'This Freebird token has already been used to mint a Day Pass'
            : 'This Freebird token was already used by another identity'
        });
      }

      // Verify the token with Freebird
      const isValid = await clout.verifyFreebirdToken(tokenBytes);
      if (!isValid) {
        return res.status(401).json({
          success: false,
          error: 'Invalid Freebird token'
        });
      }

      if (requiresInvitation) {
        if (typeof invitationCode !== 'string' || invitationCode.trim().length === 0) {
          return res.status(400).json({
            success: false,
            error: 'Invitation code is required for unregistered users'
          });
        }
        if (!consumeInvitationCode) {
          throw new Error('Invitation consumption callback is not configured');
        }
        invitationToConsume = invitationCode.trim();
        if (setUserTicket && !clearUserTicket) {
          throw new Error('Ticket rollback callback is not configured');
        }
      }

      // Mint Day Pass for this user
      // Instance owners get 7-day passes, new users get 24-hour passes
      const durationHours = isOwner ? 168 : 24; // 7 days for owner, 1 day for others
      const expiry = now + (durationHours * 60 * 60 * 1000);

      if (isOwner) {
        console.log(`[Submit] Instance owner ${userKey.slice(0, 8)}... gets 7-day pass`);
      }

      const ticket = {
        owner: userKey,
        expiry,
        durationHours,
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

      // Finalize invitation redemption only after ticket persistence succeeds.
      if (invitationToConsume) {
        const consumed = await consumeInvitationCode!(invitationToConsume, userKey);
        if (!consumed) {
          // Roll back persisted ticket so a failed invitation finalize never grants posting rights.
          if (setUserTicket && clearUserTicket) {
            await clearUserTicket(userKey);
          }
          return res.status(400).json({
            success: false,
            error: 'Invitation code is invalid, already used, or reserved by another user'
          });
        }
      }

      usedMintTokenHashes.set(tokenHash, { publicKey: userKey, usedAt: now });

      // Mark newly onboarded invitation users as registered only after successful mint.
      if (requiresInvitation && setUserRegistered) {
        await setUserRegistered(userKey, true);
      }

      res.json({
        success: true,
        data: {
          publicKey: userKey,
          expiry,
          durationHours,
          timestamp: proof.timestamp
        }
      });
    } catch (error) {
      console.error('[Submit] Day Pass mint error:', getErrorMessage(error));
      res.status(400).json({ success: false, error: getErrorMessage(error) });
    }
  });

  /**
   * Get current Day Pass status for a user
   * Includes isRegistered flag for users who can renew without invitation code
   */
  router.get('/daypass/status/:publicKey', async (req: Request, res: Response) => {
    try {
      const userKey = validatePublicKey(req.params.publicKey);

      // Check if user is registered with Freebird (can renew without invitation)
      const registered = isUserRegistered ? await isUserRegistered(userKey) : false;

      let ticket = null;
      if (getUserTicket) {
        ticket = await getUserTicket(userKey);
      }

      if (!ticket) {
        return res.json({
          success: true,
          data: {
            publicKey: userKey,
            hasTicket: false,
            isRegistered: registered
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
          remainingHours: Math.floor(remainingMs / (1000 * 60 * 60)),
          isRegistered: registered
        }
      });
    } catch (error) {
      res.status(400).json({ success: false, error: getErrorMessage(error) });
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
  router.post('/slide/submit', async (req: Request, res: Response) => {
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
    } catch (error) {
      console.error('[Submit] Slide error:', getErrorMessage(error));
      res.status(400).json({ success: false, error: getErrorMessage(error) });
    }
  });

  /**
   * Get slides addressed to a specific public key
   *
   * Returns encrypted slides that the recipient can decrypt with their private key.
   */
  router.get('/slides/:publicKey', async (req: Request, res: Response) => {
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
    } catch (error) {
      res.status(400).json({ success: false, error: getErrorMessage(error) });
    }
  });

  /**
   * Submit a browser-signed post retraction
   *
   * The browser signs the retraction request with the author's private key,
   * proving they own the post. The server verifies the signature and removes
   * the post from the feed.
   */
  router.post('/retract/submit', async (req: Request, res: Response) => {
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
      const signatureKey = Crypto.toHex(signatureBytes);
      if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
        throw new Error('timestamp is required and must be a number');
      }
      const retractionTimestamp = timestamp;
      const retractionReason = reason || 'retracted';
      const now = Date.now();

      if (Math.abs(now - retractionTimestamp) > POST_SIGNATURE_WINDOW_MS) {
        return res.status(401).json({
          success: false,
          error: 'Retraction signature timestamp is outside the allowed window'
        });
      }

      cleanupExpiredMutationSignatures(now);
      if (usedMutationSignatures.has(`retract:${signatureKey}`)) {
        return res.status(409).json({
          success: false,
          error: 'Duplicate signed retraction submission detected'
        });
      }

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
      usedMutationSignatures.set(`retract:${signatureKey}`, now + POST_SIGNATURE_REPLAY_TTL_MS);

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
    } catch (error) {
      console.error('[Submit] Retraction error:', getErrorMessage(error));
      res.status(400).json({ success: false, error: getErrorMessage(error) });
    }
  });

  /**
   * Submit a browser-signed post edit
   *
   * Edit creates a new post with editOf reference to the original,
   * then retracts the original post with reason 'edited'.
   */
  router.post('/edit/submit', async (req: Request, res: Response) => {
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
      const signatureKey = Crypto.toHex(signatureBytes);
      if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
        throw new Error('timestamp is required and must be a number');
      }
      const editTimestamp = timestamp;
      const now = Date.now();

      if (Math.abs(now - editTimestamp) > POST_SIGNATURE_WINDOW_MS) {
        return res.status(401).json({
          success: false,
          error: 'Edit signature timestamp is outside the allowed window'
        });
      }

      cleanupExpiredMutationSignatures(now);
      if (usedMutationSignatures.has(`edit:${signatureKey}`)) {
        return res.status(409).json({
          success: false,
          error: 'Duplicate signed edit submission detected'
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

      const finalNsfw = nsfw ?? originalPost.nsfw;
      const finalContentWarning = contentWarning ?? originalPost.contentWarning;

      // Verify the canonical post signature for the edited content.
      // This binds signature to the exact payload we will relay.
      const signatureMessage = buildPostSignatureMessage({
        content,
        author: authorKey,
        timestamp: editTimestamp,
        replyTo: originalPost.replyTo,
        mediaCid: undefined,
        link: undefined,
        nsfw: finalNsfw,
        contentWarning: finalContentWarning
      });
      const authorKeyBytes = Crypto.fromHex(authorKey);
      const payloadBytes = new TextEncoder().encode(signatureMessage);

      if (!Crypto.verify(payloadBytes, signatureBytes, authorKeyBytes)) {
        return res.status(401).json({
          success: false,
          error: 'Invalid signature - edit was not signed by the claimed author'
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
      const newPostId = Crypto.hashString(content);

      // Build new post package
      const newPostPackage = {
        id: newPostId,
        content,
        author: authorKey,
        signature: signatureBytes,
        signatureTimestamp: editTimestamp,
        replyTo: originalPost.replyTo,
        editOf: originalPostId,
        nsfw: finalNsfw,
        contentWarning: finalContentWarning,
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
      usedMutationSignatures.set(`edit:${signatureKey}`, now + POST_SIGNATURE_REPLAY_TTL_MS);

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
    } catch (error) {
      console.error('[Submit] Edit error:', getErrorMessage(error));
      res.status(400).json({ success: false, error: getErrorMessage(error) });
    }
  });

  return router;
}
