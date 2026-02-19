/**
 * Web Route Hardening Integration Tests
 *
 * Validates:
 * 1. Freebird proxy uses request-scoped sybil proofs (no shared mutable mode/code state)
 * 2. Owner-only admin GET routes require signed proof (header spoofing blocked)
 * 3. /api/media/stats is not shadowed by /:cid
 */

import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { Crypto } from '../../src/crypto.js';
import { buildPostSignatureMessage } from '../../src/post-canonical.js';
import { createFreebirdProxyRoutes } from '../../src/web/routes/freebird-proxy.js';
import { createAdminRoutes } from '../../src/web/routes/admin.js';
import { createMediaRoutes } from '../../src/web/routes/media.js';
import { createSubmitRoutes } from '../../src/web/routes/submit.js';

async function withServer(
  app: express.Express,
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

async function postJson(baseUrl: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function get(baseUrl: string, path: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'GET',
    headers
  });
}

async function post(
  baseUrl: string,
  path: string,
  body: unknown
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

async function testFreebirdProxyIsRequestScoped(): Promise<void> {
  const proofs: Array<{ type: string; code?: string; user_id?: string }> = [];
  const registeredMarks: Array<{ publicKey: string; registered: boolean }> = [];

  const adapter = {
    getSybilMode: () => 'invitation',
    getIssuerMetadata: async () => ({
      issuer_id: 'issuer:test:v1',
      voprf: { pubkey: 'fake-pubkey' }
    }),
    issueTokenWithSybilProof: async (_blinded: Uint8Array, proof: any) => {
      proofs.push({ type: proof.type, code: proof.code, user_id: proof.user_id });
      return new Uint8Array([1, 2, 3, 4]);
    },
    issueToken: async () => {
      throw new Error('Unexpected fallback to adapter global state');
    }
  } as any;

  const app = express();
  app.use(express.json());
  app.use('/api/freebird', createFreebirdProxyRoutes({
    getFreebirdAdapter: () => adapter,
    isInitialized: () => true,
    isUserRegistered: async () => false,
    setUserRegistered: async (publicKey: string, registered: boolean) => {
      registeredMarks.push({ publicKey, registered });
    },
    getReservedInvitationSignature: async (code: string, publicKey: string) => {
      if (code === 'codeA' && publicKey === 'a'.repeat(64)) return '1'.repeat(128);
      if (code === 'codeB' && publicKey === 'b'.repeat(64)) return '2'.repeat(128);
      return null;
    }
  }));

  await withServer(app, async (baseUrl) => {
    const blinded = bytesToBase64Url(new Uint8Array([7, 8, 9]));

    const [respA, respB] = await Promise.all([
      postJson(baseUrl, '/api/freebird/proxy/issue', {
        blinded_element_b64: blinded,
        invitation_code: 'codeA',
        user_public_key: 'a'.repeat(64)
      }),
      postJson(baseUrl, '/api/freebird/proxy/issue', {
        blinded_element_b64: blinded,
        invitation_code: 'codeB',
        user_public_key: 'b'.repeat(64)
      })
    ]);

    assert.equal(respA.status, 200);
    assert.equal(respB.status, 200);
  });

  assert.equal(proofs.length, 2);
  assert(proofs.some((p) => p.type === 'invitation' && p.code === 'codeA'));
  assert(proofs.some((p) => p.type === 'invitation' && p.code === 'codeB'));
  assert.equal(registeredMarks.length, 0, 'proxy token issuance must not mark users as registered');
}

async function testAdminGetRequiresSignature(): Promise<void> {
  const ownerPrivateKey = Crypto.randomBytes(32);
  const ownerPublicKey = Crypto.toHex(Crypto.getPublicKey(ownerPrivateKey));

  const app = express();
  app.use(express.json());
  app.use('/api', createAdminRoutes({
    getClout: () => ({ getDisplayName: () => 'User' } as any),
    isInitialized: () => true,
    getStore: () => ({ getAllMemberQuotas: () => [] } as any),
    getOwnerPublicKey: () => ownerPublicKey
  }));

  await withServer(app, async (baseUrl) => {
    // Spoof attempt: owner public key only, no signature
    const spoof = await get(baseUrl, '/api/admin/members', {
      'X-User-PublicKey': ownerPublicKey
    });
    assert.equal(spoof.status, 403);
    const spoofBody = await spoof.json() as any;
    assert.match(spoofBody.error, /Missing admin signature/i);

    // Valid signed owner request
    const ts = Date.now();
    const payload = `admin:members/list:${ownerPublicKey}:${ts}`;
    const sig = Crypto.toHex(Crypto.sign(new TextEncoder().encode(payload), ownerPrivateKey));

    const ok = await get(baseUrl, '/api/admin/members', {
      'X-User-PublicKey': ownerPublicKey,
      'X-Admin-Signature': sig,
      'X-Admin-Timestamp': String(ts)
    });
    assert.equal(ok.status, 200);
  });
}

async function testMediaStatsNotShadowed(): Promise<void> {
  const app = express();
  const clout = {
    getMediaStats: async () => ({ total: 42 }),
    resolveMedia: async (cid: string) => cid === 'stats' ? new Uint8Array([0xde, 0xad]) : null,
    getMediaMetadata: () => null,
    getFeed: async () => [],
    resolvePostMedia: async () => null,
    hasMedia: async () => false
  } as any;

  app.use('/api/media', createMediaRoutes(() => clout, () => true));

  await withServer(app, async (baseUrl) => {
    const resp = await get(baseUrl, '/api/media/stats');
    assert.equal(resp.status, 200);
    const contentType = resp.headers.get('content-type') || '';
    assert.match(contentType, /application\/json/i);
    const body = await resp.json() as any;
    assert.equal(body.success, true);
    assert.equal(body.data.total, 42);
  });
}

async function testSubmitMutationsHaveReplayAndFreshnessProtection(): Promise<void> {
  const authorPrivateKey = Crypto.randomBytes(32);
  const authorPublicKey = Crypto.toHex(Crypto.getPublicKey(authorPrivateKey));
  const basePostId = Crypto.hashString('base post');

  const feed = [{
    id: basePostId,
    content: 'base post',
    author: authorPublicKey,
    replyTo: undefined as string | undefined,
    nsfw: false,
    contentWarning: undefined as string | undefined
  }];

  const clout = {
    getStore: () => ({
      getFeed: async () => feed,
      addDeletion: async () => {}
    }),
    getWitnessProof: async (hash: string) => ({
      hash,
      timestamp: Date.now(),
      signatures: ['mock-sig'],
      witnessIds: ['mock-witness']
    }),
    relayPost: async () => ({
      hash: 'mock-post',
      timestamp: Date.now(),
      signatures: ['mock-sig'],
      witnessIds: ['mock-witness']
    })
  } as any;

  const app = express();
  app.use(express.json());
  app.use('/api', createSubmitRoutes({
    getClout: () => clout,
    isInitialized: () => true,
    getUserTicket: async () => ({
      expiry: Date.now() + 60_000,
      proof: new Uint8Array([1, 2, 3])
    })
  }));

  await withServer(app, async (baseUrl) => {
    // Retract freshness check
    const staleTs = Date.now() - (6 * 60 * 1000);
    const staleRetractPayload = `retract:${basePostId}:${authorPublicKey}:${staleTs}`;
    const staleRetractSig = Crypto.toHex(Crypto.sign(new TextEncoder().encode(staleRetractPayload), authorPrivateKey));
    const staleRetract = await post(baseUrl, '/api/retract/submit', {
      postId: basePostId,
      author: authorPublicKey,
      signature: staleRetractSig,
      timestamp: staleTs
    });
    assert.equal(staleRetract.status, 401);

    // Retract replay check
    const retractTs = Date.now();
    const retractPayload = `retract:${basePostId}:${authorPublicKey}:${retractTs}`;
    const retractSig = Crypto.toHex(Crypto.sign(new TextEncoder().encode(retractPayload), authorPrivateKey));
    const retractBody = {
      postId: basePostId,
      author: authorPublicKey,
      signature: retractSig,
      timestamp: retractTs
    };
    const retractOk = await post(baseUrl, '/api/retract/submit', retractBody);
    assert.equal(retractOk.status, 200);
    const retractReplay = await post(baseUrl, '/api/retract/submit', retractBody);
    assert.equal(retractReplay.status, 409);

    // Edit freshness check
    const staleEditTs = Date.now() - (6 * 60 * 1000);
    const staleEditMessage = buildPostSignatureMessage({
      content: 'edited content',
      author: authorPublicKey,
      timestamp: staleEditTs,
      replyTo: null,
      mediaCid: null,
      link: null,
      nsfw: false,
      contentWarning: null
    });
    const staleEditSig = Crypto.toHex(Crypto.sign(new TextEncoder().encode(staleEditMessage), authorPrivateKey));
    const staleEdit = await post(baseUrl, '/api/edit/submit', {
      originalPostId: basePostId,
      content: 'edited content',
      author: authorPublicKey,
      signature: staleEditSig,
      timestamp: staleEditTs,
      nsfw: false
    });
    assert.equal(staleEdit.status, 401);

    // Edit replay check
    const editTs = Date.now();
    const editMessage = buildPostSignatureMessage({
      content: 'edited content v2',
      author: authorPublicKey,
      timestamp: editTs,
      replyTo: null,
      mediaCid: null,
      link: null,
      nsfw: false,
      contentWarning: null
    });
    const editSig = Crypto.toHex(Crypto.sign(new TextEncoder().encode(editMessage), authorPrivateKey));
    const editBody = {
      originalPostId: basePostId,
      content: 'edited content v2',
      author: authorPublicKey,
      signature: editSig,
      timestamp: editTs,
      nsfw: false
    };
    const editOk = await post(baseUrl, '/api/edit/submit', editBody);
    assert.equal(editOk.status, 200);
    const editReplay = await post(baseUrl, '/api/edit/submit', editBody);
    assert.equal(editReplay.status, 409);
  });
}

async function testSubmitIgnoresUnsignedProfileMetadata(): Promise<void> {
  const authorPrivateKey = Crypto.randomBytes(32);
  const authorPublicKey = Crypto.toHex(Crypto.getPublicKey(authorPrivateKey));
  let relayedPost: any = null;

  const clout = {
    relayPost: async (postPackage: any) => {
      relayedPost = postPackage;
      return {
        hash: 'mock-post',
        timestamp: Date.now(),
        signatures: ['mock-sig'],
        witnessIds: ['mock-witness']
      };
    }
  } as any;

  const app = express();
  app.use(express.json());
  app.use('/api', createSubmitRoutes({
    getClout: () => clout,
    isInitialized: () => true,
    getUserTicket: async () => ({
      expiry: Date.now() + 60_000,
      proof: new Uint8Array([1, 2, 3])
    })
  }));

  await withServer(app, async (baseUrl) => {
    const ts = Date.now();
    const message = buildPostSignatureMessage({
      content: 'hello world',
      author: authorPublicKey,
      timestamp: ts,
      replyTo: null,
      mediaCid: null,
      link: null,
      nsfw: false,
      contentWarning: null
    });
    const sig = Crypto.toHex(Crypto.sign(new TextEncoder().encode(message), authorPrivateKey));

    const resp = await post(baseUrl, '/api/post/submit', {
      content: 'hello world',
      author: authorPublicKey,
      signature: sig,
      timestamp: ts,
      nsfw: false,
      authorDisplayName: 'tampered-name',
      authorAvatar: 'tampered-avatar'
    });
    assert.equal(resp.status, 200);
  });

  assert.ok(relayedPost, 'expected a post package to be relayed');
  assert.equal(relayedPost.authorDisplayName, undefined);
  assert.equal(relayedPost.authorAvatar, undefined);
}

async function testDayPassMintEnforcesInvitationAndTokenReplayRules(): Promise<void> {
  const keyAPriv = Crypto.randomBytes(32);
  const keyAPub = Crypto.toHex(Crypto.getPublicKey(keyAPriv));
  const keyBPub = Crypto.toHex(Crypto.getPublicKey(Crypto.randomBytes(32)));
  const token = Buffer.from(Crypto.randomBytes(195)).toString('base64url');

  const consumed: Array<{ code: string; publicKey: string }> = [];
  const registered = new Set<string>();
  const marked: string[] = [];
  const storedTickets: Array<{ publicKey: string }> = [];

  const clout = {
    verifyFreebirdToken: async () => true,
    getWitnessProof: async (hash: string) => ({
      hash,
      timestamp: Date.now(),
      signatures: ['mock-sig'],
      witnessIds: ['mock-witness']
    })
  } as any;

  const app = express();
  app.use(express.json());
  app.use('/api', createSubmitRoutes({
    getClout: () => clout,
    isInitialized: () => true,
    getUserTicket: async () => null,
    setUserTicket: async (publicKey: string, _ticket: any) => {
      storedTickets.push({ publicKey });
    },
    clearUserTicket: async () => {},
    isUserRegistered: async (publicKey: string) => registered.has(publicKey),
    setUserRegistered: async (publicKey: string, isReg: boolean) => {
      if (isReg) {
        registered.add(publicKey);
        marked.push(publicKey);
      } else {
        registered.delete(publicKey);
      }
    },
    consumeInvitationCode: async (code: string, publicKey: string) => {
      if (code === 'invite-a' && publicKey === keyAPub) {
        consumed.push({ code, publicKey });
        return true;
      }
      return false;
    }
  }));

  await withServer(app, async (baseUrl) => {
    // Unregistered user must provide invitation code.
    const missingInvite = await post(baseUrl, '/api/daypass/mint', {
      publicKey: keyAPub,
      token
    });
    assert.equal(missingInvite.status, 400);

    // Invitation-backed mint succeeds and marks user as registered.
    const firstMint = await post(baseUrl, '/api/daypass/mint', {
      publicKey: keyAPub,
      token,
      invitationCode: 'invite-a'
    });
    assert.equal(firstMint.status, 200);
    assert.equal(consumed.length, 1);
    assert.equal(marked.includes(keyAPub), true);

    // Token replay for same identity should fail.
    const replaySameUser = await post(baseUrl, '/api/daypass/mint', {
      publicKey: keyAPub,
      token
    });
    assert.equal(replaySameUser.status, 409);

    // Token replay across identities should fail.
    const replayOtherUser = await post(baseUrl, '/api/daypass/mint', {
      publicKey: keyBPub,
      token
    });
    assert.equal(replayOtherUser.status, 409);
  });

  assert.equal(storedTickets.length, 1);
  assert.equal(storedTickets[0].publicKey, keyAPub);
}

async function testDayPassMintDoesNotConsumeInvitationOnTicketPersistFailure(): Promise<void> {
  const userKey = Crypto.toHex(Crypto.getPublicKey(Crypto.randomBytes(32)));
  const token = Buffer.from(Crypto.randomBytes(195)).toString('base64url');
  let consumedCount = 0;

  const clout = {
    verifyFreebirdToken: async () => true,
    getWitnessProof: async (hash: string) => ({
      hash,
      timestamp: Date.now(),
      signatures: ['mock-sig'],
      witnessIds: ['mock-witness']
    })
  } as any;

  const app = express();
  app.use(express.json());
  app.use('/api', createSubmitRoutes({
    getClout: () => clout,
    isInitialized: () => true,
    getUserTicket: async () => null,
    setUserTicket: async () => {
      throw new Error('disk write failed');
    },
    clearUserTicket: async () => {},
    isUserRegistered: async () => false,
    consumeInvitationCode: async () => {
      consumedCount++;
      return true;
    }
  }));

  await withServer(app, async (baseUrl) => {
    const resp = await post(baseUrl, '/api/daypass/mint', {
      publicKey: userKey,
      token,
      invitationCode: 'invite-fail'
    });
    assert.equal(resp.status, 400);
  });

  assert.equal(consumedCount, 0, 'invitation should not be consumed when ticket persistence fails');
}

async function testFederationImportRequiresOwnerSignedAuth(): Promise<void> {
  const ownerPrivateKey = Crypto.randomBytes(32);
  const ownerPublicKey = Crypto.toHex(Crypto.getPublicKey(ownerPrivateKey));
  let imported = 0;

  const adapter = {
    setFederatedToken: () => { imported++; },
    getSybilMode: () => 'federated_trust',
    getIssuerMetadata: async () => ({ issuer_id: 'issuer:test:v1', voprf: { pubkey: 'pk' } }),
    hasFederatedToken: () => false,
    getFederatedToken: () => undefined
  } as any;

  const app = express();
  app.use(express.json());
  app.use('/api/freebird', createFreebirdProxyRoutes({
    getFreebirdAdapter: () => adapter,
    isInitialized: () => true,
    getOwnerPublicKey: () => ownerPublicKey
  }));

  const federatedToken = {
    source_issuer_id: 'issuer:other:v1',
    token_b64: Buffer.from(Crypto.randomBytes(32)).toString('base64url'),
    expires_at: Math.floor(Date.now() / 1000) + 3600
  };

  await withServer(app, async (baseUrl) => {
    const spoof = await post(baseUrl, '/api/freebird/federation/import-token', {
      federated_token: federatedToken,
      userPublicKey: ownerPublicKey
    });
    assert.equal(spoof.status, 403);

    const ts = Date.now();
    const payload = `admin:federation/import-token:${ownerPublicKey}:${ts}`;
    const sig = Crypto.toHex(Crypto.sign(new TextEncoder().encode(payload), ownerPrivateKey));

    const ok = await post(baseUrl, '/api/freebird/federation/import-token', {
      federated_token: federatedToken,
      userPublicKey: ownerPublicKey,
      adminSignature: sig,
      adminTimestamp: ts
    });
    assert.equal(ok.status, 200);
  });

  assert.equal(imported, 1, 'federation token should be imported exactly once');
}

async function main(): Promise<void> {
  console.log('\n========================================');
  console.log('Web Route Hardening Integration Tests');
  console.log('========================================');

  await testFreebirdProxyIsRequestScoped();
  console.log('✅ request-scoped Freebird proof flow');

  await testAdminGetRequiresSignature();
  console.log('✅ admin owner-read GET signature requirement');

  await testMediaStatsNotShadowed();
  console.log('✅ /api/media/stats route precedence');

  await testSubmitMutationsHaveReplayAndFreshnessProtection();
  console.log('✅ submit edit/retract freshness + replay protection');

  await testSubmitIgnoresUnsignedProfileMetadata();
  console.log('✅ submit ignores unsigned profile metadata');

  await testDayPassMintEnforcesInvitationAndTokenReplayRules();
  console.log('✅ daypass mint invitation + token replay hardening');

  await testDayPassMintDoesNotConsumeInvitationOnTicketPersistFailure();
  console.log('✅ daypass mint does not burn invitation on ticket persist failure');

  await testFederationImportRequiresOwnerSignedAuth();
  console.log('✅ federation import requires owner-signed authorization');

  console.log('\n========================================');
  console.log('✅ ALL WEB ROUTE HARDENING TESTS PASSED');
  console.log('========================================\n');
}

main().catch((error) => {
  console.error('❌ Web route hardening tests failed:', error);
  process.exit(1);
});
