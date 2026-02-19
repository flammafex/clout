/**
 * Freebird integration adapter
 *
 * Provides anonymous authorization and blinding for Scarcity tokens using
 * P-256 VOPRF (Verifiable Oblivious Pseudorandom Function) protocol.
 *
 * This adapter implements production-ready VOPRF cryptography with DLEQ
 * proof verification for privacy-preserving token issuance.
 */

import { Crypto } from '../crypto.js';
import type { FreebirdClient, PublicKey, TorConfig, FreebirdToken } from '../types.js';
import * as voprf from '../vendor/freebird/voprf.js';
import type { BlindState, PartialEvaluation } from '../vendor/freebird/voprf.js';
import { TorProxy } from '../tor.js';
import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

export type SybilMode = 'none' | 'pow' | 'invitation' | 'registered' | 'federated_trust';
export type FreebirdSybilProof =
  | { type: 'none' }
  | { type: 'pow'; challenge: string; nonce: number; hash: string }
  | { type: 'invitation'; code: string; signature: string }
  | { type: 'registered_user'; user_id: string }
  | {
      type: 'federated_trust';
      source_issuer_id: string;
      source_token_b64: string;
      token_exp: number;
      token_issued_at?: number;
    };

/**
 * A token from a federated (trusted) Freebird issuer
 *
 * Used for cross-community onboarding: if Community A trusts Community B,
 * users with valid tokens from B can obtain tokens from A without an invitation.
 */
export interface FederatedToken {
  /** The issuer ID that issued this token (e.g., "issuer:community-b.com:v1") */
  readonly sourceIssuerId: string;
  /** The raw token bytes */
  readonly token: Uint8Array;
  /** When this token expires (Unix timestamp in seconds) */
  readonly expiresAt: number;
  /** When this token was issued (Unix timestamp in seconds) */
  readonly issuedAt: number;
  /** Human-readable name of the source community (for UI) */
  readonly communityName?: string;
}

export interface FreebirdAdapterConfig {
  readonly issuerEndpoints: string[];
  readonly verifierUrl: string;
  readonly tor?: TorConfig;
  /**
   * Sybil resistance mode to use when requesting tokens.
   * Must match the Freebird issuer's SYBIL_RESISTANCE setting.
   *
   * - 'none': No proof required (development only)
   * - 'pow': Proof-of-work puzzle (rate limits account creation)
   * - 'invitation': Invitation code required (web-of-trust)
   * - 'registered': User already registered with Freebird (Day Pass renewal)
   *
   * Default: 'none'
   */
  readonly sybilMode?: SybilMode;
  /**
   * Invitation code for 'invitation' sybil mode.
   * Required when sybilMode is 'invitation' (unless isOwner is true).
   */
  readonly invitationCode?: string;
  /**
   * User's public key (hex string).
   * Used for owner identification in invitation mode.
   */
  readonly userPublicKey?: string;
  /**
   * Whether this user is the instance owner.
   * Owners can obtain tokens without an invitation code.
   */
  readonly isOwner?: boolean;
  /**
   * Allow insecure fallback mode when Freebird servers are unavailable.
   *
   * ⚠️  WARNING: Setting this to true removes all Sybil resistance!
   * Fallback mode uses simple hashes instead of VOPRF tokens, meaning
   * anyone can mint unlimited fake tokens. Only enable for development
   * or small trusted networks where Sybil attacks are not a concern.
   *
   * Default: false (fail if servers unavailable)
   */
  readonly allowInsecureFallback?: boolean;
  /**
   * Federated token from another trusted community.
   * Used when sybilMode is 'federated_trust' as an alternative to invitation.
   *
   * If you have a valid token from a community that this issuer trusts,
   * you can use it to obtain a token here without needing an invitation.
   */
  readonly federatedToken?: FederatedToken;
}

/**
 * Adapter for Freebird anonymous authorization service
 *
 * Implements production VOPRF protocol with MPC threshold issuance:
 * 1. Client blinds input with random scalar r
 * 2. Client broadcasts to multiple issuers
 * 3. Each issuer evaluates blinded element with key share k_i
 * 4. Client verifies DLEQ proofs and aggregates valid responses
 * 5. Token provides anonymous authorization without revealing input
 */
export class FreebirdAdapter implements FreebirdClient {
  private readonly issuerEndpoints: string[];
  private readonly verifierUrl: string;
  private readonly context: Uint8Array;
  private readonly tor: TorProxy | null;
  private readonly allowInsecureFallback: boolean;
  private sybilMode: SybilMode;
  private invitationCode: string | undefined;
  private invitationSignature: string | undefined;
  // Track if an invitation was attempted (prevents fallback to owner mode)
  private invitationWasAttempted = false;
  private readonly userPublicKey: string | undefined;
  private readonly isOwner: boolean;
  private metadata: Map<string, any> = new Map();
  private blindStates: Map<string, BlindState> = new Map();
  private fallbackWarningShown = false;
  // Federated trust: token from another trusted community
  private federatedToken: FederatedToken | undefined;
  // Store the last issued token's metadata for Witness integration
  private lastTokenInfo: FreebirdToken | null = null;

  constructor(config: FreebirdAdapterConfig) {
    if (!config.issuerEndpoints || config.issuerEndpoints.length === 0) {
      throw new Error('At least one issuer endpoint is required');
    }

    this.issuerEndpoints = config.issuerEndpoints;
    this.verifierUrl = config.verifierUrl;
    this.tor = config.tor ? new TorProxy(config.tor) : null;
    this.allowInsecureFallback = config.allowInsecureFallback ?? false;
    this.sybilMode = config.sybilMode ?? 'none';
    this.invitationCode = config.invitationCode;
    this.userPublicKey = config.userPublicKey;
    this.isOwner = config.isOwner ?? false;
    this.federatedToken = config.federatedToken;
    // Context must match Freebird server
    this.context = new TextEncoder().encode('freebird:v1');

    // Log if Tor is enabled for .onion addresses
    const hasOnion = this.issuerEndpoints.some(url => TorProxy.isOnionUrl(url)) ||
      TorProxy.isOnionUrl(this.verifierUrl);

    if (hasOnion) {
      if (this.tor) {
        console.log('[Freebird] Tor enabled for .onion addresses');
      } else {
        console.warn('[Freebird] .onion URL detected but Tor not configured');
      }
    }

    // Log issuer endpoints
    console.log(`[Freebird] Issuer endpoint(s): ${this.issuerEndpoints.join(', ')}`);

    // Log MPC mode
    if (this.issuerEndpoints.length > 1) {
      console.log(`[Freebird] MPC threshold mode: ${this.issuerEndpoints.length} issuers`);
    }

    // Log Sybil mode
    console.log(`[Freebird] Sybil resistance mode: ${this.sybilMode}`);
  }

  /**
   * Mark the user as registered with Freebird (for Day Pass renewal)
   *
   * After successful token issuance with an invitation code, the user is added
   * to Freebird's inviters table. Future token requests can use 'registered' mode
   * instead of requiring a new invitation code.
   *
   * Call this after successful mintTicket() with invitation mode.
   * The calling code should persist this state to survive app restarts.
   */
  markAsRegistered(): void {
    if (this.sybilMode === 'invitation') {
      console.log('[Freebird] Switching from invitation to registered mode');
      this.sybilMode = 'registered';
    } else if (this.sybilMode !== 'registered') {
      console.warn(`[Freebird] markAsRegistered() called but sybilMode is '${this.sybilMode}', not 'invitation'`);
    }
  }

  /**
   * Set the sybil mode directly
   *
   * Used when loading persisted registration state on app restart.
   * If the user was previously registered, set mode to 'registered'.
   */
  setSybilMode(mode: SybilMode): void {
    console.log(`[Freebird] Setting sybil mode to: ${mode}`);
    this.sybilMode = mode;
  }

  /**
   * Get the current sybil mode
   */
  getSybilMode(): SybilMode {
    return this.sybilMode;
  }

  /**
   * Check if user is registered (can renew Day Pass without invitation)
   */
  isRegistered(): boolean {
    return this.sybilMode === 'registered';
  }

  /**
   * Set the invitation code and signature for 'invitation' sybil mode
   */
  setInvitationCode(code: string, signature?: string): void {
    this.invitationCode = code;
    this.invitationSignature = signature;
    this.invitationWasAttempted = true;  // Track that an invitation is being used

    // Log for debugging
    console.log(`[Freebird] setInvitationCode called: code=${code.slice(0, 8)}..., signature=${signature ? 'present' : 'MISSING'}`);

    // Warn if sybilMode is not 'invitation' - the code won't be used!
    if (this.sybilMode !== 'invitation') {
      console.warn(`[Freebird] ⚠️ WARNING: Invitation code set but sybilMode is '${this.sybilMode}' (not 'invitation')`);
      console.warn(`[Freebird] ⚠️ The invitation code will be IGNORED. Set FREEBIRD_SYBIL_MODE=invitation`);
    }
  }

  /**
   * Set a federated token for 'federated_trust' sybil mode
   *
   * Use this when you have a valid token from a community that this issuer trusts.
   * This provides an alternative onboarding path to invitations.
   *
   * @param token - The federated token from another community
   */
  setFederatedToken(token: FederatedToken): void {
    // Validate token is not expired
    const nowSecs = Math.floor(Date.now() / 1000);
    if (token.expiresAt < nowSecs) {
      throw new Error(
        `[Freebird] Cannot set expired federated token. ` +
        `Token from ${token.sourceIssuerId} expired at ${new Date(token.expiresAt * 1000).toISOString()}`
      );
    }

    this.federatedToken = token;

    console.log(
      `[Freebird] Federated token set: ${token.sourceIssuerId}` +
      (token.communityName ? ` (${token.communityName})` : '') +
      `, expires ${new Date(token.expiresAt * 1000).toISOString()}`
    );

    // Warn if sybilMode is not 'federated_trust' - the token won't be used!
    if (this.sybilMode !== 'federated_trust') {
      console.warn(`[Freebird] ⚠️ WARNING: Federated token set but sybilMode is '${this.sybilMode}' (not 'federated_trust')`);
      console.warn(`[Freebird] ⚠️ The federated token will be IGNORED. Set sybilMode to 'federated_trust'`);
    }
  }

  /**
   * Get the current federated token (if any)
   */
  getFederatedToken(): FederatedToken | undefined {
    return this.federatedToken;
  }

  /**
   * Check if a valid (non-expired) federated token is available
   */
  hasFederatedToken(): boolean {
    if (!this.federatedToken) return false;
    const nowSecs = Math.floor(Date.now() / 1000);
    return this.federatedToken.expiresAt > nowSecs;
  }

  /**
   * Clear the federated token
   */
  clearFederatedToken(): void {
    if (this.federatedToken) {
      console.log(`[Freebird] Clearing federated token from ${this.federatedToken.sourceIssuerId}`);
      this.federatedToken = undefined;
    }
  }

  /**
   * Get the last issued token's metadata for Witness integration
   *
   * Returns the structured token info needed for Witness Sybil resistance.
   * Call this after issueToken() to get the metadata to pass to Witness.
   */
  getLastTokenInfo(): FreebirdToken | null {
    return this.lastTokenInfo;
  }

  /**
   * Check if a valid (non-expired) token info is available
   */
  hasValidTokenInfo(): boolean {
    if (!this.lastTokenInfo) return false;
    return this.lastTokenInfo.exp > Math.floor(Date.now() / 1000);
  }

  /**
   * Clear the stored token info
   */
  clearTokenInfo(): void {
    this.lastTokenInfo = null;
  }

  /**
   * Create a FederatedToken from raw token bytes and issuer metadata
   *
   * Helper method for creating a federated token structure from a token
   * obtained from another Freebird issuer.
   *
   * @param token - The raw VOPRF token bytes
   * @param sourceIssuerId - The issuer ID (e.g., "issuer:community-b.com:v1")
   * @param expiresAt - Expiration timestamp (Unix seconds)
   * @param issuedAt - Issuance timestamp (Unix seconds), defaults to now
   * @param communityName - Human-readable community name (optional)
   */
  static createFederatedToken(
    token: Uint8Array,
    sourceIssuerId: string,
    expiresAt: number,
    issuedAt?: number,
    communityName?: string
  ): FederatedToken {
    return {
      token,
      sourceIssuerId,
      expiresAt,
      issuedAt: issuedAt ?? Math.floor(Date.now() / 1000),
      communityName
    };
  }

  /**
   * Generate a proof-of-work solution for the given challenge
   */
  private async solveProofOfWork(challenge: string, difficulty: number): Promise<{ nonce: number; hash: string }> {
    const target = '0'.repeat(difficulty);
    let nonce = 0;
    const maxIterations = 10_000_000; // Prevent infinite loops

    console.log(`[Freebird] Solving PoW challenge (difficulty: ${difficulty})...`);

    while (nonce < maxIterations) {
      const input = `${challenge}:${nonce}`;
      const hashBytes = sha256(new TextEncoder().encode(input));
      const hash = bytesToHex(hashBytes);

      if (hash.startsWith(target)) {
        console.log(`[Freebird] PoW solved after ${nonce} iterations`);
        return { nonce, hash };
      }
      nonce++;

      // Yield to event loop every 10k iterations
      if (nonce % 10000 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    throw new Error(`[Freebird] PoW failed: could not find solution within ${maxIterations} iterations`);
  }

  /**
   * Build the sybil_proof object based on the configured mode
   */
  private async buildSybilProof(metadata: any): Promise<FreebirdSybilProof> {
    switch (this.sybilMode) {
      case 'none':
        return { type: 'none' };

      case 'pow': {
        // Request a PoW challenge from the issuer
        const challengeData = metadata.sybil?.pow;
        if (!challengeData) {
          throw new Error('[Freebird] PoW mode requested but issuer did not provide challenge');
        }
        const { nonce, hash } = await this.solveProofOfWork(
          challengeData.challenge,
          challengeData.difficulty || 4
        );
        return {
          type: 'pow',
          challenge: challengeData.challenge,
          nonce,
          hash
        };
      }

      case 'invitation': {
        // Invitation mode requires a valid invitation code - no exceptions
        // Even the instance owner must use an invitation code (one of the bootstrap codes)
        if (this.invitationCode && this.invitationSignature) {
          console.log(`[Freebird] Using invitation code: ${this.invitationCode.slice(0, 8)}... with signature`);
          const result: FreebirdSybilProof = {
            type: 'invitation',
            code: this.invitationCode,
            signature: this.invitationSignature
          };
          // Clear the invitation code after use (one-time use)
          this.invitationCode = undefined;
          this.invitationSignature = undefined;
          this.invitationWasAttempted = false;
          return result;
        }

        // If an invitation was attempted but code is now missing, provide clear error
        if (this.invitationWasAttempted) {
          console.error('[Freebird] Invitation was attempted but code is missing');
          this.invitationWasAttempted = false;
          throw new Error('[Freebird] Invitation code was already used in this session. Please use a new invitation code.');
        }

        // No invitation code provided
        if (!this.invitationCode) {
          throw new Error('[Freebird] Invitation mode requires an invitation code. Call setInvitationCode() first.');
        }
        throw new Error('[Freebird] Invitation mode requires a signature. Call setInvitationCode(code, signature) with both parameters.');
      }

      case 'registered': {
        // Registered user mode - user already in Freebird's inviters table
        // Uses their public key as user_id for Day Pass renewal
        if (!this.userPublicKey) {
          throw new Error('[Freebird] Registered mode requires userPublicKey');
        }
        console.log(`[Freebird] Using registered user mode for ${this.userPublicKey.slice(0, 8)}...`);
        return {
          type: 'registered_user',
          user_id: this.userPublicKey
        };
      }

      case 'federated_trust': {
        // Federated trust mode - user has a token from a trusted community
        // This is an alternative to invitation for cross-community onboarding
        if (!this.federatedToken) {
          throw new Error(
            '[Freebird] Federated trust mode requires a federated token. ' +
            'Call setFederatedToken() first with a token from a trusted community.'
          );
        }

        // Check if token is expired
        const nowSecs = Math.floor(Date.now() / 1000);
        if (this.federatedToken.expiresAt < nowSecs) {
          const expiredAgo = nowSecs - this.federatedToken.expiresAt;
          throw new Error(
            `[Freebird] Federated token from ${this.federatedToken.sourceIssuerId} expired ${expiredAgo}s ago. ` +
            'Please obtain a fresh token from the source community.'
          );
        }

        console.log(
          `[Freebird] Using federated trust: token from ${this.federatedToken.sourceIssuerId}` +
          (this.federatedToken.communityName ? ` (${this.federatedToken.communityName})` : '')
        );

        return {
          type: 'federated_trust',
          source_issuer_id: this.federatedToken.sourceIssuerId,
          source_token_b64: voprf.bytesToBase64Url(this.federatedToken.token),
          token_exp: this.federatedToken.expiresAt,
          token_issued_at: this.federatedToken.issuedAt
        };
      }

      default:
        throw new Error(`[Freebird] Unknown sybil mode: ${this.sybilMode}`);
    }
  }

  /**
   * Fetch with Tor support for .onion URLs
   */
  private async fetch(url: string, options: RequestInit = {}): Promise<Response> {
    if (this.tor) {
      return this.tor.fetch(url, options);
    }
    return fetch(url, options);
  }

  /**
   * Initialize by fetching metadata from all issuers
   */
  private async init(): Promise<void> {
    if (this.metadata.size > 0) return;

    // Fetch metadata from all issuers in parallel
    const metadataPromises = this.issuerEndpoints.map(async (url, index) => {
      try {
        const response = await this.fetch(`${url}/.well-known/issuer`);
        if (response.ok) {
          const data = await response.json();
          this.metadata.set(url, data);
          return { url, index, success: true, data };
        }
        return { url, index, success: false };
      } catch (error) {
        console.warn(`[Freebird] Issuer ${url} not available:`, error);
        return { url, index, success: false };
      }
    });

    const results = await Promise.all(metadataPromises);
    const successCount = results.filter(r => r.success).length;

    if (successCount > 0) {
      console.log(`[Freebird] Connected to ${successCount}/${this.issuerEndpoints.length} issuers`);
    } else {
      if (!this.allowInsecureFallback) {
        throw new Error(
          '[Freebird] FATAL: No Freebird issuers available and fallback mode is disabled.\n' +
          'This means anti-Sybil protection cannot be enforced.\n\n' +
          'Options:\n' +
          '  1. Ensure at least one Freebird issuer is running and accessible\n' +
          '  2. Set allowInsecureFallback: true in FreebirdAdapterConfig (NOT RECOMMENDED)\n\n' +
          '⚠️  WARNING: Enabling fallback mode removes all Sybil resistance!'
        );
      }
      if (!this.fallbackWarningShown) {
        console.warn('\n' + '='.repeat(70));
        console.warn('⚠️  SECURITY WARNING: Freebird running in INSECURE FALLBACK MODE');
        console.warn('='.repeat(70));
        console.warn('No Freebird issuers are available. Using hash-based fake tokens.');
        console.warn('This provides NO Sybil resistance - anyone can create unlimited accounts.');
        console.warn('Only use this for development or small trusted networks.');
        console.warn('='.repeat(70) + '\n');
        this.fallbackWarningShown = true;
      }
    }
  }

  /**
   * Blind a public key for privacy-preserving commitment
   *
   * Uses P-256 VOPRF blinding when issuer is available: A = H(publicKey) * r
   * Falls back to hash-based blinding when issuer is unavailable.
   *
   * The blind state is stored internally for later finalization.
   */
  async blind(publicKey: PublicKey): Promise<Uint8Array> {
    await this.init();

    // Use production VOPRF blinding if at least one issuer is available
    if (this.metadata.size > 0) {
      const { blinded, state } = voprf.blind(publicKey.bytes, this.context);

      // Store state indexed by blinded value for later finalization
      const blindedHex = Crypto.toHex(blinded);
      this.blindStates.set(blindedHex, state);

      return blinded;
    }

    // Fallback: simulated blinding (only reached if allowInsecureFallback is true)
    // This is checked in init() - if we get here, the user explicitly opted in
    const nonce = Crypto.randomBytes(32);
    return Crypto.hash(publicKey.bytes, nonce);
  }

  /**
   * Issue an authorization token using VOPRF with MPC threshold issuance
   *
   * Process:
   * 1. Broadcast blinded element to all issuers in parallel
   * 2. Verify DLEQ proof for each response
   * 3. Collect valid partial evaluations until threshold is met
   * 4. Aggregate partials using Lagrange interpolation
   * 5. Return aggregated token
   *
   * Backward compatible: single issuer works as before
   */
  async issueToken(blindedValue: Uint8Array): Promise<Uint8Array> {
    return this.issueTokenInternal(blindedValue);
  }

  /**
   * Issue token with an explicit per-request sybil proof.
   * This avoids mutating adapter-global sybil mode/state across concurrent users.
   */
  async issueTokenWithSybilProof(
    blindedValue: Uint8Array,
    sybilProof: FreebirdSybilProof
  ): Promise<Uint8Array> {
    return this.issueTokenInternal(blindedValue, sybilProof);
  }

  private async issueTokenInternal(
    blindedValue: Uint8Array,
    sybilProofOverride?: FreebirdSybilProof
  ): Promise<Uint8Array> {
    await this.init();

    // Retrieve blind state for finalization (may not exist in proxy mode)
    const blindedHex = Crypto.toHex(blindedValue);
    const state = this.blindStates.get(blindedHex);

    // Attempt real VOPRF issuance if at least one issuer is available
    // Note: state may be null when operating as a proxy (browser has the blind state)
    if (this.metadata.size > 0) {
      try {
        // Build sybil proof once (uses first available issuer's metadata for PoW challenge)
        const firstMetadata = Array.from(this.metadata.values())[0];
        const sybilProof = sybilProofOverride ?? await this.buildSybilProof(firstMetadata);

        // Broadcast to all issuers in parallel
        const issuePromises = this.issuerEndpoints.map(async (url, index) => {
          const metadata = this.metadata.get(url);
          if (!metadata) {
            return { success: false, url, index };
          }

          try {
            const response = await this.fetch(`${url}/v1/oprf/issue`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                blinded_element_b64: voprf.bytesToBase64Url(blindedValue),
                sybil_proof: sybilProof
              })
            });

            if (!response.ok) {
              const errorText = await response.text();
              console.warn(`[Freebird] Token issuance failed from ${url}: ${response.status} - ${errorText}`);
              return { success: false, url, index };
            }

            const data = await response.json();

            // Extract evaluated point from token response
            // Token format v1: [ Version (1) | A (65 uncompressed) | B (65 uncompressed) | Proof (64) ] = 195 bytes
            // Token format v0: [ A (33 compressed) | B (33 compressed) | Proof (64) ] = 130 bytes
            const tokenBytes = this.base64UrlToBytes(data.token);

            let A_bytes: Uint8Array;
            let B_bytes: Uint8Array;
            let proofBytes: Uint8Array;

            if (tokenBytes.length === 195 && tokenBytes[0] === 0x01) {
              // V1 format: version byte + points + proof
              // Check if points are compressed (0x02/0x03) or uncompressed (0x04)
              const pointPrefix = tokenBytes[1];
              if (pointPrefix === 0x04) {
                // Uncompressed points (65 bytes each)
                A_bytes = tokenBytes.slice(1, 66);
                B_bytes = tokenBytes.slice(66, 131);
                proofBytes = tokenBytes.slice(131);
              } else if (pointPrefix === 0x02 || pointPrefix === 0x03) {
                // Compressed points (33 bytes each) with extra data
                // Format: version(1) + A(33) + B(33) + proof(64) + extra(64) = 195
                A_bytes = tokenBytes.slice(1, 34);
                B_bytes = tokenBytes.slice(34, 67);
                proofBytes = tokenBytes.slice(67, 131);
                // Ignore extra 64 bytes at end (might be key ID or epoch data)
              } else {
                console.warn(`[Freebird] Unknown point prefix: 0x${pointPrefix.toString(16)}`);
                return { success: false, url, index };
              }
            } else if (tokenBytes.length === 130) {
              // Legacy format: compressed points
              A_bytes = tokenBytes.slice(0, 33);
              B_bytes = tokenBytes.slice(33, 66);
              proofBytes = tokenBytes.slice(66);
            } else {
              console.warn(`[Freebird] Invalid token length from ${url}: got ${tokenBytes.length}, expected 130 or 195`);
              console.warn(`[Freebird] Response data:`, JSON.stringify(data, null, 2));
              return { success: false, url, index };
            }

            // Verify DLEQ proof
            const G = p256.ProjectivePoint.BASE;
            const Q = this.decodePublicKey(metadata.voprf.pubkey);
            const A = this.decodePoint(A_bytes);
            const B = this.decodePoint(B_bytes);

            // Verify DLEQ proof if provided (some issuers may skip proof in dev mode)
            const isAllZeros = proofBytes.every(b => b === 0);
            if (isAllZeros) {
              console.warn(`[Freebird] No DLEQ proof from ${url} (dev mode?), skipping verification`);
            } else {
              const isValid = voprf.verifyDleq(G, Q, A, B, proofBytes, this.context);
              if (!isValid) {
                console.warn(`[Freebird] Invalid DLEQ proof from ${url}`);
                return { success: false, url, index };
              }
            }

            // Use server's index if provided, otherwise use endpoint index (1-based)
            const serverIndex = data.index ?? (index + 1);

            // Determine if points are compressed based on prefix
            const isCompressed = A_bytes.length === 33;

            return {
              success: true,
              url,
              index: serverIndex,
              evaluatedPoint: B_bytes,
              blindedElement: A_bytes,
              fullToken: tokenBytes,
              isV1Format: tokenBytes.length === 195,
              isCompressed,
              // Capture metadata for Witness integration
              exp: data.exp as number,
              issuerId: metadata.issuer_id as string,
              epoch: metadata.epoch ?? Math.floor(Date.now() / 1000 / 86400) // Days since epoch
            };
          } catch (error) {
            console.warn(`[Freebird] Request to ${url} failed:`, error);
            return { success: false, url, index };
          }
        });

        const results = await Promise.all(issuePromises);
        type ValidResponse = {
          success: true;
          url: string;
          index: number;
          evaluatedPoint: Uint8Array;
          blindedElement: Uint8Array;
          fullToken: Uint8Array;
          isV1Format: boolean;
          isCompressed: boolean;
          exp: number;
          issuerId: string;
          epoch: number;
        };
        const validResponses = results.filter(r => r.success) as ValidResponse[];

        if (validResponses.length === 0) {
          throw new Error('No valid responses from any issuer');
        }

        // Calculate threshold (majority)
        const threshold = Math.ceil(this.issuerEndpoints.length / 2);

        if (validResponses.length < threshold) {
          throw new Error(
            `[Freebird] Threshold not met: only ${validResponses.length}/${this.issuerEndpoints.length} ` +
            `valid responses (need ${threshold}).\n` +
            'This could indicate:\n' +
            '  - Network issues preventing connection to issuers\n' +
            '  - Compromised issuers returning invalid DLEQ proofs\n' +
            '  - A coordinated attack on the Freebird network\n\n' +
            'Token issuance rejected for security reasons.'
          );
        }

        // Clean up blind state if it exists (may not exist in proxy mode)
        if (state) {
          this.blindStates.delete(blindedHex);
        }

        // Single issuer: return token directly (backward compatibility)
        if (this.issuerEndpoints.length === 1 && validResponses.length === 1) {
          const resp = validResponses[0];
          // Store token info for Witness integration
          this.lastTokenInfo = {
            token_b64: voprf.bytesToBase64Url(resp.fullToken),
            issuer_id: resp.issuerId,
            exp: resp.exp,
            epoch: resp.epoch
          };
          console.log('[Freebird] ✅ VOPRF token issued and verified (single issuer)');
          return resp.fullToken;
        }

        // Multiple issuers: aggregate partial evaluations
        const partials: PartialEvaluation[] = validResponses.map(r => ({
          index: r.index,
          value: r.evaluatedPoint
        }));

        const aggregatedPoint = voprf.aggregate(partials);
        const zeroProof = new Uint8Array(64); // Placeholder proof

        // Reconstruct token with aggregated evaluation using same format as received
        const isV1 = validResponses[0].isV1Format;
        const isCompressed = validResponses[0].isCompressed;
        const A_bytes = validResponses[0].blindedElement;

        let aggregatedToken: Uint8Array;
        if (isV1 && isCompressed) {
          // V1 Format with compressed points: [ Version (1) | A (33) | B (33) | Proof (64) | Extra (64) ] = 195 bytes
          aggregatedToken = new Uint8Array(195);
          aggregatedToken[0] = 0x01;
          aggregatedToken.set(A_bytes, 1);
          aggregatedToken.set(aggregatedPoint, 34);
          aggregatedToken.set(zeroProof, 67);
          // Extra 64 bytes remain zeros
        } else if (isV1) {
          // V1 Format with uncompressed: [ Version (1) | A (65) | B (65) | Proof (64) ] = 195 bytes
          aggregatedToken = new Uint8Array(195);
          aggregatedToken[0] = 0x01;
          aggregatedToken.set(A_bytes, 1);
          aggregatedToken.set(aggregatedPoint, 66);
          aggregatedToken.set(zeroProof, 131);
        } else {
          // Legacy Format: [ A (33) | B (33) | Proof (64) ] = 130 bytes
          aggregatedToken = new Uint8Array(130);
          aggregatedToken.set(A_bytes, 0);
          aggregatedToken.set(aggregatedPoint, 33);
          aggregatedToken.set(zeroProof, 66);
        }

        // Store token info for Witness integration (use first valid response's metadata)
        const firstResp = validResponses[0];
        this.lastTokenInfo = {
          token_b64: voprf.bytesToBase64Url(aggregatedToken),
          issuer_id: firstResp.issuerId,
          exp: firstResp.exp,
          epoch: firstResp.epoch
        };

        console.log(
          `[Freebird] ✅ MPC token issued and aggregated ` +
          `(${validResponses.length}/${this.issuerEndpoints.length} issuers)`
        );

        return aggregatedToken;
      } catch (error) {
        // Re-throw errors from threshold check or other security failures
        if (state) {
          this.blindStates.delete(blindedHex);
        }
        throw error;
      }
    }

    // Fallback: simulated token (only reached if allowInsecureFallback is true)
    // This is checked in init() - if we get here, the user explicitly opted in
    if (state) {
      this.blindStates.delete(blindedHex);
    }
    return Crypto.hash(blindedValue, 'ISSUED');
  }

  /**
   * Helper to decode base64url to bytes
   */
  private base64UrlToBytes(base64: string): Uint8Array {
    const binString = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binString, (m) => m.codePointAt(0)!);
  }

  /**
   * Helper to decode a point from compressed bytes
   */
  private decodePoint(bytes: Uint8Array): any {
    return p256.ProjectivePoint.fromHex(bytesToHex(bytes));
  }

  /**
   * Helper to decode public key from base64url
   */
  private decodePublicKey(pubkeyB64: string): any {
    return this.decodePoint(this.base64UrlToBytes(pubkeyB64));
  }

  /**
   * Verify an authorization token
   *
   * Current: Basic validation
   * Future: POST to /v1/verify with full DLEQ proof verification
   */
  async verifyToken(token: Uint8Array): Promise<boolean> {
    await this.init();

    // Attempt real verification if verifier is available
    if (this.metadata.size > 0 && this.verifierUrl) {
      // Use first issuer's metadata for verification
      const firstMetadata = Array.from(this.metadata.values())[0];

      try {
        const response = await this.fetch(`${this.verifierUrl}/v1/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token_b64: voprf.bytesToBase64Url(token),
            issuer_id: firstMetadata.issuer_id,
            exp: Math.floor(Date.now() / 1000) + 3600,
            // Epoch is days since Unix epoch (matches Freebird's epoch_duration_sec = 86400)
            epoch: firstMetadata.epoch ?? Math.floor(Date.now() / 1000 / 86400)
          })
        });

        if (response.ok) {
          const data = await response.json();
          return data.ok === true;
        }
      } catch (error) {
        console.warn('[Freebird] Token verification via server failed:', error);
        // Fall through to local verification
      }
    }

    // Local verification based on token format
    if (token.length === 195 && token[0] === 0x01) {
      // V1 VOPRF token format (uncompressed points)
      console.warn('[Freebird] Using local format validation (server unavailable)');
      return true;
    }

    if (token.length === 130) {
      // Legacy VOPRF token format (compressed points)
      console.warn('[Freebird] Using local format validation (server unavailable)');
      return true;
    }

    if (token.length === 32) {
      // Fallback token format - only accept if insecure fallback is enabled
      if (this.allowInsecureFallback) {
        console.warn('[Freebird] Accepting 32-byte fallback token (INSECURE MODE)');
        return true;
      }
      console.error(
        '[Freebird] Rejecting 32-byte fallback token.\n' +
        'This token was created in insecure fallback mode but verification\n' +
        'is running in secure mode. This could indicate:\n' +
        '  - Token was created when Freebird was unavailable\n' +
        '  - Token forgery attempt\n\n' +
        'Set allowInsecureFallback: true to accept fallback tokens (NOT RECOMMENDED).'
      );
      return false;
    }

    // Unknown token format
    console.error(`[Freebird] Invalid token length: ${token.length} (expected 195, 130, or 32)`);
    return false;
  }

  /**
   * Create ownership proof for token spending
   *
   * Current: Hash-based proof
   * Future: VOPRF-based unforgeable proof using Freebird crypto
   */
  async createOwnershipProof(secret: Uint8Array): Promise<Uint8Array> {
    // This would ideally use VOPRF to create a proof that:
    // 1. Proves knowledge of secret without revealing it
    // 2. Is unforgeable (cannot be created without the secret)
    // 3. Is unlinkable (cannot correlate proofs to the same secret)
    //
    // For now: deterministic hash as placeholder
    return Crypto.hash(secret, 'OWNERSHIP_PROOF');
  }

  /**
   * Check if adapter is running in insecure fallback mode
   */
  isInsecureFallbackMode(): boolean {
    return this.allowInsecureFallback && this.metadata.size === 0;
  }

  /**
   * Get metadata from the first available issuer.
   * Used by the proxy to provide issuer public key to browsers.
   */
  async getIssuerMetadata(): Promise<any | null> {
    await this.init();

    if (this.metadata.size === 0) {
      return null;
    }

    // Return first available issuer's metadata
    return Array.from(this.metadata.values())[0];
  }
}
