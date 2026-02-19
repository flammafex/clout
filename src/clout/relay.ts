/**
 * Relay Module - Browser-side identity relay
 *
 * Handles:
 * - Relaying pre-signed posts from browser
 * - Relaying pre-signed trust signals from browser
 * - Freebird token verification
 * - Witness proof generation
 */

import { Crypto } from '../crypto.js';
import { hashPostAttestationPayload } from '../post-canonical.js';
import type { CloutStateManager } from '../chronicle/clout-state.js';
import type { ContentGossip } from '../post.js';
import type { FreebirdClient, WitnessClient, Attestation } from '../types.js';
import type { CloutStore, PostPackage, EncryptedTrustSignal } from '../clout-types.js';

export interface RelayConfig {
  publicKey: string;
  freebird: FreebirdClient;
  witness: WitnessClient;
  gossip?: ContentGossip;
  store?: CloutStore;
  state: CloutStateManager;
  extractMentions: (content: string) => string[];
}

export class CloutRelay {
  private readonly publicKeyHex: string;
  private readonly freebird: FreebirdClient;
  private readonly witness: WitnessClient;
  private readonly gossip?: ContentGossip;
  private readonly store?: CloutStore;
  private readonly state: CloutStateManager;
  private readonly extractMentions: (content: string) => string[];

  constructor(config: RelayConfig) {
    this.publicKeyHex = config.publicKey;
    this.freebird = config.freebird;
    this.witness = config.witness;
    this.gossip = config.gossip;
    this.store = config.store;
    this.state = config.state;
    this.extractMentions = config.extractMentions;
  }

  /**
   * Relay a pre-signed post to the gossip network
   *
   * Used when the browser has signed the post with the user's private key.
   * The server verifies the signature and broadcasts to gossip.
   */
  async relayPost(postPackage: {
    id: string;
    content: string;
    author: string;
    signature: Uint8Array;
    signatureTimestamp?: number;
    ephemeralPublicKey?: Uint8Array;
    ephemeralKeyProof?: Uint8Array;
    replyTo?: string;
    nsfw?: boolean;
    contentWarning?: string;
    media?: { cid: string };
    link?: { url: string; title?: string; description?: string; image?: string; siteName?: string; type?: string; fetchedAt: number };
    authorshipProof?: Uint8Array;
    authorDisplayName?: string;
    authorAvatar?: string;
  }): Promise<Attestation> {
    // Get witness proof for the post
    const postHash = hashPostAttestationPayload(postPackage);

    const proof = await this.witness.timestamp(postHash);

    // Build full post package with proof
    const fullPost: PostPackage = {
      id: postPackage.id,
      content: postPackage.content,
      author: postPackage.author,
      signature: postPackage.signature,
      signatureTimestamp: postPackage.signatureTimestamp,
      proof,
      ephemeralPublicKey: postPackage.ephemeralPublicKey,
      ephemeralKeyProof: postPackage.ephemeralKeyProof,
      replyTo: postPackage.replyTo,
      nsfw: postPackage.nsfw,
      contentWarning: postPackage.contentWarning,
      media: postPackage.media ? {
        cid: postPackage.media.cid,
        mimeType: 'application/octet-stream',
        size: 0,
        storedAt: Date.now()
      } : undefined,
      // OpenGraph link preview (mutually exclusive with media)
      link: postPackage.link,
      authorshipProof: postPackage.authorshipProof,
      mentions: this.extractMentions(postPackage.content),
      // Include author's chosen display name and avatar
      authorDisplayName: postPackage.authorDisplayName,
      authorAvatar: postPackage.authorAvatar
    };

    // Store locally
    this.state.addPost(fullPost);
    if (this.store) {
      await this.store.addPost(fullPost);
    }

    // Broadcast via gossip
    if (this.gossip) {
      await this.gossip.publish({
        type: 'post',
        post: fullPost,
        timestamp: proof.timestamp
      });
    }

    console.log(`[Clout] Relayed post ${postPackage.id.slice(0, 8)} from ${postPackage.author.slice(0, 8)}`);
    return proof;
  }

  /**
   * Relay a pre-signed encrypted trust signal to the gossip network
   */
  async relayTrustSignal(signal: {
    truster: string;
    trusteeCommitment: string;
    encryptedTrustee: {
      ephemeralPublicKey: Uint8Array;
      ciphertext: Uint8Array;
    };
    signature: Uint8Array;
    weight: number;
    version: 'encrypted-v1';
  }): Promise<Attestation> {
    // Get witness proof for the commitment
    const proof = await this.witness.timestamp(signal.trusteeCommitment);

    // Build full encrypted trust signal
    const fullSignal: EncryptedTrustSignal = {
      truster: signal.truster,
      trusteeCommitment: signal.trusteeCommitment,
      encryptedTrustee: signal.encryptedTrustee,
      signature: signal.signature,
      proof,
      weight: signal.weight,
      version: signal.version
    };

    // Broadcast via gossip
    if (this.gossip) {
      await this.gossip.publish({
        type: 'trust-encrypted',
        encryptedTrustSignal: fullSignal,
        timestamp: proof.timestamp
      });
    }

    console.log(`[Clout] Relayed trust signal from ${signal.truster.slice(0, 8)}`);
    return proof;
  }

  /**
   * Verify a Freebird token
   */
  async verifyFreebirdToken(token: Uint8Array): Promise<boolean> {
    return this.freebird.verifyToken(token);
  }

  /**
   * Get a witness proof for arbitrary data
   */
  async getWitnessProof(data: string | Uint8Array): Promise<Attestation> {
    const hashInput = typeof data === 'string' ? data : Crypto.toHex(data);
    return this.witness.timestamp(hashInput);
  }
}
