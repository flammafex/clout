/**
 * Trust Module - Social graph management and trust signals
 *
 * Handles:
 * - Trust/untrust operations with encrypted signals
 * - Protocol-level mutual revocation
 * - Reputation queries
 * - P2P peer connection management (blob growth/shrinkage)
 */

import { Crypto } from '../crypto.js';
import { buildCanonicalPlaintextTrust, signPlaintextTrustPayloadHash } from '../trust/plaintext-signal.js';
import type { CloutStateManager } from '../chronicle/clout-state.js';
import type { CloutNode } from '../network/clout-node.js';
import type { ReputationValidator } from '../reputation.js';
import type { WitnessClient } from '../types.js';
import type { ContentGossip } from '../post.js';
import {
  type TrustSignal,
  type EncryptedTrustSignal,
  type ReputationScore,
  type CloutProfile,
  DEFAULT_TRUST_SETTINGS
} from '../clout-types.js';

export interface TrustConfig {
  publicKey: string;
  privateKey: Uint8Array;
  witness: WitnessClient;
  gossip?: ContentGossip;
  state: CloutStateManager;
  trustGraph: Set<string>;
  reputationValidator: ReputationValidator;
  useEncryptedTrustSignals: boolean;
  getCloutNode: () => CloutNode | undefined;
}

export class CloutTrust {
  private readonly publicKeyHex: string;
  private readonly privateKey: Uint8Array;
  private readonly witness: WitnessClient;
  private readonly gossip?: ContentGossip;
  private readonly state: CloutStateManager;
  private readonly trustGraph: Set<string>;
  private readonly reputationValidator: ReputationValidator;
  private readonly useEncryptedTrustSignals: boolean;
  private readonly getCloutNode: () => CloutNode | undefined;

  constructor(config: TrustConfig) {
    this.publicKeyHex = config.publicKey;
    this.privateKey = config.privateKey;
    this.witness = config.witness;
    this.gossip = config.gossip;
    this.state = config.state;
    this.trustGraph = config.trustGraph;
    this.reputationValidator = config.reputationValidator;
    this.useEncryptedTrustSignals = config.useEncryptedTrustSignals;
    this.getCloutNode = config.getCloutNode;
  }

  /**
   * Handle incoming plaintext trust signal
   *
   * Protocol-level mutual revocation: If someone revokes trust in us,
   * we automatically revoke trust in them. Both blobs shrink together.
   */
  async handleTrustSignal(signal: TrustSignal): Promise<void> {
    // Check if this is a revocation where we are the trustee
    const isRevocation = signal.revoked || signal.weight === 0;
    const isAboutUs = signal.trustee === this.publicKeyHex;

    if (isRevocation && isAboutUs) {
      console.log(`[Clout] 👋 ${signal.truster.slice(0, 8)} left your circle`);

      // Mutual revocation: if we trust them, revoke back
      if (this.trustGraph.has(signal.truster)) {
        console.log(`[Clout] 🔄 Reciprocating - removing ${signal.truster.slice(0, 8)} from your circle`);
        await this.revokeTrust(signal.truster);
      }
    }

    // Also update reputation validator with the signal
    this.reputationValidator.addTrustSignal(signal);
  }

  /**
   * Handle incoming encrypted trust signal
   *
   * Protocol-level mutual revocation: Try to decrypt (only succeeds if we're the trustee),
   * and if it's a revocation, automatically revoke trust in the truster.
   */
  async handleEncryptedTrustSignal(signal: EncryptedTrustSignal): Promise<void> {
    // Try to decrypt - only succeeds if we're the trustee
    const decrypted = Crypto.decryptTrustSignal(
      signal.encryptedTrustee,
      signal.trusteeCommitment,
      signal.truster,
      signal.signature,
      signal.weight ?? 1.0,
      signal.proof.timestamp,
      this.privateKey,
      Crypto.fromHex(this.publicKeyHex)
    );

    if (!decrypted) {
      // We're not the trustee, or decryption failed - ignore
      return;
    }

    // We successfully decrypted - we ARE the trustee
    const isRevocation = signal.revoked || signal.weight === 0;

    if (isRevocation) {
      console.log(`[Clout] 👋 ${signal.truster.slice(0, 8)} left your circle (encrypted signal)`);

      // Mutual revocation: if we trust them, revoke back
      if (this.trustGraph.has(signal.truster)) {
        console.log(`[Clout] 🔄 Reciprocating - removing ${signal.truster.slice(0, 8)} from your circle`);
        await this.revokeTrust(signal.truster);
      }
    } else {
      // It's a trust signal directed at us - someone just trusted us!
      // This creates an incoming trust request that requires consent
      console.log(`[Clout] 📨 ${signal.truster.slice(0, 8)} sent you a trust request`);
      // Trust requests are handled by the browser-side consent flow
    }
  }

  /**
   * Trust another agent (Follow)
   * @param trusteeKey - Public key of the user to trust
   * @param weight - Trust weight between 0.1 and 1.0 (default: 1.0)
   */
  async trust(trusteeKey: string, weight: number = 1.0): Promise<void> {
    // Validate weight
    if (weight < 0.1 || weight > 1.0) {
      throw new Error('Trust weight must be between 0.1 and 1.0');
    }

    // 1. Update local graph immediately
    this.trustGraph.add(trusteeKey);

    // 2. Propagate Trust Signal
    if (this.gossip) {
      const timestamp = Date.now();

      if (this.useEncryptedTrustSignals) {
        // Privacy-preserving encrypted trust signal
        const encrypted = Crypto.createEncryptedTrustSignal(
          this.privateKey,
          this.publicKeyHex,
          trusteeKey,
          weight,
          timestamp
        );

        // Get witness proof for the commitment (not the trustee identity)
        const proof = await this.witness.timestamp(encrypted.trusteeCommitment);

        const encryptedSignal: EncryptedTrustSignal = {
          truster: this.publicKeyHex,
          trusteeCommitment: encrypted.trusteeCommitment,
          encryptedTrustee: encrypted.encryptedTrustee,
          signature: encrypted.signature,
          proof,
          weight,
          version: 'encrypted-v1'
        };

        await this.gossip.publish({
          type: 'trust-encrypted',
          encryptedTrustSignal: encryptedSignal,
          timestamp
        });

        // Store locally with decrypted trustee (we know who we trusted)
        const localSignal: TrustSignal = {
          truster: this.publicKeyHex,
          trustee: trusteeKey,
          signature: encrypted.signature,
          proof,
          weight
        };
        this.state.addTrustSignal(localSignal);

        console.log(`[Clout] 🔐 Trusted ${trusteeKey.slice(0, 8)} (encrypted signal)`);
      } else {
        // Plaintext trust signal (public social graph)
        const canonical = buildCanonicalPlaintextTrust({
          truster: this.publicKeyHex,
          trustee: trusteeKey,
          weight,
          timestamp
        });
        if (!canonical) {
          throw new Error('Invalid plaintext trust signal payload');
        }
        const signature = signPlaintextTrustPayloadHash(canonical.payloadHash, this.privateKey);
        const proof = await this.witness.timestamp(canonical.payloadHash);

        const signal: TrustSignal = {
          truster: this.publicKeyHex,
          trustee: trusteeKey,
          signature,
          timestamp,
          proof,
          weight: canonical.canonicalWeight,
          revoked: canonical.isRevocation ? true : undefined
        };

        await this.gossip.publish({
          type: 'trust',
          trustSignal: signal,
          timestamp
        });

        this.state.addTrustSignal(signal);
        console.log(`[Clout] 🤝 Trusted ${trusteeKey.slice(0, 8)} (plaintext signal)`);
      }

      // Update the profile in the state to reflect the new trust graph
      this.state.updateProfile({
        publicKey: this.publicKeyHex,
        trustGraph: this.trustGraph,
        trustSettings: this.state.getState().profile?.trustSettings || DEFAULT_TRUST_SETTINGS
      });
    }

    // 3. Trigger P2P connection to grow the Chronicle blob
    const cloutNode = this.getCloutNode();
    if (cloutNode) {
      console.log(`[Clout] 🫧 Growing blob - connecting to ${trusteeKey.slice(0, 8)}...`);
      await cloutNode.updateTrustGraph(this.trustGraph);
    }
  }

  /**
   * Revoke trust from a previously trusted user (Unfollow)
   */
  async revokeTrust(trusteeKey: string): Promise<void> {
    // 1. Check if we actually trust this user
    if (!this.trustGraph.has(trusteeKey)) {
      throw new Error(`Cannot revoke trust: ${trusteeKey.slice(0, 8)} is not in trust graph`);
    }

    // 2. Remove from local graph immediately
    this.trustGraph.delete(trusteeKey);

    // 3. Create and publish revocation signal
    if (this.gossip) {
      const timestamp = Date.now();

      if (this.useEncryptedTrustSignals) {
        // Privacy-preserving encrypted revocation signal
        const encrypted = Crypto.createEncryptedTrustSignal(
          this.privateKey,
          this.publicKeyHex,
          trusteeKey,
          0, // Weight 0 indicates revocation
          timestamp
        );

        // Get witness proof for the commitment
        const proof = await this.witness.timestamp(encrypted.trusteeCommitment);

        const encryptedSignal: EncryptedTrustSignal = {
          truster: this.publicKeyHex,
          trusteeCommitment: encrypted.trusteeCommitment,
          encryptedTrustee: encrypted.encryptedTrustee,
          signature: encrypted.signature,
          proof,
          weight: 0, // Weight 0 = revocation
          version: 'encrypted-v1'
        };

        await this.gossip.publish({
          type: 'trust-encrypted',
          encryptedTrustSignal: encryptedSignal,
          timestamp
        });

        // Store revocation locally
        const localSignal: TrustSignal = {
          truster: this.publicKeyHex,
          trustee: trusteeKey,
          signature: encrypted.signature,
          proof,
          weight: 0,
          revoked: true
        };
        this.state.addTrustSignal(localSignal);

        console.log(`[Clout] 🔓 Revoked trust for ${trusteeKey.slice(0, 8)} (encrypted signal)`);
      } else {
        // Plaintext revocation signal (public social graph)
        const canonical = buildCanonicalPlaintextTrust({
          truster: this.publicKeyHex,
          trustee: trusteeKey,
          weight: 0,
          revoked: true,
          timestamp
        });
        if (!canonical) {
          throw new Error('Invalid plaintext trust revocation payload');
        }
        const signature = signPlaintextTrustPayloadHash(canonical.payloadHash, this.privateKey);
        const proof = await this.witness.timestamp(canonical.payloadHash);

        const signal: TrustSignal = {
          truster: this.publicKeyHex,
          trustee: trusteeKey,
          signature,
          timestamp,
          proof,
          weight: canonical.canonicalWeight,
          revoked: canonical.isRevocation ? true : undefined
        };

        await this.gossip.publish({
          type: 'trust',
          trustSignal: signal,
          timestamp
        });

        this.state.addTrustSignal(signal);
        console.log(`[Clout] 🔓 Revoked trust for ${trusteeKey.slice(0, 8)} (plaintext signal)`);
      }

      // Update the profile in the state to reflect the updated trust graph
      this.state.updateProfile({
        publicKey: this.publicKeyHex,
        trustGraph: this.trustGraph,
        trustSettings: this.state.getState().profile?.trustSettings || DEFAULT_TRUST_SETTINGS
      });
    }

    // 4. Trigger P2P disconnection - shrink the Chronicle blob
    const cloutNode = this.getCloutNode();
    if (cloutNode) {
      console.log(`[Clout] 🔌 Shrinking blob - disconnecting from ${trusteeKey.slice(0, 8)}...`);
      await cloutNode.updateTrustGraph(this.trustGraph);
    }
  }

  /**
   * Create an invitation for another user
   */
  async invite(guestPublicKey: string, params: any): Promise<{ code: Uint8Array }> {
    const code = Crypto.randomBytes(32);
    await this.trust(guestPublicKey);
    return { code };
  }

  /**
   * Accept an invitation
   */
  async acceptInvitation(code: Uint8Array): Promise<Uint8Array> {
    return code;
  }

  /**
   * Get reputation score for a user
   */
  getReputation(publicKey: string): ReputationScore {
    return this.reputationValidator.computeReputation(publicKey);
  }

  /**
   * Get trust path to a user (for "Via Alice → Bob" display)
   */
  getTrustPath(publicKey: string): { path: string[]; distance: number } | null {
    return this.reputationValidator.getTrustPath(publicKey);
  }

  /**
   * Check if user is directly trusted (1 hop)
   */
  isDirectlyTrusted(publicKey: string): boolean {
    return this.reputationValidator.isDirectlyTrusted(publicKey);
  }

  /**
   * Get the trust weight for a directly trusted user
   */
  getTrustWeight(publicKey: string): number | null {
    if (!this.trustGraph.has(publicKey)) {
      return null;
    }

    const state = this.state.getState();
    const signal = state.myTrustSignals?.find(s => s.trustee === publicKey);
    return signal?.weight ?? 1.0;
  }

  /**
   * Get the trust graph
   */
  getTrustGraph(): Set<string> {
    return this.trustGraph;
  }
}
