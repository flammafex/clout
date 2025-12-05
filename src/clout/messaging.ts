/**
 * CloutMessaging - Encrypted Direct Messages (Slides)
 *
 * Handles end-to-end encrypted messaging between users.
 * Uses ephemeral key exchange for forward secrecy.
 */

import { Crypto } from '../crypto.js';
import type { WitnessClient } from '../types.js';
import type { SlidePackage, CloutStore, ContentGossipMessage } from '../clout-types.js';

export interface MessagingConfig {
  publicKey: string;
  privateKey: Uint8Array;
  witness: WitnessClient;
  gossip?: {
    publish(msg: ContentGossipMessage): Promise<void>;
  };
  store?: CloutStore;
}

export class CloutMessaging {
  private readonly publicKeyHex: string;
  private readonly privateKey: Uint8Array;
  private readonly witness: WitnessClient;
  private readonly gossip?: { publish(msg: ContentGossipMessage): Promise<void> };
  private readonly store?: CloutStore;

  constructor(config: MessagingConfig) {
    this.publicKeyHex = config.publicKey;
    this.privateKey = config.privateKey;
    this.witness = config.witness;
    this.gossip = config.gossip;
    this.store = config.store;
  }

  /**
   * Send an encrypted slide (DM) to another user
   */
  async send(recipientKey: string, message: string): Promise<SlidePackage> {
    // 1. Encrypt message for recipient
    const recipientPublicKey = Crypto.fromHex(recipientKey);
    const { ephemeralPublicKey, ciphertext } = Crypto.encrypt(message, recipientPublicKey);

    // 2. Create signature over the slide components
    const signaturePayload = Crypto.hash(
      recipientPublicKey,
      ephemeralPublicKey,
      ciphertext
    );
    const signature = Crypto.hash(signaturePayload, this.privateKey);

    // 3. Get Witness timestamp proof
    const slideHash = Crypto.toHex(Crypto.hash(
      this.publicKeyHex,
      recipientKey,
      ephemeralPublicKey,
      ciphertext
    ));
    const proof = await this.witness.timestamp(slideHash);

    // 4. Create slide package
    const slide: SlidePackage = {
      id: slideHash,
      sender: this.publicKeyHex,
      recipient: recipientKey,
      ephemeralPublicKey,
      ciphertext,
      signature,
      proof
    };

    // 5. Propagate through gossip network
    if (this.gossip) {
      await this.gossip.publish({
        type: 'slide',
        slide,
        timestamp: Date.now()
      });
    }

    console.log(`[Clout] 📬 Slide sent to ${recipientKey.slice(0, 8)}`);
    return slide;
  }

  /**
   * Decrypt a received slide
   */
  decrypt(slide: SlidePackage): string {
    if (slide.recipient !== this.publicKeyHex) {
      throw new Error('Cannot decrypt slide not addressed to this user');
    }

    return Crypto.decrypt(
      slide.ephemeralPublicKey,
      slide.ciphertext,
      this.privateKey
    );
  }

  /**
   * Get inbox with all received slides
   */
  async getInbox(): Promise<SlidePackage[]> {
    let slides: SlidePackage[] = [];

    if (this.store) {
      slides = await this.store.getInbox();
    }

    // Filter slides addressed to us (store should already be filtered, but double check)
    const mySlides = slides.filter(
      slide => slide.recipient === this.publicKeyHex
    );

    // Sort by timestamp (newest first)
    return mySlides.sort((a, b) => b.proof.timestamp - a.proof.timestamp);
  }

  /**
   * Handle incoming slide from gossip
   */
  async handleIncomingSlide(slide: SlidePackage): Promise<boolean> {
    // Check if this slide is for us
    if (slide.recipient !== this.publicKeyHex) {
      return false;
    }

    // Save to store
    if (this.store) {
      await this.store.addSlide(slide);
      console.log(`[Clout] 📬 Received new slide from ${slide.sender.slice(0, 8)}`);
    }

    return true;
  }

  /**
   * Get count of unread slides (future: track read status)
   */
  async getUnreadCount(): Promise<number> {
    const slides = await this.getInbox();
    // TODO: Track read status
    return slides.length;
  }
}
