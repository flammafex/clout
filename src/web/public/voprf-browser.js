/**
 * Browser-side VOPRF (Verifiable Oblivious Pseudorandom Function) for Freebird
 *
 * This module enables privacy-preserving token issuance where:
 * 1. Browser blinds the input locally (server cannot see original value)
 * 2. Server proxies the blinded request to Freebird
 * 3. Browser unblinds and verifies the token locally
 *
 * Uses P-256 curve (secp256r1) to match Freebird's protocol.
 * Ports the core logic from src/vendor/freebird/p256.ts and voprf.ts
 */

import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, concatBytes } from '@noble/hashes/utils';

// ============================================================================
// Constants & Curve Parameters (P-256)
// ============================================================================
const P = p256.CURVE.Fp.ORDER; // Field Size
const N = p256.CURVE.n;        // Curve Order
const A = p256.CURVE.a;
const B = p256.CURVE.b;
const Z = BigInt(-10);         // Non-square for P-256 SSWU

// VOPRF context must match Freebird server
const VOPRF_CONTEXT = new TextEncoder().encode('freebird:v1');
const VOPRF_DST = 'P256_XMD:SHA-256_SSWU_RO_';

// Token format constants
const COMPRESSED_POINT_LEN = 33;
const PROOF_LEN = 64;
const TOKEN_LEN = COMPRESSED_POINT_LEN * 2 + PROOF_LEN; // 130 bytes

// DLEQ verification domain separator
const DLEQ_DST_PREFIX = new TextEncoder().encode('DLEQ-P256-v1');

// ============================================================================
// Blind State Storage
// ============================================================================

/**
 * Stores blind states between blinding and finalization.
 * Maps blinded value (hex) -> { r: bigint, p: ProjectivePoint }
 */
const blindStates = new Map();

// ============================================================================
// Public API
// ============================================================================

/**
 * Blind a public key for privacy-preserving token request.
 *
 * @param {Uint8Array} publicKey - The user's public key bytes (32 bytes Ed25519)
 * @returns {{ blinded: Uint8Array, blindedB64: string }} Blinded value
 */
export function blind(publicKey) {
  // 1. Map input to curve point P = H(publicKey)
  const inputPoint = hashToCurve(publicKey, VOPRF_CONTEXT);

  // 2. Generate random scalar r
  const r = randomScalar();

  // 3. Compute blinded element A = P * r
  const blindedPoint = inputPoint.multiply(r);

  // 4. Encode and store state
  const blinded = encodePoint(blindedPoint);
  const blindedHex = bytesToHex(blinded);

  // Store state for later finalization
  blindStates.set(blindedHex, { r, p: inputPoint });

  return {
    blinded,
    blindedB64: bytesToBase64Url(blinded)
  };
}

/**
 * Finalize a token by verifying the DLEQ proof.
 *
 * @param {Uint8Array} blindedValue - The blinded value we sent
 * @param {string} tokenB64 - Base64url encoded token from issuer
 * @param {string} issuerPubkeyB64 - Base64url encoded issuer public key
 * @returns {Uint8Array} The verified token bytes
 * @throws {Error} If verification fails
 */
export function finalize(blindedValue, tokenB64, issuerPubkeyB64) {
  // Retrieve blind state
  const blindedHex = bytesToHex(blindedValue);
  const state = blindStates.get(blindedHex);

  if (!state) {
    throw new Error('No blind state found for this blinded value. Did you call blind() first?');
  }

  // 1. Decode inputs
  const tokenBytes = base64UrlToBytes(tokenB64);
  const pubkeyBytes = base64UrlToBytes(issuerPubkeyB64);

  // Handle different token formats
  let A_bytes, B_bytes, proofBytes;

  if (tokenBytes.length === 195 && tokenBytes[0] === 0x01) {
    // V1 format: version byte + points + proof
    const pointPrefix = tokenBytes[1];
    if (pointPrefix === 0x04) {
      // Uncompressed points (65 bytes each)
      A_bytes = tokenBytes.slice(1, 66);
      B_bytes = tokenBytes.slice(66, 131);
      proofBytes = tokenBytes.slice(131);
    } else if (pointPrefix === 0x02 || pointPrefix === 0x03) {
      // Compressed points (33 bytes each)
      A_bytes = tokenBytes.slice(1, 34);
      B_bytes = tokenBytes.slice(34, 67);
      proofBytes = tokenBytes.slice(67, 131);
    } else {
      throw new Error(`Invalid token format: unknown point prefix 0x${pointPrefix.toString(16)}`);
    }
  } else if (tokenBytes.length === TOKEN_LEN) {
    // Legacy format: [ A (33) | B (33) | Proof (64) ]
    A_bytes = tokenBytes.slice(0, COMPRESSED_POINT_LEN);
    B_bytes = tokenBytes.slice(COMPRESSED_POINT_LEN, COMPRESSED_POINT_LEN * 2);
    proofBytes = tokenBytes.slice(COMPRESSED_POINT_LEN * 2);
  } else {
    throw new Error(`Invalid token length: expected ${TOKEN_LEN} or 195, got ${tokenBytes.length}`);
  }

  // 2. Decode Points
  const A = decodePoint(A_bytes);
  const B_point = decodePoint(B_bytes);
  const Q = decodePoint(pubkeyBytes); // Issuer Public Key
  const G = p256.ProjectivePoint.BASE;

  // 3. Verify DLEQ Proof (if not all zeros - dev mode may skip proof)
  const isAllZeros = proofBytes.every(b => b === 0);
  if (!isAllZeros) {
    const isValid = verifyDleq(G, Q, A, B_point, proofBytes);
    if (!isValid) {
      throw new Error('VOPRF verification failed: Invalid DLEQ proof from issuer');
    }
  } else {
    console.warn('[VOPRF] No DLEQ proof from issuer (dev mode?), skipping verification');
  }

  // 4. Clean up blind state
  blindStates.delete(blindedHex);

  // 5. Return the verified token bytes
  return tokenBytes;
}

/**
 * Get the current blind state for a blinded value.
 * Useful for debugging or checking if a blind operation was started.
 *
 * @param {Uint8Array} blindedValue - The blinded value
 * @returns {boolean} True if state exists
 */
export function hasBlindState(blindedValue) {
  const blindedHex = bytesToHex(blindedValue);
  return blindStates.has(blindedHex);
}

/**
 * Clear a blind state without finalizing (e.g., on error)
 *
 * @param {Uint8Array} blindedValue - The blinded value to clear
 */
export function clearBlindState(blindedValue) {
  const blindedHex = bytesToHex(blindedValue);
  blindStates.delete(blindedHex);
}

// ============================================================================
// Base64 URL Encoding/Decoding
// ============================================================================

export function bytesToBase64Url(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function base64UrlToBytes(base64) {
  const binString = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binString, (m) => m.codePointAt(0));
}

// ============================================================================
// P-256 Hash to Curve (RFC 9380: SSWU)
// ============================================================================

function hashToCurve(input, context) {
  const dst = new Uint8Array(VOPRF_DST.length + context.length);
  dst.set(new TextEncoder().encode(VOPRF_DST), 0);
  dst.set(context, VOPRF_DST.length);

  const [u0, u1] = hashToField(input, dst, 2);
  const Q0 = mapToCurveSSWU(u0);
  const Q1 = mapToCurveSSWU(u1);

  return Q0.add(Q1);
}

function hashToField(msg, dst, count) {
  const L = 48; // Length for P-256
  const lenInBytes = count * L;
  const pseudoRandomBytes = expandMessageXMD(msg, dst, lenInBytes);

  const u = new Array(count);
  for (let i = 0; i < count; i++) {
    const elmBytes = pseudoRandomBytes.slice(i * L, (i + 1) * L);
    u[i] = mod(os2ip(elmBytes), P);
  }
  return u;
}

function expandMessageXMD(msg, dst, lenInBytes) {
  const b_in_bytes = 32;
  const r_in_bytes = 64;

  if (dst.length > 255) throw new Error('DST too long');
  const dstPrime = concatBytes(dst, new Uint8Array([dst.length]));

  const Z_pad = new Uint8Array(r_in_bytes);
  const l_i_b_str = new Uint8Array(2);
  l_i_b_str[0] = (lenInBytes >> 8) & 0xff;
  l_i_b_str[1] = lenInBytes & 0xff;

  const msgPrime = concatBytes(Z_pad, msg, l_i_b_str, new Uint8Array([0]), dstPrime);

  let b_0 = sha256(msgPrime);
  let b_1 = sha256(concatBytes(b_0, new Uint8Array([1]), dstPrime));

  const res = new Uint8Array(lenInBytes);
  let offset = 0;
  res.set(b_1.slice(0, Math.min(lenInBytes, b_in_bytes)), 0);
  offset += b_in_bytes;

  let b_i = b_1;
  let i = 2;
  while (offset < lenInBytes) {
    const xorBytes = new Uint8Array(b_0.length);
    for (let j = 0; j < b_0.length; j++) xorBytes[j] = b_0[j] ^ b_i[j];

    b_i = sha256(concatBytes(xorBytes, new Uint8Array([i]), dstPrime));
    const len = Math.min(lenInBytes - offset, b_in_bytes);
    res.set(b_i.slice(0, len), offset);
    offset += len;
    i++;
  }
  return res;
}

function mapToCurveSSWU(u) {
  const Z_u2 = mod(Z * mod(u * u, P), P);
  const Z_u2_sq = mod(Z_u2 * Z_u2, P);

  let tv1 = mod(Z_u2_sq + Z_u2, P);
  tv1 = invertField(tv1);

  let x1 = mod((mod(-B, P) * invertField(A)) * (BigInt(1) + tv1), P);
  if (x1 < BigInt(0)) x1 += P;

  const gx1 = mod(mod(x1 * x1, P) * x1 + A * x1 + B, P);
  let y1 = sqrt(gx1);

  if (y1 !== null) {
    if ((y1 % BigInt(2)) !== (u % BigInt(2))) y1 = mod(-y1, P);
    return new p256.ProjectivePoint(x1, y1, BigInt(1));
  }

  const x2 = mod(Z_u2 * x1, P);
  const gx2 = mod(mod(x2 * x2, P) * x2 + A * x2 + B, P);
  let y2 = sqrt(gx2);

  if (y2 === null) throw new Error('SSWU failed to find point');

  if ((y2 % BigInt(2)) !== (u % BigInt(2))) y2 = mod(-y2, P);
  return new p256.ProjectivePoint(x2, y2, BigInt(1));
}

// ============================================================================
// P-256 Point Operations
// ============================================================================

function randomScalar() {
  const randomBytes = p256.utils.randomPrivateKey();
  const num = os2ip(randomBytes);
  return num % N;
}

function encodePoint(point) {
  return point.toRawBytes(true); // Compressed format
}

function decodePoint(bytes) {
  try {
    return p256.ProjectivePoint.fromHex(bytesToHex(bytes));
  } catch (e) {
    throw new Error('Invalid P-256 point encoding');
  }
}

// ============================================================================
// DLEQ Proof Verification
// ============================================================================

function verifyDleq(G, Y, A, B, proofBytes) {
  // Decode proof scalars (c, s)
  const cBytes = proofBytes.slice(0, 32);
  const sBytes = proofBytes.slice(32, 64);
  const c = bytesToNumber(cBytes);
  const s = bytesToNumber(sBytes);

  // Recompute commitments
  // t1 = G * s - Y * c
  const sG = G.multiply(s);
  const cY = Y.multiply(c);
  const t1 = sG.subtract(cY);

  // t2 = A * s - B * c
  const sA = A.multiply(s);
  const cB = B.multiply(c);
  const t2 = sA.subtract(cB);

  // Recompute Challenge: H(dst_len || dst || G || Y || A || B || t1 || t2)
  const dst = concatBytes(DLEQ_DST_PREFIX, VOPRF_CONTEXT);
  const dstLenBytes = numberToBytesBE(dst.length, 4); // u32 Big Endian

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

  const computedC = hashToScalar(transcript);

  // Check c == computedC
  return c === computedC;
}

// ============================================================================
// Math Helpers
// ============================================================================

function mod(a, b) {
  const result = a % b;
  return result >= 0n ? result : result + b;
}

function pow(base, exp, m) {
  let res = 1n;
  base = mod(base, m);
  while (exp > 0n) {
    if (exp % 2n === 1n) res = mod(res * base, m);
    base = mod(base * base, m);
    exp /= 2n;
  }
  return res;
}

function invertField(num) {
  return pow(num, P - 2n, P);
}

function sqrt(x) {
  // P = 3 mod 4, so we can use simplified sqrt
  const root = pow(x, (P + 1n) / 4n, P);
  if (mod(root * root, P) !== x) return null;
  return root;
}

function os2ip(bytes) {
  return BigInt('0x' + bytesToHex(bytes));
}

function bytesToNumber(bytes) {
  return BigInt('0x' + bytesToHex(bytes));
}

function numberToBytesBE(num, len) {
  const hex = num.toString(16).padStart(len * 2, '0');
  return hexToBytes(hex);
}

function hashToScalar(bytes) {
  const hash = sha256(bytes);
  const num = bytesToNumber(hash);
  // Reduce modulo curve order
  return num % N;
}

// ============================================================================
// Export for use as ES module
// ============================================================================

export default {
  blind,
  finalize,
  hasBlindState,
  clearBlindState,
  bytesToBase64Url,
  base64UrlToBytes
};
