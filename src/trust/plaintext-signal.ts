import { Crypto } from '../crypto.js';
import type { TrustSignal } from '../clout-types.js';

export interface PlaintextTrustInput {
  readonly truster: string;
  readonly trustee: string;
  readonly timestamp: number;
  readonly weight?: number;
  readonly revoked?: boolean;
}

export interface CanonicalPlaintextTrust {
  readonly payloadHash: string;
  readonly canonicalWeight: number;
  readonly isRevocation: boolean;
}

export function buildCanonicalPlaintextTrust(input: PlaintextTrustInput): CanonicalPlaintextTrust | null {
  const canonicalWeight = input.weight ?? 1.0;
  if (canonicalWeight < 0 || canonicalWeight > 1) {
    return null;
  }

  const isRevocation = input.revoked === true || canonicalWeight === 0;
  if (input.revoked === true && canonicalWeight !== 0) {
    return null;
  }

  const payload: Record<string, unknown> = {
    truster: input.truster,
    trustee: input.trustee,
    weight: canonicalWeight,
    timestamp: input.timestamp
  };
  if (isRevocation) {
    payload.revoked = true;
  }

  return {
    payloadHash: Crypto.hashObject(payload),
    canonicalWeight,
    isRevocation
  };
}

export function buildPlaintextTrustSignatureMessage(payloadHash: string): Uint8Array {
  return new TextEncoder().encode(`CLOUT_TRUST_SIGNAL_V1:${payloadHash}`);
}

export function signPlaintextTrustPayloadHash(payloadHash: string, privateKey: Uint8Array): Uint8Array {
  return Crypto.sign(buildPlaintextTrustSignatureMessage(payloadHash), privateKey);
}

export function getPlaintextTrustTimestamp(signal: TrustSignal): number {
  return typeof signal.timestamp === 'number' ? signal.timestamp : signal.proof.timestamp;
}

export function verifyCanonicalPlaintextTrustSignal(signal: TrustSignal): boolean {
  const canonical = buildCanonicalPlaintextTrust({
    truster: signal.truster,
    trustee: signal.trustee,
    timestamp: getPlaintextTrustTimestamp(signal),
    weight: signal.weight,
    revoked: signal.revoked
  });
  if (!canonical) {
    return false;
  }

  if (signal.proof.hash !== canonical.payloadHash) {
    return false;
  }

  try {
    const trusterPublicKeyBytes = Crypto.parsePublicKey(signal.truster);
    const signatureMessage = buildPlaintextTrustSignatureMessage(canonical.payloadHash);
    return Crypto.verify(signatureMessage, signal.signature, trusterPublicKeyBytes);
  } catch {
    return false;
  }
}
