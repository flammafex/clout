import { Crypto } from './crypto.js';
import type { KeyPair, FreebirdClient, WitnessClient, Attestation } from './types.js';

export interface CloutTicket {
  owner: string;          // User's Public Key (Hex)
  expiry: number;         // Timestamp (e.g., Now + 24-168 hours)
  proof: Uint8Array;      // The consumed Freebird Token
  signature: Attestation; // Witness proof that this ticket was minted now
  durationHours: number;  // Duration in hours (for transparency)
  delegatedFrom?: string; // Optional: delegator's public key (if this is a delegated pass)
}

export interface DelegatedPass {
  delegator: string;      // Who's delegating the pass
  recipient: string;      // Who receives the pass
  expiry: number;         // When this delegation expires
  signature: Uint8Array;  // Delegator's signature
  proof: Attestation;     // Witness timestamp
}

export class TicketBooth {
  private freebird: FreebirdClient;
  private witness: WitnessClient;
  private readonly delegations = new Map<string, DelegatedPass>(); // recipient -> delegation

  constructor(freebird: FreebirdClient, witness: WitnessClient) {
    this.freebird = freebird;
    this.witness = witness;
  }

  /**
   * Exchange a Freebird Token for a Clout Ticket
   *
   * Duration is reputation-based:
   * - Reputation >= 0.9: 7 days (168 hours)
   * - Reputation >= 0.7: 3 days (72 hours)
   * - Reputation >= 0.5: 2 days (48 hours)
   * - Reputation < 0.5: 1 day (24 hours)
   *
   * This adaptive friction eases the burden on trusted members while
   * maintaining high cost for unvetted actors.
   *
   * @param user - User's keypair
   * @param freebirdToken - Freebird token to consume
   * @param reputationScore - Optional reputation score (0-1)
   */
  async mintTicket(
    user: KeyPair,
    freebirdToken: Uint8Array,
    reputationScore?: number
  ): Promise<CloutTicket> {
    // 1. Verify the Sybil Token (Proof of Work / Invite / etc)
    const isValid = await this.freebird.verifyToken(freebirdToken);
    if (!isValid) {
      throw new Error("Invalid Freebird Token - Access Denied");
    }

    // 2. Calculate duration based on reputation
    const durationHours = this.calculateDuration(reputationScore);
    const now = Date.now();
    const expiry = now + (durationHours * 60 * 60 * 1000);

    // 3. Create the Ticket Payload
    const ticketPayload = {
      owner: Crypto.toHex(user.publicKey.bytes),
      expiry: expiry,
      durationHours,
      proof: Crypto.toHex(freebirdToken)
    };

    // 4. Timestamp it with Witness (The "Notary")
    const payloadHash = Crypto.hashString(JSON.stringify(ticketPayload));
    const signature = await this.witness.timestamp(payloadHash);

    console.log(
      `[TicketBooth] 🎟️ Minted ${durationHours}h ticket for ${ticketPayload.owner.slice(0, 8)} ` +
      `(reputation: ${reputationScore?.toFixed(2) ?? 'N/A'})`
    );

    return {
      owner: ticketPayload.owner,
      expiry: ticketPayload.expiry,
      durationHours,
      proof: freebirdToken,
      signature: signature
    };
  }

  /**
   * Calculate day pass duration based on reputation score
   *
   * @param reputationScore - Score from 0 to 1
   * @returns Duration in hours
   */
  private calculateDuration(reputationScore?: number): number {
    if (reputationScore === undefined) {
      return 24; // Default: 24 hours
    }

    // High reputation = longer duration
    if (reputationScore >= 0.9) {
      return 168; // 7 days
    } else if (reputationScore >= 0.7) {
      return 72; // 3 days
    } else if (reputationScore >= 0.5) {
      return 48; // 2 days
    } else {
      return 24; // 1 day
    }
  }

  /**
   * Verify a ticket is valid and owned by the user
   */
  async verifyTicket(ticket: CloutTicket, userPublicKey: string): Promise<boolean> {
    // 1. Check Ownership
    if (ticket.owner !== userPublicKey) {
      console.warn(`[TicketBooth] Ticket theft: ${ticket.owner} !== ${userPublicKey}`);
      return false;
    }

    // 2. Check Expiry
    if (Date.now() > ticket.expiry) {
      console.warn(`[TicketBooth] Ticket expired at ${new Date(ticket.expiry).toISOString()}`);
      return false;
    }

    // 3. Verify Witness Signature
    const isValidSignature = await this.witness.verify(ticket.signature);
    if (!isValidSignature) {
      console.warn(`[TicketBooth] Invalid Witness signature on ticket`);
      return false;
    }

    return true;
  }

  /**
   * Delegate a day pass to a new user (high-reputation only)
   *
   * Allows trusted users to vouch for newcomers by delegating limited passes.
   * The recipient can then use this delegation to mint a ticket without a Freebird token.
   *
   * @param delegator - Delegator's keypair
   * @param recipient - Recipient's public key (hex)
   * @param delegatorReputation - Delegator's reputation score
   * @param durationHours - Pass duration in hours (default: 24)
   */
  async delegatePass(
    delegator: KeyPair,
    recipient: string,
    delegatorReputation: number,
    durationHours: number = 24
  ): Promise<DelegatedPass> {
    // Only high-reputation users can delegate
    if (delegatorReputation < 0.7) {
      throw new Error('Insufficient reputation to delegate passes (need ≥0.7)');
    }

    const delegatorKey = Crypto.toHex(delegator.publicKey.bytes);

    // Create delegation
    const now = Date.now();
    const expiry = now + (durationHours * 60 * 60 * 1000);

    const delegationPayload = {
      delegator: delegatorKey,
      recipient,
      expiry,
      timestamp: now
    };

    // Sign delegation with delegator's key
    const payloadHash = Crypto.hashString(JSON.stringify(delegationPayload));
    const signature = Crypto.hash(payloadHash, delegator.privateKey.bytes);

    // Timestamp with Witness
    const proof = await this.witness.timestamp(payloadHash);

    const delegation: DelegatedPass = {
      delegator: delegatorKey,
      recipient,
      expiry,
      signature,
      proof
    };

    // Store delegation
    this.delegations.set(recipient, delegation);

    console.log(
      `[TicketBooth] 🎁 ${delegatorKey.slice(0, 8)} delegated ${durationHours}h pass to ${recipient.slice(0, 8)}`
    );

    return delegation;
  }

  /**
   * Mint a ticket using a delegated pass (no Freebird token required)
   *
   * @param user - User's keypair (must be the delegation recipient)
   */
  async mintDelegatedTicket(user: KeyPair): Promise<CloutTicket> {
    const userKey = Crypto.toHex(user.publicKey.bytes);
    const delegation = this.delegations.get(userKey);

    if (!delegation) {
      throw new Error('No delegation found for this user');
    }

    // Verify delegation hasn't expired
    if (Date.now() > delegation.expiry) {
      this.delegations.delete(userKey);
      throw new Error('Delegation expired');
    }

    // Verify witness proof
    const proofValid = await this.witness.verify(delegation.proof);
    if (!proofValid) {
      throw new Error('Invalid delegation proof');
    }

    // Calculate ticket duration (same as delegation)
    const remainingMs = delegation.expiry - Date.now();
    const durationHours = Math.floor(remainingMs / (60 * 60 * 1000));

    // Create ticket (using delegation signature as proof)
    const ticketPayload = {
      owner: userKey,
      expiry: delegation.expiry,
      durationHours,
      delegatedFrom: delegation.delegator
    };

    const payloadHash = Crypto.hashString(JSON.stringify(ticketPayload));
    const signature = await this.witness.timestamp(payloadHash);

    // Consume delegation (one-time use)
    this.delegations.delete(userKey);

    console.log(
      `[TicketBooth] 🎫 Minted delegated ticket for ${userKey.slice(0, 8)} ` +
      `(from ${delegation.delegator.slice(0, 8)})`
    );

    return {
      owner: userKey,
      expiry: delegation.expiry,
      durationHours,
      proof: delegation.signature, // Use delegation signature as proof
      signature,
      delegatedFrom: delegation.delegator
    };
  }

  /**
   * Check if a user has a pending delegation
   */
  hasDelegation(userPublicKey: string): boolean {
    const delegation = this.delegations.get(userPublicKey);
    if (!delegation) return false;

    // Check if expired
    if (Date.now() > delegation.expiry) {
      this.delegations.delete(userPublicKey);
      return false;
    }

    return true;
  }

  /**
   * Calculate maximum delegations allowed based on reputation
   *
   * - Reputation >= 0.9: 10 delegations per week
   * - Reputation >= 0.7: 5 delegations per week
   * - Reputation < 0.7: 0 delegations
   */
  getMaxDelegations(reputationScore: number): number {
    if (reputationScore >= 0.9) {
      return 10;
    } else if (reputationScore >= 0.7) {
      return 5;
    } else {
      return 0;
    }
  }
}