/**
 * Economics Module - Day Pass system with reputation-based duration
 *
 * Handles the anti-Sybil ticket system:
 * - Day passes exchanged from Freebird tokens
 * - Reputation-based pass duration (higher rep = longer passes)
 * - Pass delegation from high-rep users to newcomers
 */

import { TicketBooth, type CloutTicket, type TicketType } from '../ticket-booth.js';
import { Crypto } from '../crypto.js';
import type { ReputationValidator } from '../reputation.js';
import type { FreebirdClient, WitnessClient } from '../types.js';
import type { CloutStore } from '../clout-types.js';

export interface EconomicsConfig {
  publicKey: string;
  privateKey: Uint8Array;
  freebird: FreebirdClient;
  witness: WitnessClient;
  store?: CloutStore;
  ticketBooth: TicketBooth;
  reputationValidator: ReputationValidator;
  /**
   * Optional callback called when user is marked as registered with Freebird.
   * Called after successful token issuance with invitation mode.
   * The calling code should persist this state to survive app restarts.
   */
  onFreebirdRegistered?: () => void;
}

export class CloutEconomics {
  private readonly publicKeyHex: string;
  private readonly privateKey: Uint8Array;
  private readonly freebird: FreebirdClient;
  private readonly witness: WitnessClient;
  private readonly store?: CloutStore;
  private readonly ticketBooth: TicketBooth;
  private readonly reputationValidator: ReputationValidator;
  private readonly onFreebirdRegistered?: () => void;

  private currentTicket?: CloutTicket;

  constructor(config: EconomicsConfig) {
    this.publicKeyHex = config.publicKey;
    this.privateKey = config.privateKey;
    this.freebird = config.freebird;
    this.witness = config.witness;
    this.store = config.store;
    this.ticketBooth = config.ticketBooth;
    this.reputationValidator = config.reputationValidator;
    this.onFreebirdRegistered = config.onFreebirdRegistered;
  }

  /**
   * Exchange a Freebird token for a Day Pass
   *
   * Pass duration is reputation-based:
   * - High reputation (≥0.9): 7 days
   * - Medium reputation (≥0.7): 3 days
   * - Low reputation (≥0.5): 2 days
   * - New/untrusted (<0.5): 1 day
   */
  async buyDayPass(freebirdToken: Uint8Array): Promise<void> {
    const userKeyPair = {
      publicKey: { bytes: Crypto.fromHex(this.publicKeyHex) },
      privateKey: { bytes: this.privateKey }
    };

    // Get our own reputation score to determine pass duration
    const reputation = this.reputationValidator.computeReputation(this.publicKeyHex);

    this.currentTicket = await this.ticketBooth.mintTicket(
      userKeyPair,
      freebirdToken,
      reputation.score
    );

    // Persist the ticket for cross-restart survival
    this.saveTicket();

    const durationDays = Math.round(this.currentTicket.durationHours / 24);
    console.log(
      `[Clout] 🎟️ ${durationDays}-day pass acquired for ${this.publicKeyHex.slice(0, 8)} ` +
      `(reputation: ${reputation.score.toFixed(2)})`
    );
  }

  /**
   * Obtain a Freebird token (Day Pass)
   *
   * After successful token issuance with invitation mode, marks the user as registered
   * with Freebird so they can renew their Day Pass without a new invitation code.
   *
   * Also updates Witness with the token for Sybil resistance in timestamp requests.
   */
  async obtainToken(): Promise<Uint8Array> {
    const blinded = await this.freebird.blind({ bytes: Crypto.fromHex(this.publicKeyHex) });
    const token = await this.freebird.issueToken(blinded);

    // After successful token issuance, mark user as registered for future renewals
    // This allows Day Pass renewal without requiring a new invitation code
    if (this.freebird.markAsRegistered) {
      this.freebird.markAsRegistered();

      // Notify calling code to persist the registered state
      if (this.onFreebirdRegistered) {
        this.onFreebirdRegistered();
      }
    }

    // Pass the token metadata to Witness for Sybil resistance in timestamp requests
    // Witness will include this token when timestamping posts/reactions/etc.
    if (this.freebird.getLastTokenInfo && this.witness.setFreebirdToken) {
      const tokenInfo = this.freebird.getLastTokenInfo();
      if (tokenInfo) {
        this.witness.setFreebirdToken(tokenInfo);
        console.log('[Economics] Freebird token passed to Witness for Sybil resistance');
      }
    }

    return token;
  }

  /**
   * Check if the user has a valid Day Pass
   */
  hasActiveTicket(): boolean {
    return !!this.currentTicket && Date.now() <= this.currentTicket.expiry;
  }

  /**
   * Get current ticket info (for UI display)
   */
  getTicketInfo(): { expiry: number; durationHours: number; delegatedFrom?: string } | null {
    if (!this.currentTicket) return null;
    return {
      expiry: this.currentTicket.expiry,
      durationHours: this.currentTicket.durationHours,
      delegatedFrom: this.currentTicket.delegatedFrom
    };
  }

  /**
   * Get the current ticket (for posting)
   */
  getCurrentTicket(): CloutTicket | undefined {
    return this.currentTicket;
  }

  /**
   * Clear the current ticket (when expired)
   */
  clearTicket(): void {
    this.currentTicket = undefined;
  }

  /**
   * Load saved ticket from persistent storage (survives Docker restarts)
   *
   * Called during initialization to restore ticket state.
   * Performs defense-in-depth verification:
   * 1. Check expiry (quick rejection)
   * 2. Verify witness signature (prevents storage tampering)
   *
   * If the ticket is expired or invalid, it's automatically cleared.
   */
  async loadSavedTicket(): Promise<void> {
    if (!this.store || !('getTicket' in this.store)) {
      return;
    }

    const savedTicket = (this.store as any).getTicket();
    if (!savedTicket) {
      return;
    }

    // 1. Quick expiry check first (no need for crypto if expired)
    if (Date.now() > savedTicket.expiry) {
      console.log('[Clout] Saved ticket expired, discarding');
      if ('clearTicket' in this.store) {
        (this.store as any).clearTicket();
      }
      return;
    }

    // 2. Verify witness signature before accepting (defense in depth)
    // This prevents users from extending ticket expiry via storage manipulation
    if (savedTicket.proof) {
      try {
        const isValid = await this.witness.verify(savedTicket.proof);
        if (!isValid) {
          console.warn('[Clout] ⚠️ Saved ticket has invalid witness signature, discarding');
          if ('clearTicket' in this.store) {
            (this.store as any).clearTicket();
          }
          return;
        }
      } catch (err) {
        // If verification fails (e.g., witness unavailable), log but still load
        // This allows offline usage while still providing protection when online
        console.warn('[Clout] Could not verify ticket signature (witness unavailable):', err);
      }
    }

    // 3. Restore ticket as CloutTicket
    // Infer ticket type for backwards compatibility with old saved tickets
    const ticketType: TicketType = savedTicket.ticketType ?? (savedTicket.delegatedFrom ? 'delegated' : 'direct');

    this.currentTicket = {
      owner: savedTicket.owner,
      expiry: savedTicket.expiry,
      proof: savedTicket.proof,
      signature: savedTicket.signature,
      durationHours: savedTicket.durationHours,
      ticketType,
      freebirdProof: savedTicket.freebirdProof ?? (ticketType === 'direct' ? savedTicket.proof : undefined),
      delegationProof: savedTicket.delegationProof ?? (ticketType === 'delegated' ? savedTicket.proof : undefined),
      delegatedFrom: savedTicket.delegatedFrom
    };

    const remainingMs = savedTicket.expiry - Date.now();
    const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60));
    const remainingMinutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));

    console.log(
      `[Clout] 🎟️ Restored day pass: ${remainingHours}h ${remainingMinutes}m remaining`
    );
  }

  /**
   * Save current ticket to persistent storage
   */
  private saveTicket(): void {
    if (!this.store || !('saveTicket' in this.store) || !this.currentTicket) {
      return;
    }

    (this.store as any).saveTicket(this.currentTicket);
    console.log(`[Clout] 💾 Day pass persisted to storage`);
  }

  /**
   * Delegate a day pass to another user (requires high reputation ≥0.7)
   *
   * Allows trusted users to vouch for newcomers.
   * The recipient can use the delegation to mint a ticket without a Freebird token.
   *
   * @param recipientKey - Public key of the user to delegate to
   * @param durationHours - Duration in hours (default: 24)
   */
  async delegatePass(recipientKey: string, durationHours: number = 24): Promise<void> {
    // Get our reputation score
    const reputation = this.reputationValidator.computeReputation(this.publicKeyHex);

    // Check if we're eligible to delegate
    const maxDelegations = this.ticketBooth.getMaxDelegations(reputation.score);
    if (maxDelegations === 0) {
      throw new Error(
        `Insufficient reputation to delegate passes (need ≥0.7, have ${reputation.score.toFixed(2)})`
      );
    }

    const userKeyPair = {
      publicKey: { bytes: Crypto.fromHex(this.publicKeyHex) },
      privateKey: { bytes: this.privateKey }
    };

    await this.ticketBooth.delegatePass(
      userKeyPair,
      recipientKey,
      reputation.score,
      durationHours
    );

    console.log(
      `[Clout] 🎁 Delegated ${durationHours}h pass to ${recipientKey.slice(0, 8)} ` +
      `(${maxDelegations} max per week)`
    );
  }

  /**
   * Accept a delegated pass and mint a ticket (no Freebird token required)
   */
  async acceptDelegatedPass(): Promise<void> {
    const userKeyPair = {
      publicKey: { bytes: Crypto.fromHex(this.publicKeyHex) },
      privateKey: { bytes: this.privateKey }
    };

    this.currentTicket = await this.ticketBooth.mintDelegatedTicket(userKeyPair);

    console.log(
      `[Clout] 🎫 Accepted delegated pass from ${this.currentTicket.delegatedFrom?.slice(0, 8) ?? 'unknown'}`
    );
  }

  /**
   * Check if we have a pending delegation
   */
  hasPendingDelegation(): boolean {
    return this.ticketBooth.hasDelegation(this.publicKeyHex);
  }
}
