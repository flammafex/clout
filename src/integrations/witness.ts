/**
 * Witness integration adapter
 *
 * Provides timestamped attestations for Scarcity transfers using
 * threshold signature-based timestamping without blockchain.
 *
 * Supports both Ed25519 multi-sig and BLS12-381 aggregated signatures.
 */

import { Crypto } from '../crypto.js';
import { sha256 } from '@noble/hashes/sha256';
import type {
  WitnessClient,
  Attestation,
  TorConfig,
  FreebirdToken,
  SophiaWitnessSignedAttestation,
} from '../types.js';
import { bls12_381 } from '@noble/curves/bls12-381';
import { TorProxy } from '../tor.js';

/**
 * Normalize a timestamp to milliseconds
 *
 * Handles ambiguity between seconds and milliseconds by checking magnitude.
 * Timestamps before year 2100 in seconds (~4.1 billion) are converted to ms.
 * This provides a safety net for inconsistent timestamp units from external APIs.
 *
 * @param timestamp - Raw timestamp (possibly seconds or milliseconds)
 * @returns Timestamp in milliseconds
 */
export function normalizeTimestampMs(timestamp: number): number {
  // If timestamp looks like seconds (before year 2100 in seconds = ~4.1 billion)
  // Year 2100 in seconds: 4102444800
  // Year 2000 in milliseconds: 946684800000
  if (timestamp < 4_200_000_000) {
    return timestamp * 1000; // Convert seconds to milliseconds
  }
  return timestamp; // Already in milliseconds
}

const CONTRACT_VERSION = 'sophia/v1' as const;

function lowerHex(value: string, name: string): string {
  const normalized = value.toLowerCase();
  if (!/^[0-9a-f]+$/.test(normalized)) {
    throw new Error(`${name} must be lowercase hex`);
  }
  return normalized;
}

function sha256Hex(value: string, name: string): string {
  const normalized = lowerHex(value, name);
  if (normalized.length !== 64) {
    throw new Error(`${name} must be a 32-byte SHA-256 hex value`);
  }
  return normalized;
}

function bytesToLowerHex(bytes: ArrayLike<number>, name: string): string {
  if (bytes.length !== 32) {
    throw new Error(`${name} must be 32 bytes`);
  }
  return bytesToLowerHexAny(bytes, name);
}

function bytesToLowerHexAny(bytes: ArrayLike<number>, name: string): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error(`${name} must contain byte values`);
    }
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

function lowerHexUnknown(value: unknown, name: string): string {
  if (typeof value === 'string') {
    const trimmed = value.startsWith('0x') || value.startsWith('0X')
      ? value.slice(2)
      : value;
    return lowerHex(trimmed, name);
  }

  if (value instanceof Uint8Array) {
    return bytesToLowerHexAny(value, name);
  }

  if (Array.isArray(value)) {
    return bytesToLowerHexAny(value, name);
  }

  if (value && typeof value === 'object') {
    const maybeData = (value as { data?: unknown }).data;
    if (maybeData instanceof Uint8Array || Array.isArray(maybeData)) {
      return bytesToLowerHexAny(maybeData, name);
    }
  }

  throw new Error(`${name} must be lowercase hex`);
}

function sha256HexUnknown(value: unknown, name: string): string {
  if (typeof value === 'string') {
    const trimmed = value.startsWith('0x') || value.startsWith('0X')
      ? value.slice(2)
      : value;
    return sha256Hex(trimmed, name);
  }

  if (value instanceof Uint8Array) {
    return bytesToLowerHex(value, name);
  }

  if (Array.isArray(value)) {
    return bytesToLowerHex(value, name);
  }

  if (value && typeof value === 'object') {
    const maybeData = (value as { data?: unknown }).data;
    if (maybeData instanceof Uint8Array || Array.isArray(maybeData)) {
      return bytesToLowerHex(maybeData, name);
    }
  }

  throw new Error(`${name} must be lowercase hex`);
}

function normalizeTimestampSeconds(timestamp: number): number {
  return timestamp > 4_200_000_000 ? Math.floor(timestamp / 1000) : timestamp;
}

function normalizeSignatureSet(raw: any): SophiaWitnessSignedAttestation['signatures'] {
  if (Array.isArray(raw)) {
    return {
      kind: 'multisig',
      signatures: raw.map((signature: any, index: number) => ({
        witness_id: String(signature.witness_id),
        signature: lowerHexUnknown(signature.signature, `signatures[${index}].signature`),
      })),
    };
  }

  if (raw?.kind === 'multisig' && Array.isArray(raw.signatures)) {
    return {
      kind: 'multisig',
      signatures: raw.signatures.map((signature: any, index: number) => ({
        witness_id: String(signature.witness_id),
        signature: lowerHexUnknown(signature.signature, `signatures[${index}].signature`),
      })),
    };
  }

  if (raw?.kind === 'aggregated' && raw.signature && Array.isArray(raw.signers)) {
    return {
      kind: 'aggregated',
      signature: lowerHexUnknown(raw.signature, 'signatures.signature'),
      signers: raw.signers.map(String),
    };
  }

  if (Array.isArray(raw?.signatures)) {
    return {
      kind: 'multisig',
      signatures: raw.signatures.map((signature: any, index: number) => ({
        witness_id: String(signature.witness_id),
        signature: lowerHexUnknown(signature.signature, `signatures[${index}].signature`),
      })),
    };
  }

  if (raw?.signature && Array.isArray(raw.signers)) {
    return {
      kind: 'aggregated',
      signature: lowerHexUnknown(raw.signature, 'signatures.signature'),
      signers: raw.signers.map(String),
    };
  }

  throw new Error('Witness signatures must be multisig or aggregated');
}

function normalizeSignedAttestation(raw: any, fallbackHash?: string): SophiaWitnessSignedAttestation {
  const signed = raw?.attestation?.attestation ? raw.attestation : raw;
  const attestation = signed?.attestation;
  if (!attestation) {
    throw new Error('Witness signed attestation missing attestation');
  }
  const hashValue = attestation.hash ?? attestation.hash_hex ?? attestation.hashHex;

  return {
    contract_version: CONTRACT_VERSION,
    artifact_type: 'witness.signed_attestation',
    attestation: {
      hash: hashValue === undefined && fallbackHash
        ? sha256Hex(fallbackHash, 'fallbackHash')
        : sha256HexUnknown(hashValue, 'attestation.hash'),
      timestamp: normalizeTimestampSeconds(Number(attestation.timestamp)),
      network_id: String(attestation.network_id ?? attestation.networkId),
      sequence: Number(attestation.sequence ?? 0),
    },
    signatures: normalizeSignatureSet(signed.signatures),
  };
}

function signatureCount(canonical: SophiaWitnessSignedAttestation): number {
  return canonical.signatures.kind === 'multisig'
    ? canonical.signatures.signatures.length
    : canonical.signatures.signers.length;
}

function signatureStrings(canonical: SophiaWitnessSignedAttestation): string[] {
  return canonical.signatures.kind === 'multisig'
    ? canonical.signatures.signatures.map(signature => signature.signature)
    : [canonical.signatures.signature];
}

function signerIds(canonical: SophiaWitnessSignedAttestation): string[] {
  return canonical.signatures.kind === 'multisig'
    ? canonical.signatures.signatures.map(signature => signature.witness_id)
    : [...canonical.signatures.signers];
}

function toWireSignedAttestation(canonical: SophiaWitnessSignedAttestation): any {
  const signatures = canonical.signatures.kind === 'multisig'
    ? {
        signatures: canonical.signatures.signatures.map(signature => ({
          witness_id: signature.witness_id,
          signature: signature.signature,
        })),
      }
    : {
        signature: canonical.signatures.signature,
        signers: [...canonical.signatures.signers],
      };

  return {
    attestation: { ...canonical.attestation },
    signatures,
  };
}

export interface WitnessAdapterConfig {
  readonly gatewayUrl?: string; // Single gateway (backward compatibility)
  readonly gatewayUrls?: string[]; // Multiple gateways for quorum
  readonly networkId?: string;
  readonly tor?: TorConfig;
  readonly powDifficulty?: number; // Proof-of-work difficulty in bits (default: 0 = disabled)
  readonly quorumThreshold?: number; // Minimum agreements required (default: 2 for 2-of-3)
  /**
   * Allow insecure fallback mode when Witness servers are unavailable.
   *
   * ⚠️  WARNING: Setting this to true removes timestamp verification!
   * Fallback mode uses fake local attestations with no cryptographic
   * signatures. This means timestamps can be forged and double-spends
   * cannot be detected. Only enable for development or small trusted
   * networks where timing attacks are not a concern.
   *
   * Default: false (fail if servers unavailable)
   */
  readonly allowInsecureFallback?: boolean;
  /**
   * Default Freebird token for Sybil resistance.
   *
   * If set, this token will be included with all timestamp requests
   * unless overridden per-request. This is useful when using a Day Pass
   * that should be reused across multiple timestamps.
   */
  readonly freebirdToken?: FreebirdToken;
}

/**
 * Merkle inclusion proof for light client verification
 */
export interface MerkleProof {
  /** The leaf hash being proven (hex) */
  leaf: string;
  /** Sibling hashes from leaf to root (hex array) */
  siblings: string[];
  /** Index of the leaf in the tree */
  index: number;
  /** The merkle root (hex) */
  root: string;
}

/**
 * Attestation event from WebSocket stream
 */
export interface AttestationEvent {
  type: 'attestation';
  hash: string;
  timestamp: number;
  sequence: number;
  network_id: string;
}

/**
 * WebSocket event handler type
 */
export type AttestationEventHandler = (event: AttestationEvent) => void;

// Re-export FreebirdToken for convenience
export type { FreebirdToken } from '../types.js';

/**
 * Options for timestamp request
 */
export interface TimestampOptions {
  /** Optional Freebird token for Sybil resistance */
  freebirdToken?: FreebirdToken;
}

/**
 * Adapter for Witness timestamping service
 *
 * Connects to a Witness gateway that coordinates threshold signatures
 * from multiple independent witness nodes for tamper-proof timestamps.
 */
export class WitnessAdapter implements WitnessClient {
  private readonly gatewayUrls: string[];
  private readonly networkId: string;
  private readonly tor: TorProxy | null;
  private readonly powDifficulty: number;
  private readonly quorumThreshold: number;
  private readonly allowInsecureFallback: boolean;
  private currentFreebirdToken: FreebirdToken | null;
  private config: any = null;
  private fallbackWarningShown = false;

  constructor(config: WitnessAdapterConfig) {
    // Support both single gateway (backward compatibility) and multiple gateways
    if (config.gatewayUrls && config.gatewayUrls.length > 0) {
      this.gatewayUrls = [...config.gatewayUrls];
    } else if (config.gatewayUrl) {
      this.gatewayUrls = [config.gatewayUrl];
    } else {
      throw new Error('WitnessAdapter requires either gatewayUrl or gatewayUrls');
    }

    this.networkId = config.networkId ?? 'scarcity-network';
    this.tor = config.tor ? new TorProxy(config.tor) : null;
    this.powDifficulty = config.powDifficulty ?? 0; // Default: disabled
    this.allowInsecureFallback = config.allowInsecureFallback ?? false;
    this.currentFreebirdToken = config.freebirdToken ?? null;

    // Default quorum: 2-of-3 (or majority if different number of gateways)
    this.quorumThreshold = config.quorumThreshold ?? Math.ceil(this.gatewayUrls.length / 2);

    console.log(`[Witness] Configured with ${this.gatewayUrls.length} gateway(s), quorum threshold: ${this.quorumThreshold}`);

    // Log if Tor is enabled for .onion addresses
    for (const url of this.gatewayUrls) {
      if (TorProxy.isOnionUrl(url)) {
        if (this.tor) {
          console.log(`[Witness] Tor enabled for .onion address: ${url}`);
        } else {
          console.warn(`[Witness] .onion URL detected but Tor not configured: ${url}`);
        }
      }
    }
  }

  /**
   * Set or update the Freebird token for Sybil resistance
   *
   * Call this when a Day Pass is obtained or renewed. The token will be
   * included in all subsequent timestamp requests for Sybil resistance.
   *
   * @param token - The Freebird token, or null to clear
   */
  setFreebirdToken(token: FreebirdToken | null): void {
    this.currentFreebirdToken = token;
    if (token) {
      const expiresIn = Math.round((token.exp * 1000 - Date.now()) / 1000 / 60);
      console.log(`[Witness] Freebird token set (expires in ${expiresIn} minutes)`);
    } else {
      console.log('[Witness] Freebird token cleared');
    }
  }

  /**
   * Get the current Freebird token (if any)
   */
  getFreebirdToken(): FreebirdToken | null {
    return this.currentFreebirdToken;
  }

  /**
   * Check if a valid (non-expired) Freebird token is set
   */
  hasValidFreebirdToken(): boolean {
    if (!this.currentFreebirdToken) return false;
    return this.currentFreebirdToken.exp * 1000 > Date.now();
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

  private signatureCount(signedAttestation: any): number {
    try {
      return signatureCount(normalizeSignedAttestation(signedAttestation));
    } catch {
      return 0;
    }
  }

  private parseSignedAttestation(data: any, fallbackHash: string): Attestation {
    const canonical = normalizeSignedAttestation(data?.attestation ?? data, fallbackHash);

    return {
      hash: canonical.attestation.hash ?? fallbackHash,
      timestamp: normalizeTimestampMs(canonical.attestation.timestamp),
      signatures: signatureStrings(canonical),
      witnessIds: signerIds(canonical),
      canonical,
      raw: canonical,
    };
  }

  /**
   * Initialize by fetching network configuration
   * Tries all gateways and succeeds if at least one responds
   */
  private async init(): Promise<void> {
    if (this.config) return;

    // Try all gateways in parallel
    const configPromises = this.gatewayUrls.map(async (url) => {
      try {
        const response = await this.fetch(`${url}/v1/config`);
        if (response.ok) {
          return await response.json();
        }
        return null;
      } catch (error) {
        console.warn(`[Witness] Gateway ${url} not available:`, error);
        return null;
      }
    });

    const configs = await Promise.all(configPromises);
    const validConfig = configs.find(c => c !== null);

    if (validConfig) {
      this.config = validConfig;
      console.log('[Witness] Connected to network:', this.config.network_id || 'unknown');
    } else {
      if (!this.allowInsecureFallback) {
        throw new Error(
          '[Witness] FATAL: No Witness gateways available and fallback mode is disabled.\n' +
          'This means timestamps cannot be verified and double-spends cannot be detected.\n\n' +
          'Options:\n' +
          '  1. Ensure at least one Witness gateway is running and accessible\n' +
          '  2. Set allowInsecureFallback: true in WitnessAdapterConfig (NOT RECOMMENDED)\n\n' +
          '⚠️  WARNING: Enabling fallback mode removes all timestamp verification!'
        );
      }
      if (!this.fallbackWarningShown) {
        console.warn('\n' + '='.repeat(70));
        console.warn('⚠️  SECURITY WARNING: Witness running in INSECURE FALLBACK MODE');
        console.warn('='.repeat(70));
        console.warn('No Witness gateways are available. Using fake local attestations.');
        console.warn('This provides NO timestamp verification - anyone can forge timestamps.');
        console.warn('Double-spend detection is DISABLED.');
        console.warn('Only use this for development or small trusted networks.');
        console.warn('='.repeat(70) + '\n');
        this.fallbackWarningShown = true;
      }
    }
  }

  /**
   * Timestamp a hash with Witness federation
   *
   * Submits hash to gateway, which collects threshold signatures
   * from witness nodes and returns signed attestation.
   *
   * LAYER 2: PROOF-OF-WORK - If powDifficulty > 0, solves a computational
   * puzzle before submitting, imposing a "computation cost" on the requester.
   *
   * Multi-gateway: Tries all gateways and returns first successful response
   *
   * @param hash - SHA-256 hash to timestamp (hex string)
   * @param options - Optional settings including Freebird token for Sybil resistance
   */
  async timestamp(hash: string, options?: TimestampOptions): Promise<Attestation> {
    await this.init();

    // LAYER 2: PROOF-OF-WORK CHALLENGE
    // Solve computational puzzle to prevent cheap spam
    let nonce: number | undefined;
    if (this.powDifficulty > 0) {
      const startTime = Date.now();
      nonce = Crypto.solveProofOfWork(hash, this.powDifficulty);
      const elapsed = Date.now() - startTime;
      console.log(`[Witness] PoW solved in ${elapsed}ms (difficulty: ${this.powDifficulty}, nonce: ${nonce})`);
    }

    // Determine which Freebird token to use (per-request override or current)
    const freebirdToken = options?.freebirdToken ?? this.currentFreebirdToken;

    // Attempt real timestamping if gateway is available
    if (this.config) {
      // Try all gateways in parallel, use first successful response
      const requestBody: any = { hash };
      if (nonce !== undefined) {
        requestBody.nonce = nonce;
        requestBody.difficulty = this.powDifficulty;
      }
      if (freebirdToken) {
        // Include Freebird token for Sybil resistance
        // V3 tokens are self-contained — verifier only needs the token itself
        requestBody.freebird_token = {
          token_b64: freebirdToken.token_b64,
        };
      }

      const timestampPromises = this.gatewayUrls.map(async (gatewayUrl) => {
        try {
          const response = await this.fetch(`${gatewayUrl}/v1/timestamp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
          });

          if (response.ok) {
            const data = await response.json();
            return this.parseSignedAttestation(data, hash);
          }
          return null;
        } catch (error) {
          console.warn(`[Witness] Timestamping failed for gateway ${gatewayUrl}:`, error);
          return null;
        }
      });

      // Wait for first successful response
      const results = await Promise.all(timestampPromises);
      const successfulResult = results.find(r => r !== null);

      if (successfulResult) {
        console.log('[Witness] Successfully timestamped via gateway');
        return successfulResult;
      }

      // All gateways failed - check if fallback is allowed
      if (!this.allowInsecureFallback) {
        throw new Error(
          '[Witness] All gateways failed for timestamping and fallback mode is disabled.\n' +
          'Cannot create a verified timestamp. This could indicate:\n' +
          '  - Network issues preventing connection to Witness gateways\n' +
          '  - All Witness servers are down\n' +
          '  - A network partition or censorship attack\n\n' +
          'Timestamping rejected for security reasons.'
        );
      }
      console.warn('[Witness] All gateways failed - using INSECURE fallback attestation');
    }

    // Fallback: simulated local attestation (only reached if allowInsecureFallback is true)
    // This is checked above and in init() - if we get here, the user explicitly opted in
    return {
      hash,
      timestamp: Date.now(),
      signatures: [
        Crypto.toHex(Crypto.hash(hash, 'witness-1')),
        Crypto.toHex(Crypto.hash(hash, 'witness-2')),
        Crypto.toHex(Crypto.hash(hash, 'witness-3'))
      ],
      witnessIds: ['witness-1', 'witness-2', 'witness-3'],
      // Mark this as a fallback attestation so it can be identified
      _insecureFallback: true
    } as Attestation;
  }

  /**
   * Verify a Witness attestation
   *
   * Validates threshold signatures from witness nodes.
   * Supports both Ed25519 multi-sig and BLS12-381 aggregated signatures.
   *
   * Multi-gateway: Tries all gateways and returns first successful verification.
   */
  async verify(attestation: Attestation): Promise<boolean> {
    await this.init();

    if (this.config) {
      let canonical: SophiaWitnessSignedAttestation;
      try {
        canonical = this.toCanonicalSignedAttestation(attestation);
      } catch {
        return false;
      }
      const witnessAttestation = toWireSignedAttestation(canonical);

      // Try all gateways (consistent with timestamp() and other methods)
      for (const gatewayUrl of this.gatewayUrls) {
        try {
          const response = await this.fetch(`${gatewayUrl}/v1/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ attestation: witnessAttestation })
          });

          if (response.ok) {
            const data = await response.json();
            if (data.valid === true) {
              return true;
            }
            // Gateway responded but said invalid - continue to try other gateways
            // in case of split-brain or partial network issues
          }
        } catch (error) {
          console.warn(`[Witness] Gateway ${gatewayUrl} verification failed:`, error);
          continue;
        }
      }

      // All gateways failed - try local BLS verification as fallback
      const blsResult = this.verifyBLSLocal(canonical);
      if (blsResult !== null) {
        return blsResult;
      }
    }

    // Fallback verification - only accept if insecure fallback is enabled
    if (!this.allowInsecureFallback) {
      console.error(
        '[Witness] Cannot verify attestation: no gateways available and fallback mode is disabled.\n' +
        'This attestation cannot be cryptographically verified. Rejecting for security.\n' +
        'Set allowInsecureFallback: true to accept unverified attestations (NOT RECOMMENDED).'
      );
      return false;
    }

    // Insecure fallback: basic structural validation only
    // This provides NO cryptographic security - only checks format
    console.warn('[Witness] Using INSECURE structural validation (no cryptographic verification)');

    if (!attestation.hash || !attestation.timestamp) {
      return false;
    }

    if (!attestation.signatures || attestation.signatures.length < 2) {
      return false;
    }

    if (!attestation.witnessIds || attestation.witnessIds.length !== attestation.signatures.length) {
      return false;
    }

    // Check if attestation is too old (24 hours)
    const age = Date.now() - attestation.timestamp;
    if (age > 24 * 60 * 60 * 1000) {
      return false;
    }

    // Check if this is a known fallback attestation (created with fake witness IDs)
    const isFallbackAttestation = attestation.witnessIds.every(
      id => id.startsWith('witness-') && /^witness-\d+$/.test(id)
    );
    if (isFallbackAttestation) {
      console.warn('[Witness] Accepting fallback attestation with fake witness IDs (INSECURE)');
    }

    return true;
  }

  private toCanonicalSignedAttestation(attestation: Attestation): SophiaWitnessSignedAttestation {
    if (attestation.canonical) {
      return normalizeSignedAttestation(attestation.canonical);
    }

    if (attestation.raw) {
      return normalizeSignedAttestation(attestation.raw);
    }

    return {
      contract_version: CONTRACT_VERSION,
      artifact_type: 'witness.signed_attestation',
      attestation: {
        hash: sha256Hex(attestation.hash, 'attestation.hash'),
        timestamp: normalizeTimestampSeconds(attestation.timestamp),
        network_id: this.networkId,
        sequence: 0,
      },
      signatures: {
        kind: 'multisig',
        signatures: attestation.signatures.map((sig, idx) => ({
          witness_id: attestation.witnessIds[idx],
          signature: sig,
        })),
      },
    };
  }

  /**
   * Verify BLS aggregated signature locally
   *
   * This requires the network config to have witness public keys.
   * Returns null if verification cannot be performed (missing data),
   * true if valid, false if invalid.
   */
  private verifyBLSLocal(attestation: SophiaWitnessSignedAttestation): boolean | null {
    try {
      // Check if this is a BLS aggregated signature
      const signaturesData = attestation.signatures;
      if (signaturesData.kind !== 'aggregated') {
        return null; // Not BLS aggregated format
      }

      // Check if we have witness public keys in config
      if (!this.config?.witnesses || !Array.isArray(this.config.witnesses)) {
        console.warn('[Witness] Cannot verify BLS locally: missing witness public keys');
        return null;
      }

      // Extract the aggregated signature
      const aggregatedSigHex = signaturesData.signature;
      const signers = signaturesData.signers;

      // Get public keys for all signers
      const pubkeys: string[] = [];
      for (const signerId of signers) {
        const witness = this.config.witnesses.find((w: any) => w.id === signerId);
        if (!witness || !witness.pubkey) {
          console.warn(`[Witness] Missing public key for signer: ${signerId}`);
          return null;
        }
        pubkeys.push(witness.pubkey);
      }

      // Prepare the message (attestation hash)
      const attestationData = attestation.attestation;
      const messageBytes = this.serializeAttestationForSigning(attestationData);

      // Verify BLS signature
      const isValid = this.verifyBLSAggregatedSignature(
        messageBytes,
        aggregatedSigHex,
        pubkeys
      );

      console.log(`[Witness] Local BLS verification: ${isValid ? 'valid' : 'invalid'}`);
      return isValid;

    } catch (error) {
      console.error('[Witness] BLS verification error:', error);
      return null; // Cannot verify
    }
  }

  /**
   * Serialize attestation for signing (matches Witness Rust implementation)
   *
   * The message format must match exactly what the Witness nodes sign.
   * Based on Witness implementation: hash || timestamp || network_id || sequence
   */
  private serializeAttestationForSigning(attestation: any): Uint8Array {
    // Convert hash (either Uint8Array or hex string) to bytes
    let hashBytes: Uint8Array;
    if (typeof attestation.hash === 'string') {
      // Remove '0x' prefix if present
      const hex = attestation.hash.startsWith('0x') ? attestation.hash.slice(2) : attestation.hash;
      hashBytes = Uint8Array.from(Buffer.from(hex, 'hex'));
    } else if (Array.isArray(attestation.hash)) {
      hashBytes = new Uint8Array(attestation.hash);
    } else {
      hashBytes = attestation.hash;
    }

    // Convert timestamp to 8-byte little-endian
    const timestampBytes = new Uint8Array(8);
    const view = new DataView(timestampBytes.buffer);
    view.setBigUint64(0, BigInt(attestation.timestamp), true); // little-endian

    // Convert network_id to UTF-8 bytes
    const networkIdBytes = new TextEncoder().encode(attestation.network_id || '');

    // Convert sequence to 8-byte little-endian
    const sequenceBytes = new Uint8Array(8);
    const seqView = new DataView(sequenceBytes.buffer);
    seqView.setBigUint64(0, BigInt(attestation.sequence || 0), true); // little-endian

    // Concatenate: hash || timestamp || network_id || sequence
    const messageLen = hashBytes.length + timestampBytes.length + networkIdBytes.length + sequenceBytes.length;
    const message = new Uint8Array(messageLen);
    let offset = 0;
    message.set(hashBytes, offset); offset += hashBytes.length;
    message.set(timestampBytes, offset); offset += timestampBytes.length;
    message.set(networkIdBytes, offset); offset += networkIdBytes.length;
    message.set(sequenceBytes, offset);

    return message;
  }

  /**
   * Verify BLS aggregated signature using noble-curves
   *
   * @param message - The message that was signed
   * @param aggregatedSigHex - Hex-encoded aggregated signature (96 bytes)
   * @param pubkeysHex - Array of hex-encoded public keys (48 bytes each)
   * @returns true if signature is valid
   */
  private verifyBLSAggregatedSignature(
    message: Uint8Array,
    aggregatedSigHex: string,
    pubkeysHex: string[]
  ): boolean {
    try {
      // Parse aggregated signature (G2 point, 96 bytes)
      const sigHex = aggregatedSigHex.startsWith('0x') ? aggregatedSigHex.slice(2) : aggregatedSigHex;
      const signature = Uint8Array.from(Buffer.from(sigHex, 'hex'));

      // Parse and aggregate public keys (G1 points, 48 bytes each)
      const pubkeys = pubkeysHex.map(pkHex => {
        const hex = pkHex.startsWith('0x') ? pkHex.slice(2) : pkHex;
        return Uint8Array.from(Buffer.from(hex, 'hex'));
      });

      // Aggregate public keys (G1 point addition)
      let aggregatedPubkey = bls12_381.G1.ProjectivePoint.ZERO;
      for (const pk of pubkeys) {
        const point = bls12_381.G1.ProjectivePoint.fromHex(pk);
        aggregatedPubkey = aggregatedPubkey.add(point);
      }

      // Verify using BLS12-381 pairing (minimal-signature-size variant)
      // This uses G2 for signatures (96 bytes) and G1 for public keys (48 bytes)
      const isValid = bls12_381.verify(
        signature,
        message,
        aggregatedPubkey.toRawBytes()
      );

      return isValid;

    } catch (error) {
      console.error('[Witness] BLS signature verification failed:', error);
      return false;
    }
  }

  /**
   * Check if nullifier has been seen by Witness network
   *
   * Queries for existing timestamp to detect double-spends.
   *
   * ANTI-CENSORSHIP: Uses quorum voting across multiple gateways.
   * A malicious gateway cannot hide a nullifier - we need quorum agreement.
   *
   * Returns:
   * - 1.0: Quorum agrees nullifier exists (double-spend detected)
   * - 0.0: Quorum agrees nullifier doesn't exist (safe to accept)
   * - 0.5: Split vote or insufficient responses (treat as suspicious)
   */
  async checkNullifier(nullifier: Uint8Array): Promise<number> {
    await this.init();

    const hash = Crypto.toHex(nullifier);

    // Attempt real lookup if gateway is available
    if (this.config) {
      // Query all gateways in parallel
      const checkPromises = this.gatewayUrls.map(async (gatewayUrl) => {
        try {
          const response = await this.fetch(`${gatewayUrl}/v1/timestamp/${hash}`);

          if (response.status === 404) {
            return { seen: false, gateway: gatewayUrl };
          }

          if (response.ok) {
            const data = await response.json();
            // Check if we have valid attestation with threshold signatures
            const sigCount = this.signatureCount(data.attestation);
            const threshold = this.config.threshold || 2;
            return {
              seen: sigCount >= threshold,
              gateway: gatewayUrl
            };
          }

          return null; // Gateway error
        } catch (error) {
          console.warn(`[Witness] Gateway ${gatewayUrl} failed for nullifier check:`, error);
          return null; // Network error
        }
      });

      const results = await Promise.all(checkPromises);
      const validResults = results.filter(r => r !== null);

      if (validResults.length === 0) {
        // All gateways failed - cannot determine, return low confidence
        console.warn('[Witness] All gateways failed, cannot verify nullifier');
        return 0;
      }

      // Count votes
      const seenCount = validResults.filter(r => r.seen).length;
      const notSeenCount = validResults.filter(r => !r.seen).length;

      console.log(`[Witness] Nullifier check: ${seenCount}/${validResults.length} gateways report seen (quorum: ${this.quorumThreshold})`);

      // Quorum logic
      if (seenCount >= this.quorumThreshold) {
        // Quorum agrees: nullifier has been seen (DOUBLE-SPEND!)
        return 1.0;
      } else if (notSeenCount >= this.quorumThreshold) {
        // Quorum agrees: nullifier has NOT been seen (SAFE)
        return 0.0;
      } else {
        // Split vote or insufficient responses - suspicious!
        // This could indicate a censorship attack
        console.warn('[Witness] Split vote on nullifier check - possible censorship attack');
        return 0.5;
      }
    }

    // Fallback: cannot check without gateway
    if (!this.allowInsecureFallback) {
      console.error('[Witness] Cannot check nullifier: no gateways available');
      // Return 0.5 (suspicious) rather than 0 (safe) when we can't verify
      return 0.5;
    }
    // In insecure fallback mode, assume nullifier hasn't been seen
    // This is DANGEROUS - double-spends cannot be detected!
    console.warn('[Witness] INSECURE: Assuming nullifier not seen (no verification possible)');
    return 0;
  }

  /**
   * Get the quorum threshold for valid attestations
   *
   * Returns the minimum number of witnesses that must agree for an
   * attestation to be considered valid (e.g., 2-of-3, 3-of-5).
   */
  getQuorumThreshold(): number {
    return this.quorumThreshold;
  }

  /**
   * Retrieve attestation for a specific hash
   *
   * Multi-gateway: Tries all gateways and returns first valid attestation
   */
  async getAttestation(hash: string): Promise<Attestation | null> {
    await this.init();

    if (this.config) {
      // Try all gateways in parallel
      const attestationPromises = this.gatewayUrls.map(async (gatewayUrl) => {
        try {
          const response = await this.fetch(`${gatewayUrl}/v1/timestamp/${hash}`);

          if (response.status === 404) {
            return null;
          }

          if (response.ok) {
            const data = await response.json();
            return this.parseSignedAttestation(data, hash);
          }
          return null;
        } catch (error) {
          console.warn(`[Witness] Failed to retrieve attestation from ${gatewayUrl}:`, error);
          return null;
        }
      });

      const results = await Promise.all(attestationPromises);
      const validAttestation = results.find(a => a !== null);

      if (validAttestation) {
        return validAttestation;
      }
    }

    return null;
  }

  /**
   * Get Witness network configuration
   */
  async getConfig() {
    await this.init();

    // Return cached config if available
    if (this.config) {
      return this.config;
    }

    // Fallback config (only reached if allowInsecureFallback is true)
    // This is checked in init() - if we get here, the user explicitly opted in
    return {
      network_id: this.networkId,
      threshold: 2,
      witnesses: [
        { id: 'witness-1', endpoint: 'http://localhost:3001' },
        { id: 'witness-2', endpoint: 'http://localhost:3002' },
        { id: 'witness-3', endpoint: 'http://localhost:3003' }
      ],
      _insecureFallback: true
    };
  }

  /**
   * Check if adapter is running in insecure fallback mode
   */
  isInsecureFallbackMode(): boolean {
    return this.allowInsecureFallback && !this.config;
  }

  // ============================================
  // Light Client Support (Phase 6)
  // ============================================

  /**
   * Get a Merkle inclusion proof for a hash
   *
   * Light clients can use this proof to verify that a hash was timestamped
   * without downloading the full attestation history.
   *
   * @param hash - The hash to get proof for (hex string)
   * @returns Merkle proof or null if not found
   */
  async getProof(hash: string): Promise<MerkleProof | null> {
    await this.init();

    // Try each gateway
    for (const gatewayUrl of this.gatewayUrls) {
      try {
        const response = await this.fetch(`${gatewayUrl}/v1/proof/${hash}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
          if (response.status === 404) {
            // Hash not found at this gateway, try next
            continue;
          }
          throw new Error(`Proof request failed: ${response.status}`);
        }

        const proof = await response.json();
        return proof as MerkleProof;
      } catch (error) {
        console.warn(`[Witness] Failed to get proof from ${gatewayUrl}:`, error);
        continue;
      }
    }

    return null;
  }

  /**
   * Verify a Merkle proof locally
   *
   * Uses sorted hashing (same as Witness network) to verify the proof
   * without contacting any gateway.
   *
   * @param proof - The Merkle proof to verify
   * @returns true if proof is valid
   */
  verifyProof(proof: MerkleProof): boolean {
    // Convert hex strings to bytes
    const leafBytes = this.hexToBytes(proof.leaf);
    const siblingBytes = proof.siblings.map(s => this.hexToBytes(s));
    const rootBytes = this.hexToBytes(proof.root);

    let current = leafBytes;

    for (const sibling of siblingBytes) {
      // Sorted hash: always put smaller value first
      const [left, right] = this.compareBytes(current, sibling) <= 0
        ? [current, sibling]
        : [sibling, current];

      // SHA-256(left || right)
      current = this.sha256Concat(left, right);
    }

    return this.bytesEqual(current, rootBytes);
  }

  // Helper: hex to bytes
  private hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  }

  // Helper: compare byte arrays
  private compareBytes(a: Uint8Array, b: Uint8Array): number {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      if (a[i] !== b[i]) return a[i] - b[i];
    }
    return a.length - b.length;
  }

  // Helper: check byte array equality
  private bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  // Helper: SHA-256 of concatenated bytes (using SubtleCrypto when available)
  private sha256Concat(a: Uint8Array, b: Uint8Array): Uint8Array {
    const combined = new Uint8Array(a.length + b.length);
    combined.set(a, 0);
    combined.set(b, a.length);
    return sha256(combined);
  }

  // ============================================
  // WebSocket Real-time Events
  // ============================================

  /**
   * Active WebSocket subscriptions
   */
  private eventSockets: Map<string, WebSocket> = new Map();
  private eventHandlers: Set<AttestationEventHandler> = new Set();

  /**
   * Subscribe to real-time attestation events
   *
   * Connects to the Witness gateway's WebSocket endpoint to receive
   * push notifications when new attestations are created.
   *
   * @param handler - Callback function for each event
   * @returns Unsubscribe function
   */
  subscribeToEvents(handler: AttestationEventHandler): () => void {
    this.eventHandlers.add(handler);

    // Connect to each gateway if not already connected
    for (const gatewayUrl of this.gatewayUrls) {
      if (!this.eventSockets.has(gatewayUrl)) {
        this.connectEventSocket(gatewayUrl);
      }
    }

    // Return unsubscribe function
    return () => {
      this.eventHandlers.delete(handler);

      // Disconnect if no more handlers
      if (this.eventHandlers.size === 0) {
        this.disconnectAllEventSockets();
      }
    };
  }

  /**
   * Connect to a gateway's WebSocket events endpoint
   */
  private connectEventSocket(gatewayUrl: string): void {
    try {
      // Convert HTTP URL to WebSocket URL
      const wsUrl = gatewayUrl
        .replace(/^http:/, 'ws:')
        .replace(/^https:/, 'wss:')
        + '/ws/events';

      const socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        console.log(`[Witness] WebSocket connected to ${gatewayUrl}`);
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'attestation') {
            // Notify all handlers
            for (const handler of this.eventHandlers) {
              try {
                handler(data as AttestationEvent);
              } catch (err) {
                console.error('[Witness] Event handler error:', err);
              }
            }
          }
        } catch (err) {
          console.warn('[Witness] Failed to parse WebSocket message:', err);
        }
      };

      socket.onerror = (error) => {
        console.warn(`[Witness] WebSocket error for ${gatewayUrl}:`, error);
      };

      socket.onclose = () => {
        console.log(`[Witness] WebSocket disconnected from ${gatewayUrl}`);
        this.eventSockets.delete(gatewayUrl);

        // Reconnect after delay if still have handlers
        if (this.eventHandlers.size > 0) {
          setTimeout(() => {
            if (this.eventHandlers.size > 0 && !this.eventSockets.has(gatewayUrl)) {
              this.connectEventSocket(gatewayUrl);
            }
          }, 5000);
        }
      };

      this.eventSockets.set(gatewayUrl, socket);
    } catch (err) {
      console.warn(`[Witness] Failed to connect WebSocket to ${gatewayUrl}:`, err);
    }
  }

  /**
   * Disconnect all WebSocket connections
   */
  private disconnectAllEventSockets(): void {
    for (const [url, socket] of this.eventSockets) {
      socket.close(1000, 'Client disconnect');
    }
    this.eventSockets.clear();
  }

  /**
   * Check if currently subscribed to events
   */
  isSubscribedToEvents(): boolean {
    return this.eventSockets.size > 0;
  }
}
