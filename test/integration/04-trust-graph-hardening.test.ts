/**
 * Trust Graph Hardening Integration Tests
 *
 * Validates:
 * 1. Plaintext trust signals require valid truster signature + witness hash binding
 * 2. Newer revocation updates replace prior trust edges
 * 3. Malformed plaintext trust signals are rejected by canonical validation
 */

import assert from 'node:assert/strict';
import { ContentGossip } from '../../src/content-gossip.js';
import { Crypto } from '../../src/crypto.js';
import { buildPostSignatureMessage, hashPostAttestationPayload } from '../../src/post-canonical.js';
import { getPlaintextTrustTimestamp } from '../../src/trust/plaintext-signal.js';
import { ReputationValidator } from '../../src/reputation.js';
import { InvitationManager } from '../../src/invitation.js';
import type { Attestation } from '../../src/types.js';
import type { EncryptedTrustSignal, PostPackage, TrustSignal } from '../../src/clout-types.js';

class MockWitnessClient {
  async timestamp(hash: string): Promise<Attestation> {
    return {
      hash,
      timestamp: Date.now(),
      signatures: ['mock-sig'],
      witnessIds: ['mock-witness']
    };
  }

  async verify(attestation: Attestation): Promise<boolean> {
    return typeof attestation?.hash === 'string' && typeof attestation?.timestamp === 'number';
  }

  async checkNullifier(_nullifier: Uint8Array): Promise<number> {
    return 0;
  }

  getQuorumThreshold(): number {
    return 1;
  }
}

class MockFreebirdClient {
  async blind(_publicKey: any): Promise<Uint8Array> {
    return Crypto.randomBytes(32);
  }

  async issueToken(_blindedValue: Uint8Array): Promise<Uint8Array> {
    return Crypto.randomBytes(32);
  }

  async verifyToken(_token: Uint8Array): Promise<boolean> {
    return true;
  }

  async createOwnershipProof(_secret: Uint8Array): Promise<Uint8Array> {
    return Crypto.randomBytes(32);
  }
}

function createPlaintextTrustSignal(params: {
  trusterPrivateKey: Uint8Array;
  trusterPublicKey: string;
  trusteePublicKey: string;
  timestamp: number;
  weight?: number;
  revoked?: boolean;
}): TrustSignal {
  const weight = params.weight ?? 1.0;
  const isRevocation = params.revoked === true || weight === 0;
  const payload: Record<string, unknown> = {
    truster: params.trusterPublicKey,
    trustee: params.trusteePublicKey,
    weight,
    timestamp: params.timestamp
  };
  if (isRevocation) {
    payload.revoked = true;
  }

  const payloadHash = Crypto.hashObject(payload);
  const signaturePayload = `CLOUT_TRUST_SIGNAL_V1:${payloadHash}`;
  const signature = Crypto.sign(new TextEncoder().encode(signaturePayload), params.trusterPrivateKey);

  return {
    truster: params.trusterPublicKey,
    trustee: params.trusteePublicKey,
    signature,
    proof: {
      hash: payloadHash,
      timestamp: params.timestamp,
      signatures: ['mock-sig'],
      witnessIds: ['mock-witness']
    },
    weight,
    revoked: isRevocation || undefined
  };
}

function createPost(authorPrivateKey: Uint8Array, content: string, timestamp: number): PostPackage {
  const author = Crypto.toHex(Crypto.getPublicKey(authorPrivateKey));
  const signatureMessage = buildPostSignatureMessage({
    content,
    author,
    timestamp
  });
  const signature = Crypto.sign(new TextEncoder().encode(signatureMessage), authorPrivateKey);

  const postWithoutProof: Omit<PostPackage, 'proof'> = {
    id: Crypto.hashString(content),
    content,
    author,
    signature,
    signatureTimestamp: timestamp
  };

  return {
    ...postWithoutProof,
    proof: {
      hash: hashPostAttestationPayload(postWithoutProof),
      timestamp,
      signatures: ['mock-sig'],
      witnessIds: ['mock-witness']
    }
  };
}

function createEncryptedTrustSignal(params: {
  trusterPrivateKey: Uint8Array;
  trusterPublicKey: string;
  trusteePublicKey: string;
  timestamp: number;
  weight?: number;
  revoked?: boolean;
}): EncryptedTrustSignal {
  const weight = params.weight ?? 1.0;
  const encrypted = Crypto.createEncryptedTrustSignal(
    params.trusterPrivateKey,
    params.trusterPublicKey,
    params.trusteePublicKey,
    weight,
    params.timestamp
  );

  return {
    truster: params.trusterPublicKey,
    trusteeCommitment: encrypted.trusteeCommitment,
    encryptedTrustee: encrypted.encryptedTrustee,
    signature: encrypted.signature,
    proof: {
      hash: encrypted.trusteeCommitment,
      timestamp: params.timestamp,
      signatures: ['mock-sig'],
      witnessIds: ['mock-witness']
    },
    weight,
    revoked: params.revoked === true || weight === 0 ? true : undefined,
    version: 'encrypted-v1'
  };
}

async function testPlaintextTrustSpoofingRejectedAndValidAccepted(): Promise<void> {
  const mePriv = Crypto.randomBytes(32);
  const me = Crypto.toHex(Crypto.getPublicKey(mePriv));
  const alicePriv = Crypto.randomBytes(32);
  const alice = Crypto.toHex(Crypto.getPublicKey(alicePriv));
  const bobPriv = Crypto.randomBytes(32);
  const bob = Crypto.toHex(Crypto.getPublicKey(bobPriv));
  const malloryPriv = Crypto.randomBytes(32);

  const acceptedPosts: string[] = [];

  const gossip = new ContentGossip({
    witness: new MockWitnessClient(),
    freebird: new MockFreebirdClient() as any,
    trustGraph: new Set<string>([me, alice]),
    maxHops: 2
  });

  gossip.setReceiveHandler(async (msg) => {
    if (msg.type === 'post' && msg.post) {
      acceptedPosts.push(msg.post.id);
    }
  });

  const now = Date.now();
  try {
    // Mallory spoofs a signal that claims Alice trusts Bob -> must be rejected.
    const spoofed = createPlaintextTrustSignal({
      trusterPrivateKey: malloryPriv,
      trusterPublicKey: alice,
      trusteePublicKey: bob,
      timestamp: now - 1000
    });

    await gossip.onReceive({ type: 'trust', trustSignal: spoofed, timestamp: now - 1000 });
    await gossip.onReceive({
      type: 'post',
      post: createPost(bobPriv, 'post-after-spoofed-trust', now - 900),
      timestamp: now - 900
    });

    assert.equal(acceptedPosts.length, 0, 'spoofed trust signal should not create a trust edge');

    // Valid Alice->Bob signal should allow Bob's posts (2 hops from me via Alice).
    const valid = createPlaintextTrustSignal({
      trusterPrivateKey: alicePriv,
      trusterPublicKey: alice,
      trusteePublicKey: bob,
      timestamp: now - 800
    });

    await gossip.onReceive({ type: 'trust', trustSignal: valid, timestamp: now - 800 });
    await gossip.onReceive({
      type: 'post',
      post: createPost(bobPriv, 'post-after-valid-trust', now - 700),
      timestamp: now - 700
    });

    assert.equal(acceptedPosts.length, 1, 'valid trust signal should create trust edge for 2-hop post visibility');
  } finally {
    gossip.destroy();
  }
}

async function testPlaintextCanonicalValidationRejectsMalformedVariants(): Promise<void> {
  const me = Crypto.toHex(Crypto.getPublicKey(Crypto.randomBytes(32)));
  const alicePriv = Crypto.randomBytes(32);
  const alice = Crypto.toHex(Crypto.getPublicKey(alicePriv));
  const bobPriv = Crypto.randomBytes(32);
  const bob = Crypto.toHex(Crypto.getPublicKey(bobPriv));
  const now = Date.now();

  const validSignal = createPlaintextTrustSignal({
    trusterPrivateKey: alicePriv,
    trusterPublicKey: alice,
    trusteePublicKey: bob,
    timestamp: now - 1000,
    weight: 1.0
  });

  const malformedSignals: Array<{ label: string; signal: TrustSignal }> = [
    {
      label: 'revoked=true with non-zero weight',
      signal: {
        ...validSignal,
        revoked: true
      }
    },
    {
      label: 'weight out of range',
      signal: {
        ...validSignal,
        weight: 1.5
      }
    },
    {
      label: 'proof hash mismatch',
      signal: {
        ...validSignal,
        proof: {
          ...validSignal.proof,
          hash: 'deadbeef'
        }
      }
    }
  ];

  for (const malformed of malformedSignals) {
    const acceptedPosts: string[] = [];
    const gossip = new ContentGossip({
      witness: new MockWitnessClient(),
      freebird: new MockFreebirdClient() as any,
      trustGraph: new Set<string>([me, alice]),
      maxHops: 2
    });
    gossip.setReceiveHandler(async (msg) => {
      if (msg.type === 'post' && msg.post) {
        acceptedPosts.push(msg.post.id);
      }
    });

    try {
      await gossip.onReceive({ type: 'trust', trustSignal: malformed.signal, timestamp: now - 900 });
      await gossip.onReceive({
        type: 'post',
        post: createPost(bobPriv, `post-after-malformed-${malformed.label}`, now - 800),
        timestamp: now - 800
      });
      assert.equal(
        acceptedPosts.length,
        0,
        `malformed plaintext signal (${malformed.label}) should not create trust edge`
      );
    } finally {
      gossip.destroy();
    }
  }
}

async function testRevocationReplacesPriorEdge(): Promise<void> {
  const mePriv = Crypto.randomBytes(32);
  const me = Crypto.toHex(Crypto.getPublicKey(mePriv));
  const alicePriv = Crypto.randomBytes(32);
  const alice = Crypto.toHex(Crypto.getPublicKey(alicePriv));
  const bobPriv = Crypto.randomBytes(32);
  const bob = Crypto.toHex(Crypto.getPublicKey(bobPriv));

  const acceptedPosts: string[] = [];

  const gossip = new ContentGossip({
    witness: new MockWitnessClient(),
    freebird: new MockFreebirdClient() as any,
    trustGraph: new Set<string>([me, alice]),
    maxHops: 2
  });

  gossip.setReceiveHandler(async (msg) => {
    if (msg.type === 'post' && msg.post) {
      acceptedPosts.push(msg.post.id);
    }
  });

  const now = Date.now();
  try {
    const trust = createPlaintextTrustSignal({
      trusterPrivateKey: alicePriv,
      trusterPublicKey: alice,
      trusteePublicKey: bob,
      timestamp: now - 1000,
      weight: 1.0
    });
    await gossip.onReceive({ type: 'trust', trustSignal: trust, timestamp: now - 1000 });

    await gossip.onReceive({
      type: 'post',
      post: createPost(bobPriv, 'post-before-revocation', now - 900),
      timestamp: now - 900
    });
    assert.equal(acceptedPosts.length, 1, 'post should be accepted before revocation');

    const revoke = createPlaintextTrustSignal({
      trusterPrivateKey: alicePriv,
      trusterPublicKey: alice,
      trusteePublicKey: bob,
      timestamp: now - 800,
      weight: 0,
      revoked: true
    });
    await gossip.onReceive({ type: 'trust', trustSignal: revoke, timestamp: now - 800 });

    await gossip.onReceive({
      type: 'post',
      post: createPost(bobPriv, 'post-after-revocation', now - 700),
      timestamp: now - 700
    });
    assert.equal(acceptedPosts.length, 1, 'newer revocation should remove trust edge');
  } finally {
    gossip.destroy();
  }
}

async function testReputationUsesFirstHopWeight(): Promise<void> {
  const selfPriv = Crypto.randomBytes(32);
  const selfKey = Crypto.toHex(Crypto.getPublicKey(selfPriv));
  const alicePriv = Crypto.randomBytes(32);
  const aliceKey = Crypto.toHex(Crypto.getPublicKey(alicePriv));

  const validator = new ReputationValidator({
    selfPublicKey: selfKey,
    trustGraph: new Set([aliceKey]),
    witness: new MockWitnessClient() as any,
    maxHops: 3,
    trustDecayDays: 0
  });

  validator.addTrustSignal({
    truster: selfKey,
    trustee: aliceKey,
    signature: Crypto.randomBytes(64),
    proof: {
      hash: 'mock',
      timestamp: Date.now(),
      signatures: ['mock-sig'],
      witnessIds: ['mock-witness']
    },
    weight: 0.2
  });

  const rep = validator.computeReputation(aliceKey);
  // distance-1 base 0.9 * weight 0.2 + diversity bonus 0.05 = 0.23
  assert.ok(Math.abs(rep.score - 0.23) < 0.000001, `expected score 0.23, got ${rep.score}`);
}

async function testReputationCountsDistinctPaths(): Promise<void> {
  const selfKey = Crypto.toHex(Crypto.getPublicKey(Crypto.randomBytes(32)));
  const aliceKey = Crypto.toHex(Crypto.getPublicKey(Crypto.randomBytes(32)));
  const bobKey = Crypto.toHex(Crypto.getPublicKey(Crypto.randomBytes(32)));
  const carolKey = Crypto.toHex(Crypto.getPublicKey(Crypto.randomBytes(32)));

  const validator = new ReputationValidator({
    selfPublicKey: selfKey,
    trustGraph: new Set([aliceKey, bobKey]),
    witness: new MockWitnessClient() as any,
    maxHops: 3,
    trustDecayDays: 0
  });

  validator.addTrustSignal({
    truster: aliceKey,
    trustee: carolKey,
    signature: Crypto.randomBytes(64),
    proof: { hash: 'mock-a', timestamp: Date.now(), signatures: ['mock-sig'], witnessIds: ['mock-witness'] },
    weight: 1.0
  });
  validator.addTrustSignal({
    truster: bobKey,
    trustee: carolKey,
    signature: Crypto.randomBytes(64),
    proof: { hash: 'mock-b', timestamp: Date.now(), signatures: ['mock-sig'], witnessIds: ['mock-witness'] },
    weight: 1.0
  });

  const rep = validator.computeReputation(carolKey);
  assert.equal(rep.distance, 2);
  assert.equal(rep.pathCount, 2, `expected 2 paths, got ${rep.pathCount}`);
  // distance-2 base 0.6 + diversity bonus 0.1
  assert.ok(Math.abs(rep.score - 0.7) < 0.000001, `expected score 0.7, got ${rep.score}`);
}

async function testEncryptedOrderingIgnoresOlderRevocation(): Promise<void> {
  const mePrivEd = Crypto.randomBytes(32);
  const mePubEd = Crypto.toHex(Crypto.getPublicKey(mePrivEd));
  const mePubEdBytes = Crypto.getPublicKey(mePrivEd);

  const alicePriv = Crypto.randomBytes(32);
  const alicePub = Crypto.toHex(Crypto.getPublicKey(alicePriv));

  const acceptedPosts: string[] = [];
  const gossip = new ContentGossip({
    witness: new MockWitnessClient(),
    freebird: new MockFreebirdClient() as any,
    trustGraph: new Set<string>([alicePub]),
    maxHops: 2,
    encryptionKey: {
      publicKey: mePubEdBytes,
      privateKey: mePrivEd
    },
    ourPublicKey: mePubEd
  });

  gossip.setReceiveHandler(async (msg) => {
    if (msg.type === 'post' && msg.post) {
      acceptedPosts.push(msg.post.id);
    }
  });

  const now = Date.now();
  const newerTrust = createEncryptedTrustSignal({
    trusterPrivateKey: alicePriv,
    trusterPublicKey: alicePub,
    trusteePublicKey: mePubEd,
    timestamp: now - 700,
    weight: 1.0
  });
  const olderRevoke = createEncryptedTrustSignal({
    trusterPrivateKey: alicePriv,
    trusterPublicKey: alicePub,
    trusteePublicKey: mePubEd,
    timestamp: now - 900,
    weight: 0,
    revoked: true
  });

  try {
    await gossip.onReceive({ type: 'trust-encrypted', encryptedTrustSignal: newerTrust, timestamp: now - 700 });
    await gossip.onReceive({ type: 'trust-encrypted', encryptedTrustSignal: olderRevoke, timestamp: now - 900 });

    await gossip.onReceive({
      type: 'post',
      post: createPost(mePrivEd, 'post-after-older-revoke', now - 600),
      timestamp: now - 600
    });

    assert.equal(acceptedPosts.length, 1, 'older encrypted revocation must not override newer trust');
  } finally {
    gossip.destroy();
  }
}

async function testEncryptedOrderingAppliesNewerRevocation(): Promise<void> {
  const mePrivEd = Crypto.randomBytes(32);
  const mePubEd = Crypto.toHex(Crypto.getPublicKey(mePrivEd));
  const mePubEdBytes = Crypto.getPublicKey(mePrivEd);

  const alicePriv = Crypto.randomBytes(32);
  const alicePub = Crypto.toHex(Crypto.getPublicKey(alicePriv));

  const acceptedPosts: string[] = [];
  const gossip = new ContentGossip({
    witness: new MockWitnessClient(),
    freebird: new MockFreebirdClient() as any,
    trustGraph: new Set<string>([alicePub]),
    maxHops: 2,
    encryptionKey: {
      publicKey: mePubEdBytes,
      privateKey: mePrivEd
    },
    ourPublicKey: mePubEd
  });

  gossip.setReceiveHandler(async (msg) => {
    if (msg.type === 'post' && msg.post) {
      acceptedPosts.push(msg.post.id);
    }
  });

  const now = Date.now();
  const olderTrust = createEncryptedTrustSignal({
    trusterPrivateKey: alicePriv,
    trusterPublicKey: alicePub,
    trusteePublicKey: mePubEd,
    timestamp: now - 900,
    weight: 1.0
  });
  const newerRevoke = createEncryptedTrustSignal({
    trusterPrivateKey: alicePriv,
    trusterPublicKey: alicePub,
    trusteePublicKey: mePubEd,
    timestamp: now - 700,
    weight: 0,
    revoked: true
  });

  try {
    await gossip.onReceive({ type: 'trust-encrypted', encryptedTrustSignal: olderTrust, timestamp: now - 900 });
    await gossip.onReceive({ type: 'trust-encrypted', encryptedTrustSignal: newerRevoke, timestamp: now - 700 });

    await gossip.onReceive({
      type: 'post',
      post: createPost(mePrivEd, 'post-after-newer-revoke', now - 600),
      timestamp: now - 600
    });

    assert.equal(acceptedPosts.length, 0, 'newer encrypted revocation must override older trust');
  } finally {
    gossip.destroy();
  }
}

async function testInvitationTrustSignalUsesCanonicalPlaintextFormat(): Promise<void> {
  const inviterPriv = Crypto.randomBytes(32);
  const inviterPub = Crypto.toHex(Crypto.getPublicKey(inviterPriv));
  const inviteePriv = Crypto.randomBytes(32);
  const inviteePubBytes = Crypto.getPublicKey(inviteePriv);
  const inviteePub = Crypto.toHex(inviteePubBytes);

  const witness = new MockWitnessClient();
  const freebird = new MockFreebirdClient();

  const manager = new InvitationManager(
    { bytes: inviteePubBytes },
    freebird as any,
    witness as any,
    (message: Uint8Array) => Crypto.sign(message, inviteePriv)
  );

  const codePayload = {
    i: inviteePub,
    t: Crypto.toHex(Crypto.randomBytes(32))
  };
  const code = Buffer.from(JSON.stringify(codePayload)).toString('base64url');
  const invitationData = {
    inviter: inviterPub,
    invitee: inviteePub,
    token: Crypto.toHex(Crypto.randomBytes(32)),
    timestamp: Date.now() - 1000
  };
  const invitationProof = await witness.timestamp(Crypto.hashObject(invitationData));
  const invitation = {
    inviter: inviterPub,
    invitee: inviteePub,
    token: Crypto.randomBytes(32),
    proof: invitationProof,
    code
  };
  (manager as any).createdInvitations.set(code, invitation);

  const accepted = await manager.acceptInvitation(code);
  const trustSignal = accepted.trustSignal;

  const canonicalPayload = {
    truster: inviteePub,
    trustee: inviterPub,
    weight: 1.0,
    timestamp: getPlaintextTrustTimestamp(trustSignal)
  };
  const payloadHash = Crypto.hashObject(canonicalPayload);
  assert.equal(trustSignal.proof.hash, payloadHash, 'trust signal proof hash should bind canonical payload');

  const signatureInput = `CLOUT_TRUST_SIGNAL_V1:${payloadHash}`;
  const isValidSig = Crypto.verify(
    new TextEncoder().encode(signatureInput),
    trustSignal.signature,
    inviteePubBytes
  );
  assert.equal(isValidSig, true, 'invitation trust signal signature should verify canonically');

  const acceptedPosts: string[] = [];
  const gossip = new ContentGossip({
    witness,
    freebird: freebird as any,
    trustGraph: new Set([inviteePub]),
    maxHops: 2
  });

  gossip.setReceiveHandler(async (msg) => {
    if (msg.type === 'post' && msg.post) {
      acceptedPosts.push(msg.post.id);
    }
  });

  try {
    await gossip.onReceive({ type: 'trust', trustSignal, timestamp: Date.now() });
    await gossip.onReceive({
      type: 'post',
      post: createPost(inviterPriv, 'post-after-invitation-trust', Date.now()),
      timestamp: Date.now()
    });
    assert.equal(acceptedPosts.length, 1, 'canonical invitation trust signal should be accepted by gossip verifier');
  } finally {
    gossip.destroy();
  }
}

async function main(): Promise<void> {
  console.log('\n========================================');
  console.log('Trust Graph Hardening Integration Tests');
  console.log('========================================');

  await testPlaintextTrustSpoofingRejectedAndValidAccepted();
  console.log('✅ plaintext trust signature/hash verification');

  await testPlaintextCanonicalValidationRejectsMalformedVariants();
  console.log('✅ plaintext canonical validation rejects malformed variants');

  await testRevocationReplacesPriorEdge();
  console.log('✅ trust revocation replaces prior edge');

  await testReputationUsesFirstHopWeight();
  console.log('✅ reputation applies first-hop trust weights');

  await testReputationCountsDistinctPaths();
  console.log('✅ reputation counts distinct trust paths');

  await testEncryptedOrderingIgnoresOlderRevocation();
  console.log('✅ encrypted trust ignores older revocation updates');

  await testEncryptedOrderingAppliesNewerRevocation();
  console.log('✅ encrypted trust applies newer revocations');

  await testInvitationTrustSignalUsesCanonicalPlaintextFormat();
  console.log('✅ invitation trust signal uses canonical plaintext format');

  console.log('\n========================================');
  console.log('✅ ALL TRUST GRAPH HARDENING TESTS PASSED');
  console.log('========================================\n');
}

main().catch((error) => {
  console.error('❌ Trust graph hardening tests failed:', error);
  process.exit(1);
});
