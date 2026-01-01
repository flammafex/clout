import { Crypto } from './crypto.js';
import type { KeyPair, FreebirdClient, WitnessClient, Attestation } from './types.js';

/**
 * Ticket type discriminator
 *
 * - 'direct': Minted using a Freebird token (proof is freebirdToken)
 * - 'delegated': Minted using a delegation (proof is delegator's signature)
 */
export type TicketType = 'direct' | 'delegated';

export interface CloutTicket {
  owner: string;          // User's Public Key (Hex)
  expiry: number;         // Timestamp (e.g., Now + 24-168 hours)
  signature: Attestation; // Witness proof that this ticket was minted now
  durationHours: number;  // Duration in hours (for transparency)

  /**
   * Ticket type discriminator (default: 'direct' for backwards compatibility)
   */
  ticketType: TicketType;

  /**
   * Freebird token proof (present if ticketType === 'direct')
   */
  freebirdProof?: Uint8Array;

  /**
   * Delegation signature proof (present if ticketType === 'delegated')
   */
  delegationProof?: Uint8Array;

  /**
   * Delegator's public key (present if ticketType === 'delegated')
   */
  delegatedFrom?: string;

  /**
   * @deprecated Use freebirdProof or delegationProof based on ticketType
   * Kept for backwards compatibility - contains the appropriate proof based on ticket type
   */
  proof: Uint8Array;
}

export interface DelegatedPass {
  delegator: string;      // Who's delegating the pass
  recipient: string;      // Who receives the pass
  expiry: number;         // When this delegation expires
  signature: Uint8Array;  // Delegator's signature
  proof: Attestation;     // Witness timestamp
  requiredReputation: number; // Minimum reputation delegator must maintain
}

/**
 * Reputation getter function type
 * Returns reputation score (0-1) for a public key
 */
export type ReputationGetter = (publicKey: string) => number;

/**
 * Callback for delegation changes (for persistence)
 * Called when a delegation is created, consumed, or expires.
 *
 * @param delegation - The delegation that changed, or null if removed
 * @param recipient - The recipient's public key
 */
export type DelegationChangeCallback = (delegation: DelegatedPass | null, recipient: string) => void;

/**
 * Delegation count tracking for rate limiting
 */
export interface DelegationCount {
  count: number;
  windowStart: number; // Start of the current counting window (weekly)
}

/**
 * Callback for delegation count changes (for persistence)
 */
export type DelegationCountCallback = (delegator: string, count: DelegationCount) => void;

/**
 * Configuration options for TicketBooth
 */
export interface TicketBoothConfig {
  freebird: FreebirdClient;
  witness: WitnessClient;

  /**
   * Optional callback to persist delegation changes
   * Called when delegations are created, consumed, or expire
   */
  onDelegationChange?: DelegationChangeCallback;

  /**
   * Optional initial delegations from persistence
   * Map of recipient public key -> DelegatedPass
   */
  persistedDelegations?: Map<string, DelegatedPass>;

  /**
   * Optional callback to persist delegation count changes
   * Called when a user's delegation count changes
   */
  onDelegationCountChange?: DelegationCountCallback;

  /**
   * Optional initial delegation counts from persistence
   * Map of delegator public key -> DelegationCount
   */
  persistedDelegationCounts?: Map<string, DelegationCount>;
}

/** One week in milliseconds */
const DELEGATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export class TicketBooth {
  private freebird: FreebirdClient;
  private witness: WitnessClient;
  private readonly delegations = new Map<string, DelegatedPass>(); // recipient -> delegation
  private readonly delegationCounts = new Map<string, DelegationCount>(); // delegator -> count this week
  private reputationGetter?: ReputationGetter;
  private readonly onDelegationChange?: DelegationChangeCallback;
  private readonly onDelegationCountChange?: DelegationCountCallback;

  constructor(freebird: FreebirdClient, witness: WitnessClient, config?: Partial<TicketBoothConfig>);
  constructor(config: TicketBoothConfig);
  constructor(
    freebirdOrConfig: FreebirdClient | TicketBoothConfig,
    witness?: WitnessClient,
    config?: Partial<TicketBoothConfig>
  ) {
    // Handle both old and new constructor signatures for backward compatibility
    if ('freebird' in freebirdOrConfig && 'witness' in freebirdOrConfig) {
      // New config object style
      const cfg = freebirdOrConfig as TicketBoothConfig;
      this.freebird = cfg.freebird;
      this.witness = cfg.witness;
      this.onDelegationChange = cfg.onDelegationChange;
      this.onDelegationCountChange = cfg.onDelegationCountChange;

      // Load persisted delegations
      if (cfg.persistedDelegations) {
        for (const [recipient, delegation] of cfg.persistedDelegations) {
          // Only load non-expired delegations
          if (Date.now() <= delegation.expiry) {
            this.delegations.set(recipient, delegation);
          }
        }
        console.log(`[TicketBooth] Loaded ${this.delegations.size} persisted delegations`);
      }

      // Load persisted delegation counts
      if (cfg.persistedDelegationCounts) {
        for (const [delegator, count] of cfg.persistedDelegationCounts) {
          // Only load if still in current window
          if (Date.now() < count.windowStart + DELEGATION_WINDOW_MS) {
            this.delegationCounts.set(delegator, count);
          }
        }
      }
    } else {
      // Old style: separate freebird and witness arguments
      this.freebird = freebirdOrConfig as FreebirdClient;
      this.witness = witness!;
      this.onDelegationChange = config?.onDelegationChange;
      this.onDelegationCountChange = config?.onDelegationCountChange;

      // Load persisted delegations from config
      if (config?.persistedDelegations) {
        for (const [recipient, delegation] of config.persistedDelegations) {
          if (Date.now() <= delegation.expiry) {
            this.delegations.set(recipient, delegation);
          }
        }
        console.log(`[TicketBooth] Loaded ${this.delegations.size} persisted delegations`);
      }

      // Load persisted delegation counts
      if (config?.persistedDelegationCounts) {
        for (const [delegator, count] of config.persistedDelegationCounts) {
          if (Date.now() < count.windowStart + DELEGATION_WINDOW_MS) {
            this.delegationCounts.set(delegator, count);
          }
        }
      }
    }
  }

  /**
   * Set the reputation getter function
   * This allows the TicketBooth to verify delegator reputation at mint time
   */
  setReputationGetter(getter: ReputationGetter): void {
    this.reputationGetter = getter;
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
    const payloadHash = Crypto.hashObject(ticketPayload);
    const signature = await this.witness.timestamp(payloadHash);

    console.log(
      `[TicketBooth] 🎟️ Minted ${durationHours}h ticket for ${ticketPayload.owner.slice(0, 8)} ` +
      `(reputation: ${reputationScore?.toFixed(2) ?? 'N/A'})`
    );

    return {
      owner: ticketPayload.owner,
      expiry: ticketPayload.expiry,
      durationHours,
      ticketType: 'direct' as const,
      freebirdProof: freebirdToken,
      proof: freebirdToken, // Backwards compatibility
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

    // Enforce delegation rate limit
    const maxAllowed = this.getMaxDelegations(delegatorReputation);
    const currentCount = this.getDelegationCount(delegatorKey);
    if (currentCount >= maxAllowed) {
      throw new Error(
        `Delegation limit reached (${currentCount}/${maxAllowed} this week). ` +
        `Try again after the weekly reset.`
      );
    }

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
    const payloadHash = Crypto.hashObject(delegationPayload);
    const signature = Crypto.hash(payloadHash, delegator.privateKey.bytes);

    // Timestamp with Witness
    const proof = await this.witness.timestamp(payloadHash);

    const delegation: DelegatedPass = {
      delegator: delegatorKey,
      recipient,
      expiry,
      signature,
      proof,
      requiredReputation: 0.7 // Minimum reputation delegator must maintain
    };

    // Store delegation
    this.delegations.set(recipient, delegation);

    // Persist the new delegation
    if (this.onDelegationChange) {
      this.onDelegationChange(delegation, recipient);
    }

    // Increment delegation count for rate limiting
    this.incrementDelegationCount(delegatorKey);

    console.log(
      `[TicketBooth] 🎁 ${delegatorKey.slice(0, 8)} delegated ${durationHours}h pass to ${recipient.slice(0, 8)} ` +
      `(${currentCount + 1}/${maxAllowed} this week)`
    );

    return delegation;
  }

  /**
   * Get current delegation count for a user (within the weekly window)
   */
  getDelegationCount(delegatorKey: string): number {
    const record = this.delegationCounts.get(delegatorKey);
    if (!record) {
      return 0;
    }

    // Check if the window has expired
    if (Date.now() >= record.windowStart + DELEGATION_WINDOW_MS) {
      // Window expired, reset count
      this.delegationCounts.delete(delegatorKey);
      return 0;
    }

    return record.count;
  }

  /**
   * Increment delegation count for a user
   */
  private incrementDelegationCount(delegatorKey: string): void {
    const now = Date.now();
    let record = this.delegationCounts.get(delegatorKey);

    // Check if we need to start a new window
    if (!record || now >= record.windowStart + DELEGATION_WINDOW_MS) {
      record = { count: 0, windowStart: now };
    }

    record.count++;
    this.delegationCounts.set(delegatorKey, record);

    // Persist the count change
    if (this.onDelegationCountChange) {
      this.onDelegationCountChange(delegatorKey, record);
    }
  }

  /**
   * Get delegation rate limit info for a user
   */
  getDelegationLimitInfo(delegatorKey: string, reputation: number): {
    current: number;
    max: number;
    remaining: number;
    windowResetMs: number;
  } {
    const max = this.getMaxDelegations(reputation);
    const current = this.getDelegationCount(delegatorKey);
    const record = this.delegationCounts.get(delegatorKey);
    const windowResetMs = record
      ? Math.max(0, (record.windowStart + DELEGATION_WINDOW_MS) - Date.now())
      : 0;

    return {
      current,
      max,
      remaining: Math.max(0, max - current),
      windowResetMs
    };
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
      // Persist the removal
      if (this.onDelegationChange) {
        this.onDelegationChange(null, userKey);
      }
      throw new Error('Delegation expired');
    }

    // Verify witness proof
    const proofValid = await this.witness.verify(delegation.proof);
    if (!proofValid) {
      throw new Error('Invalid delegation proof');
    }

    // Verify delegator still has sufficient reputation
    if (this.reputationGetter) {
      const currentReputation = this.reputationGetter(delegation.delegator);
      if (currentReputation < delegation.requiredReputation) {
        this.delegations.delete(userKey);
        // Persist the removal
        if (this.onDelegationChange) {
          this.onDelegationChange(null, userKey);
        }
        throw new Error(
          `Delegator reputation dropped below threshold: ` +
          `${currentReputation.toFixed(2)} < ${delegation.requiredReputation}`
        );
      }
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

    const payloadHash = Crypto.hashObject(ticketPayload);
    const signature = await this.witness.timestamp(payloadHash);

    // Consume delegation (one-time use)
    this.delegations.delete(userKey);

    // Persist the removal (delegation consumed)
    if (this.onDelegationChange) {
      this.onDelegationChange(null, userKey);
    }

    console.log(
      `[TicketBooth] 🎫 Minted delegated ticket for ${userKey.slice(0, 8)} ` +
      `(from ${delegation.delegator.slice(0, 8)})`
    );

    return {
      owner: userKey,
      expiry: delegation.expiry,
      durationHours,
      ticketType: 'delegated' as const,
      delegationProof: delegation.signature,
      delegatedFrom: delegation.delegator,
      proof: delegation.signature, // Backwards compatibility
      signature
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
      // Persist the removal
      if (this.onDelegationChange) {
        this.onDelegationChange(null, userPublicKey);
      }
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