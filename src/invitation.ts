/**
 * Invitation System - Freebird-based trust bootstrapping
 *
 * Key insight: Your invitation chain IS your initial trust graph.
 *
 * Freebird provides:
 * - Proof you were invited (VOPRF token)
 * - Privacy-preserving (issuer can't see who invited whom)
 * - Sybil resistance (can't spam create identities)
 *
 * Invitation flow:
 * 1. Alice has Freebird token → can create invitation
 * 2. Alice generates invitation for Bob
 * 3. Bob accepts invitation → gets Freebird token
 * 4. Alice auto-trusts Bob (based on settings)
 * 5. Bob can now invite Charlie
 */

import { Crypto } from './crypto.js';
import type { PublicKey, FreebirdClient, WitnessClient, Attestation } from './types.js';
import type { TrustSignal } from './clout-types.js';

/**
 * Signing function type - signs a message and returns the signature
 */
export type SigningFunction = (message: Uint8Array) => Uint8Array;

/**
 * Invitation package
 */
export interface Invitation {
  /** Inviter's public key */
  readonly inviter: string;

  /** Invitee's public key */
  readonly invitee: string;

  /** Freebird token for invitee (proof of invitation) */
  readonly token: Uint8Array;

  /** Witness timestamp (proves when invitation was created) */
  readonly proof: Attestation;

  /** Invitation code (for sharing) */
  readonly code: string;

  /** Expiration timestamp (optional) */
  readonly expiresAt?: number;

  /** Metadata */
  readonly metadata?: {
    message?: string;
    maxUses?: number;
  };
}

/**
 * Invitation manager
 */
export class InvitationManager {
  private readonly freebird: FreebirdClient;
  private readonly witness: WitnessClient;
  private readonly myPublicKey: string;
  private readonly sign: SigningFunction;

  // Track created and accepted invitations
  private readonly createdInvitations = new Map<string, Invitation>();
  private readonly acceptedInvitations = new Map<string, Invitation>();

  constructor(
    publicKey: PublicKey,
    freebird: FreebirdClient,
    witness: WitnessClient,
    sign: SigningFunction
  ) {
    this.myPublicKey = Crypto.toHex(publicKey.bytes);
    this.freebird = freebird;
    this.witness = witness;
    this.sign = sign;
  }

  /**
   * Create an invitation for someone
   *
   * Generates a Freebird token for the invitee.
   */
  async createInvitation(
    inviteePublicKey: string,
    options?: {
      message?: string;
      expiresIn?: number;  // Milliseconds
      maxUses?: number;
    }
  ): Promise<Invitation> {
    // Generate Freebird token for invitee
    const inviteeKey: PublicKey = {
      bytes: Crypto.fromHex(inviteePublicKey)
    };

    // Blind invitee's public key
    const blinded = await this.freebird.blind(inviteeKey);

    // Issue token
    const token = await this.freebird.issueToken(blinded);

    // Create invitation package
    const invitationData = {
      inviter: this.myPublicKey,
      invitee: inviteePublicKey,
      token: Crypto.toHex(token),
      timestamp: Date.now()
    };

    // Timestamp invitation with Witness (deterministic hash)
    const proof = await this.witness.timestamp(
      Crypto.hashObject(invitationData)
    );

    // Generate invitation code (base64 URL-safe)
    const code = this.generateInvitationCode(inviteePublicKey, token);

    const invitation: Invitation = {
      inviter: this.myPublicKey,
      invitee: inviteePublicKey,
      token,
      proof,
      code,
      expiresAt: options?.expiresIn ? Date.now() + options.expiresIn : undefined,
      metadata: {
        message: options?.message,
        maxUses: options?.maxUses || 1
      }
    };

    // Store invitation
    this.createdInvitations.set(code, invitation);

    console.log(
      `[Invitation] Created invitation for ${inviteePublicKey.slice(0, 8)} ` +
      `(code: ${code.slice(0, 12)}...)`
    );

    return invitation;
  }

  /**
   * Accept an invitation
   *
   * Verifies the Freebird token and stores the invitation.
   * The invitation token becomes YOUR token for posting.
   */
  async acceptInvitation(code: string): Promise<{
    invitation: Invitation;
    trustSignal: TrustSignal;
    token: Uint8Array; // The Freebird token you can use for posting
  }> {
    // Decode invitation code
    const invitation = this.decodeInvitationCode(code);

    if (!invitation) {
      throw new Error('Invalid invitation code');
    }

    // Check if invitation is for us
    if (invitation.invitee !== this.myPublicKey) {
      throw new Error('Invitation is not for this identity');
    }

    // Check expiration
    if (invitation.expiresAt && Date.now() > invitation.expiresAt) {
      throw new Error('Invitation has expired');
    }

    // Verify Freebird token
    const tokenValid = await this.freebird.verifyToken(invitation.token);
    if (!tokenValid) {
      throw new Error('Invalid invitation token');
    }

    // Verify Witness proof
    const proofValid = await this.witness.verify(invitation.proof);
    if (!proofValid) {
      throw new Error('Invalid invitation proof');
    }

    // Store accepted invitation
    this.acceptedInvitations.set(code, invitation);

    // Create trust signal for inviter
    // (This will trigger auto-trust based on settings)
    const signaturePayload = `trust:${this.myPublicKey}:${invitation.inviter}:${Date.now()}`;
    const signatureMessage = new TextEncoder().encode(signaturePayload);
    const signature = this.sign(signatureMessage);

    const trustSignal: TrustSignal = {
      truster: this.myPublicKey,
      trustee: invitation.inviter,
      signature,
      proof: await this.witness.timestamp(
        Crypto.hashString(`${this.myPublicKey}:ACCEPT:${invitation.inviter}`)
      )
    };

    console.log(
      `[Invitation] ✅ Accepted invitation from ${invitation.inviter.slice(0, 8)} ` +
      `and received token for posting`
    );

    // Return the token - this is YOUR token now, you can use it to post
    return { invitation, trustSignal, token: invitation.token };
  }

  /**
   * Generate invitation code
   *
   * Format: base64(inviter:invitee:token:proof)
   */
  private generateInvitationCode(inviteeKey: string, token: Uint8Array): string {
    const data = {
      i: inviteeKey,
      t: Crypto.toHex(token)
    };

    const json = JSON.stringify(data);
    const encoded = Buffer.from(json).toString('base64url');
    return encoded;
  }

  /**
   * Decode invitation code
   */
  private decodeInvitationCode(code: string): Invitation | null {
    try {
      const json = Buffer.from(code, 'base64url').toString('utf-8');
      const data = JSON.parse(json);

      // Look up in created invitations
      const stored = this.createdInvitations.get(code);
      if (stored) {
        return stored;
      }

      // Reconstruct from code (simplified - needs more data)
      // For now, return null if not in storage
      return null;
    } catch (error) {
      console.warn('[Invitation] Failed to decode code:', error);
      return null;
    }
  }

  /**
   * Get all created invitations
   */
  getCreatedInvitations(): Invitation[] {
    return Array.from(this.createdInvitations.values());
  }

  /**
   * Get all accepted invitations
   */
  getAcceptedInvitations(): Invitation[] {
    return Array.from(this.acceptedInvitations.values());
  }

  /**
   * Get invitation chain (who invited us, and who we invited)
   */
  getInvitationChain(): {
    invitedBy?: string;
    invited: string[];
  } {
    // Who invited us (should be only one)
    const accepted = Array.from(this.acceptedInvitations.values());
    const invitedBy = accepted.length > 0 ? accepted[0].inviter : undefined;

    // Who we invited
    const invited = Array.from(this.createdInvitations.values())
      .map(inv => inv.invitee);

    return { invitedBy, invited };
  }

  /**
   * Check if we can invite
   *
   * Requires having been invited ourselves (Freebird token).
   */
  canInvite(): boolean {
    return this.acceptedInvitations.size > 0;
  }
}
