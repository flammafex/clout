/**
 * InvitationRedemption - Cohesive invitation redemption state machine
 *
 * Owns the in-memory state for invitation redemption:
 * - invitationCodeToInviter: Map<code, inviterPublicKey>
 * - invitationCodeToSignature: Map<code, signature>
 * - usedInvitationCodes: Set<code>
 * - pendingInvitationClaims: Map<code, { publicKey, signature, claimedAt, inviter }>
 *
 * The redemption flow (reserve → mint → consume) is the highest-risk
 * state machine in Clout. All mutations to pending/used state go through
 * this module to preserve invariants:
 *
 * 1. Single pending claimant per code (409 on conflict)
 * 2. Used codes can't be reused (reject on consume)
 * 3. consume() mutates state synchronously before first await
 * 4. First redeemer becomes owner (via OwnerRegistry)
 * 5. Bidirectional auto-trust on consume
 * 6. 15-minute pending claim expiry
 *
 * Extracted from CloutWebServer as part of Tier 3 Phase 3 decomposition.
 */

import { createFreebirdAdminFromEnv } from '../integrations/freebird-admin.js';
import type { InvitationRedemptionStore } from '../store/invitation-redemption-store.js';
import type { OwnerRegistry } from './owner-registry.js';
import type { UserDataStore } from '../store/user-data-store.js';
import type { FileSystemStore } from '../store/file-store.js';

export interface PendingClaim {
  publicKey: string;
  signature: string;
  claimedAt: number;
  inviter?: string;
}

export interface InvitationRedemptionConfig {
  readonly store: InvitationRedemptionStore;
  readonly ownerRegistry: OwnerRegistry;
  readonly userDataStore: UserDataStore;
  readonly getFileSystemStore: () => FileSystemStore | undefined;
  readonly getServerPublicKey: () => string | undefined;
  readonly isInitialized: () => boolean;
}

export class InvitationRedemption {
  // In-memory state — all mutations go through this module
  private readonly invitationCodeToInviter = new Map<string, string>();
  private readonly invitationCodeToSignature = new Map<string, string>();
  private readonly usedInvitationCodes = new Set<string>();
  private readonly pendingInvitationClaims = new Map<string, PendingClaim>();

  private readonly store: InvitationRedemptionStore;
  private readonly ownerRegistry: OwnerRegistry;
  private readonly userDataStore: UserDataStore;
  private readonly getFileSystemStore: () => FileSystemStore | undefined;
  private readonly getServerPublicKey: () => string | undefined;
  private readonly isInitializedFn: () => boolean;

  constructor(config: InvitationRedemptionConfig) {
    this.store = config.store;
    this.ownerRegistry = config.ownerRegistry;
    this.userDataStore = config.userDataStore;
    this.getFileSystemStore = config.getFileSystemStore;
    this.getServerPublicKey = config.getServerPublicKey;
    this.isInitializedFn = config.isInitialized;
  }

  /**
   * Load invitation-to-inviter and invitation-to-signature mappings from file.
   * Called on startup to restore state after restart.
   */
  loadMappings(): void {
    console.log(`[Bootstrap] Looking for invitations at: ${this.store.getFilePath()}`);

    const data = this.store.load();
    if (!data) {
      console.warn(`[Bootstrap] ⚠️ invitations.json not found`);
      console.warn(`[Bootstrap] ⚠️ Set CLOUT_DATA_DIR to the correct directory or regenerate invitations`);
      return;
    }

    const inviter = data.inviter;
    const invitations = data.invitations || [];
    const codes = data.codes || [];
    const usedCodes = data.usedCodes || [];

    console.log(`[Bootstrap] Found invitations.json: inviter=${inviter ? 'present' : 'MISSING'}, invitations=${invitations.length}, codes=${codes.length}, usedCodes=${usedCodes.length}`);

    // Load used codes
    for (const code of usedCodes) {
      this.usedInvitationCodes.add(code);
    }
    if (usedCodes.length > 0) {
      console.log(`[Bootstrap] Loaded ${usedCodes.length} previously used invitation codes`);
    }

    // Load from new format (with signatures)
    if (invitations.length > 0) {
      let withSig = 0;
      let withoutSig = 0;
      for (const inv of invitations) {
        if (inv.code && inviter) {
          this.invitationCodeToInviter.set(inv.code, inviter);
        }
        if (inv.code && inv.signature) {
          this.invitationCodeToSignature.set(inv.code, inv.signature);
          withSig++;
        } else {
          withoutSig++;
        }
      }
      console.log(`[Bootstrap] Loaded ${invitations.length} invitation code mappings (${withSig} with signatures, ${withoutSig} without)`);
    } else if (inviter && codes.length > 0) {
      // Fallback to old format (without signatures) - signatures won't work
      for (const code of codes) {
        this.invitationCodeToInviter.set(code, inviter);
      }
      console.log(`[Bootstrap] Loaded ${codes.length} invitation code mappings (legacy format, no signatures)`);
      console.warn(`[Bootstrap] ⚠️ Invitations were stored without signatures. They may not work with Freebird.`);
      console.warn(`[Bootstrap] ⚠️ Delete invitations.json and restart to regenerate with signatures.`);
    }
  }

  /**
   * Register a new invitation code (called when admin/member creates one).
   */
  registerInvitation(code: string, inviterPublicKey: string, signature?: string): void {
    this.invitationCodeToInviter.set(code, inviterPublicKey);
    if (signature) {
      this.invitationCodeToSignature.set(code, signature);
    }
    console.log(`[Server] Registered invitation ${code.slice(0, 8)}... from ${inviterPublicKey.slice(0, 16)}...`);
  }

  /**
   * Decode an invitation code to get inviter info.
   * Called before redemption so the browser can create a trust signal.
   */
  decode(code: string): { code: string; hasInviter: boolean; inviter: string | null } {
    // Resolve the inviter: local map → resolve server identity to owner → fall back to owner.
    let inviterKey = this.invitationCodeToInviter.get(code);
    const serverIdentity = this.getServerPublicKey();
    if (inviterKey && inviterKey === serverIdentity && this.ownerRegistry.get()) {
      inviterKey = this.ownerRegistry.get();
    }
    if (!inviterKey || inviterKey === serverIdentity) {
      inviterKey = this.ownerRegistry.get();
    }

    return {
      code,
      hasInviter: !!inviterKey,
      inviter: inviterKey || null
    };
  }

  /**
   * Reserve an invitation code for redemption (the "redeem" step).
   * Stores a pending claim that must be consumed after Day Pass mint.
   *
   * @returns { message, inviter } on success, or throws with an error message.
   */
  async reserve(code: string, publicKey: string): Promise<{ message: string; inviter: string | null }> {
    // Check if this invitation code has already been used
    if (this.usedInvitationCodes.has(code)) {
      console.warn(`[Server] Invitation ${code.slice(0, 8)}... already used, rejecting`);
      throw new InvitationError('This invitation code has already been used', 400);
    }

    // Enforce a single pending claimant per invitation code
    this.cleanupExpiredPendingClaims();
    const existingClaim = this.pendingInvitationClaims.get(code);
    if (existingClaim && existingClaim.publicKey !== publicKey) {
      throw new InvitationError('This invitation code is currently being redeemed by another user', 409);
    }

    // Require initialized infrastructure
    if (!this.isInitializedFn()) {
      throw new InvitationError('Clout not initialized', 400);
    }

    // Get the signature for this code
    let signature = this.invitationCodeToSignature.get(code);
    if (!signature) {
      console.warn(`[Server] No cached signature for invitation ${code.slice(0, 8)}..., checking Freebird admin API`);

      // Fallback: fetch invitation details directly from Freebird admin.
      const freebirdAdmin = createFreebirdAdminFromEnv();
      if (freebirdAdmin) {
        try {
          const resolvedSignature = await freebirdAdmin.resolveInvitationSignatureByCode(code);
          if (resolvedSignature) {
            signature = resolvedSignature;
            this.invitationCodeToSignature.set(code, signature);
            console.log(`[Server] Resolved invitation signature from Freebird admin for ${code.slice(0, 8)}...`);
          }
        } catch (lookupError: any) {
          console.warn(`[Server] Failed to resolve invitation signature from Freebird admin: ${lookupError.message}`);
        }
      }
    }

    if (!signature) {
      throw new InvitationError('Invitation signature is missing for this code', 400);
    }

    // Resolve the inviter for this code.
    let inviterKey = this.invitationCodeToInviter.get(code);
    const serverIdentity = this.getServerPublicKey();
    // Bootstrap invitations store the server identity as inviter — resolve to the owner's browser key.
    if (inviterKey && inviterKey === serverIdentity && this.ownerRegistry.get()) {
      inviterKey = this.ownerRegistry.get();
    }
    // If inviter is still the server identity (owner not set yet) or unknown, fall back to owner.
    if (!inviterKey || inviterKey === serverIdentity) {
      inviterKey = this.ownerRegistry.get();
    }

    this.pendingInvitationClaims.set(code, {
      publicKey,
      signature,
      claimedAt: Date.now(),
      inviter: inviterKey
    });
    console.log(`[Server] Invitation ${code.slice(0, 8)}... reserved by ${publicKey.slice(0, 16)}... (inviter: ${inviterKey?.slice(0, 16) || 'unknown'}...)`);

    return {
      message: 'Invitation code accepted. Complete Day Pass mint to finalize redemption.',
      inviter: inviterKey || null
    };
  }

  /**
   * Get invitation signature only if the code is reserved for this user.
   * Called by the Freebird proxy during VOPRF issuance.
   */
  getReservedSignature(code: string, publicKey: string): string | null {
    this.cleanupExpiredPendingClaims();
    const claim = this.pendingInvitationClaims.get(code);
    if (!claim || claim.publicKey !== publicKey) {
      return null;
    }
    return claim.signature;
  }

  /**
   * Consume an invitation code after successful token issuance + Day Pass mint.
   * This is the final redemption step that prevents code burn on failed onboarding.
   *
   * CRITICAL: All state mutations happen synchronously before the first await
   * (the auto-trust call) to preserve atomicity.
   */
  async consume(code: string, redeemerPublicKey: string): Promise<boolean> {
    console.log(`[Server] consumeInvitationCode called: code=${code.slice(0, 8)}... redeemer=${redeemerPublicKey.slice(0, 16)}...`);

    if (!code || !redeemerPublicKey) {
      console.warn(`[Server] consumeInvitationCode: missing code or publicKey`);
      return false;
    }

    if (this.usedInvitationCodes.has(code)) {
      console.warn(`[Server] consumeInvitationCode: code already used`);
      return false;
    }

    this.cleanupExpiredPendingClaims();
    const claim = this.pendingInvitationClaims.get(code);
    if (!claim || claim.publicKey !== redeemerPublicKey) {
      console.warn(`[Server] consumeInvitationCode: no matching pending claim (hasClaim=${!!claim})`);
      return false;
    }

    // === SYNCHRONOUS MUTATIONS (before any await) ===
    this.usedInvitationCodes.add(code);
    this.pendingInvitationClaims.delete(code);
    this.store.appendUsedCode(code, redeemerPublicKey);
    console.log(`[Server] Invitation ${code.slice(0, 8)}... finalized by ${redeemerPublicKey.slice(0, 16)}...`);

    const fileStore = this.getFileSystemStore();
    if (fileStore) {
      fileStore.markInvitationRedeemed(code, redeemerPublicKey);
    }

    // The first person to redeem any invitation on a fresh instance becomes the owner.
    if (!this.ownerRegistry.get()) {
      console.log(`[Server] First invitation redeemed on ownerless instance — setting owner`);
      this.ownerRegistry.setIfAbsent(redeemerPublicKey);
    }

    // === ASYNC SIDE EFFECTS (after state is persisted) ===
    // Bidirectional auto-trust: invitation implies mutual trust.
    let inviterKey = claim.inviter;

    // Final fallback: if inviter wasn't resolved at redeem time, use current owner.
    if (!inviterKey && this.ownerRegistry.get()) {
      inviterKey = this.ownerRegistry.get();
    }

    console.log(`[Server] Auto-trust: inviter=${inviterKey?.slice(0, 16) || 'none'}, redeemer=${redeemerPublicKey.slice(0, 16)}...`);

    if (inviterKey && redeemerPublicKey !== inviterKey) {
      try {
        // Invitee trusts inviter
        await this.userDataStore.trust(redeemerPublicKey, inviterKey);
        // Inviter trusts invitee
        await this.userDataStore.trust(inviterKey, redeemerPublicKey);
        console.log(`[Server] 🤝 Mutual trust established: ${inviterKey.slice(0, 8)}... <-> ${redeemerPublicKey.slice(0, 8)}...`);
      } catch (trustError: any) {
        console.warn(`[Server] Failed to auto-trust: ${trustError.message}`);
      }
    }

    return true;
  }

  /**
   * Remove stale pending invitation claims (15-minute expiry).
   */
  cleanupExpiredPendingClaims(): void {
    const now = Date.now();
    const maxPendingMs = 15 * 60 * 1000; // 15 minutes

    for (const [code, claim] of this.pendingInvitationClaims.entries()) {
      if (now - claim.claimedAt > maxPendingMs) {
        this.pendingInvitationClaims.delete(code);
      }
    }
  }

  /**
   * Get the redeemer public key for a bootstrap invitation code.
   */
  getBootstrapInvitationRedeemer(code: string): { redeemedBy: string; redeemedAt: number } | null {
    return this.store.getRedemption(code);
  }

  /**
   * Find which bootstrap invitation code a public key used.
   */
  findBootstrapInvitationByRedeemer(redeemerPublicKey: string): { code: string; redeemedAt: number } | null {
    return this.store.findByRedeemer(redeemerPublicKey);
  }

  /**
   * Resolve redeemed invitation code for a user (member-created or bootstrap).
   */
  getRedeemedInvitationCodeForUser(redeemerPublicKey: string): string | null {
    const fileStore = this.getFileSystemStore();
    if (fileStore) {
      const memberInvitation = fileStore.getInvitationByRedeemer(redeemerPublicKey);
      if (memberInvitation?.code) {
        return memberInvitation.code;
      }
    }
    const bootstrap = this.findBootstrapInvitationByRedeemer(redeemerPublicKey);
    return bootstrap?.code || null;
  }
}

/**
 * Error thrown by InvitationRedemption with an HTTP status code hint.
 */
export class InvitationError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'InvitationError';
    this.statusCode = statusCode;
  }
}
