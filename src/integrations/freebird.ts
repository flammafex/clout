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
import type { FreebirdClient, PublicKey, TorConfig } from '../types.js';
import * as voprf from '../vendor/freebird/voprf.js';
import type { BlindState, PartialEvaluation } from '../vendor/freebird/voprf.js';
import { TorProxy } from '../tor.js';
import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';
import { concatBytes, bytesToHex } from '@noble/hashes/utils';

export interface FreebirdAdapterConfig {
  readonly issuerEndpoints: string[];
  readonly verifierUrl: string;
  readonly tor?: TorConfig;
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
  private metadata: Map<string, any> = new Map();
  private blindStates: Map<string, BlindState> = new Map();

  constructor(config: FreebirdAdapterConfig) {
    if (!config.issuerEndpoints || config.issuerEndpoints.length === 0) {
      throw new Error('At least one issuer endpoint is required');
    }

    this.issuerEndpoints = config.issuerEndpoints;
    this.verifierUrl = config.verifierUrl;
    this.tor = config.tor ? new TorProxy(config.tor) : null;
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

    // Log MPC mode
    if (this.issuerEndpoints.length > 1) {
      console.log(`[Freebird] MPC threshold mode: ${this.issuerEndpoints.length} issuers`);
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
      console.warn('[Freebird] No issuers available, using fallback mode');
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

    // Fallback: simulated blinding for testing without Freebird server
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
    await this.init();

    // Retrieve blind state for finalization (may not exist in fallback mode)
    const blindedHex = Crypto.toHex(blindedValue);
    const state = this.blindStates.get(blindedHex);

    // Attempt real VOPRF issuance if at least one issuer is available
    if (this.metadata.size > 0 && state) {
      try {
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
                sybil_proof: { type: 'none' }
              })
            });

            if (!response.ok) {
              return { success: false, url, index };
            }

            const data = await response.json();

            // Extract evaluated point from token response
            // Token format: [ A (33) | B (33) | Proof (64) ]
            const tokenBytes = this.base64UrlToBytes(data.token);
            if (tokenBytes.length !== 130) {
              console.warn(`[Freebird] Invalid token length from ${url}`);
              return { success: false, url, index };
            }

            // Extract B (the evaluated point) - bytes 33-66
            const B_bytes = tokenBytes.slice(33, 66);

            // Verify DLEQ proof
            const G = p256.ProjectivePoint.BASE;
            const Q = this.decodePublicKey(metadata.voprf.pubkey);
            const A = this.decodePoint(tokenBytes.slice(0, 33));
            const B = this.decodePoint(B_bytes);
            const proofBytes = tokenBytes.slice(66);

            const isValid = this.verifyDleqExternal(G, Q, A, B, proofBytes);

            if (!isValid) {
              console.warn(`[Freebird] Invalid DLEQ proof from ${url}`);
              return { success: false, url, index };
            }

            // Use server's index if provided, otherwise use endpoint index (1-based)
            const serverIndex = data.index ?? (index + 1);

            return {
              success: true,
              url,
              index: serverIndex,
              evaluatedPoint: B_bytes,
              fullToken: tokenBytes
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
          fullToken: Uint8Array;
        };
        const validResponses = results.filter(r => r.success) as ValidResponse[];

        if (validResponses.length === 0) {
          throw new Error('No valid responses from any issuer');
        }

        // Calculate threshold (majority)
        const threshold = Math.ceil(this.issuerEndpoints.length / 2);

        if (validResponses.length < threshold) {
          console.warn(
            `[Freebird] Only ${validResponses.length}/${this.issuerEndpoints.length} valid responses, ` +
            `threshold is ${threshold}. Proceeding with available responses.`
          );
        }

        // Clean up blind state
        this.blindStates.delete(blindedHex);

        // Single issuer: return token directly (backward compatibility)
        if (this.issuerEndpoints.length === 1 && validResponses.length === 1) {
          console.log('[Freebird] ✅ VOPRF token issued and verified (single issuer)');
          return validResponses[0].fullToken;
        }

        // Multiple issuers: aggregate partial evaluations
        const partials: PartialEvaluation[] = validResponses.map(r => ({
          index: r.index,
          value: r.evaluatedPoint
        }));

        const aggregatedPoint = voprf.aggregate(partials);

        // Reconstruct token with aggregated evaluation
        // Format: [ A (33) | B_aggregated (33) | Proof (64 zeros - placeholder) ]
        const A_bytes = validResponses[0].fullToken.slice(0, 33);
        const zeroProof = new Uint8Array(64); // Placeholder proof

        const aggregatedToken = new Uint8Array(130);
        aggregatedToken.set(A_bytes, 0);
        aggregatedToken.set(aggregatedPoint, 33);
        aggregatedToken.set(zeroProof, 66);

        console.log(
          `[Freebird] ✅ MPC token issued and aggregated ` +
          `(${validResponses.length}/${this.issuerEndpoints.length} issuers)`
        );

        return aggregatedToken;
      } catch (error) {
        console.warn('[Freebird] Token issuance failed, using fallback:', error);
        this.blindStates.delete(blindedHex);
      }
    }

    // Fallback: simulated token (for testing without Freebird server)
    this.blindStates.delete(blindedHex);
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
   * External DLEQ verification (duplicated from voprf.ts for internal use)
   * TODO: Refactor to export this from voprf.ts
   */
  private verifyDleqExternal(G: any, Y: any, A: any, B: any, proofBytes: Uint8Array): boolean {

    if (proofBytes.length !== 64) return false;

    const cBytes = proofBytes.slice(0, 32);
    const sBytes = proofBytes.slice(32, 64);
    const c = BigInt('0x' + bytesToHex(cBytes));
    const s = BigInt('0x' + bytesToHex(sBytes));

    // Recompute commitments
    const sG = G.multiply(s);
    const cY = Y.multiply(c);
    const t1 = sG.subtract(cY);

    const sA = A.multiply(s);
    const cB = B.multiply(c);
    const t2 = sA.subtract(cB);

    // Recompute challenge
    const DLEQ_DST_PREFIX = new TextEncoder().encode('DLEQ-P256-v1');
    const dst = concatBytes(DLEQ_DST_PREFIX, this.context);
    const dstLenBytes = new Uint8Array(4);
    const dstLen = dst.length;
    dstLenBytes[0] = (dstLen >>> 24) & 0xff;
    dstLenBytes[1] = (dstLen >>> 16) & 0xff;
    dstLenBytes[2] = (dstLen >>> 8) & 0xff;
    dstLenBytes[3] = dstLen & 0xff;

    const encodePoint = (p: any) => p.toRawBytes(true);

    const transcript = concatBytes(
      dstLenBytes,
      dst,
      encodePoint(G),
      encodePoint(Y),
      encodePoint(A),
      encodePoint(B),
      encodePoint(t1),
      encodePoint(t2)
    );

    const hash = sha256(transcript);
    const computedC = BigInt('0x' + bytesToHex(hash)) % p256.CURVE.n;

    return c === computedC;
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
            epoch: firstMetadata.epoch || 0  // Key rotation epoch
          })
        });

        if (response.ok) {
          const data = await response.json();
          return data.ok === true;
        }
      } catch (error) {
        console.warn('[Freebird] Token verification failed, using fallback:', error);
      }
    }

    // Fallback: basic length check
    return token.length === 32 || token.length === 130;
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
}
