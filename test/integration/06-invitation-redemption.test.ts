/**
 * Invitation Redemption Characterization Tests (Phase 0)
 *
 * Locks in the current behavior of the invitation redemption state machine
 * in CloutWebServer before the Tier 3 decomposition refactor.
 *
 * Tests the in-memory state machine directly via (server as any) access,
 * NOT via HTTP, to isolate state transitions from Express plumbing.
 *
 * These tests are a safety net for the refactor — they must pass before
 * AND after extraction of InvitationRedemption into its own module.
 *
 * Invariants covered (per oracle decomposition plan):
 *   1. Used code rejects consume
 *   2. Pending claim must match redeemer
 *   3. Successful consume persists state
 *   4. First redeemer becomes owner
 *   5. Existing owner not overwritten
 *   6. Auto-trust is bidirectional
 *   7. No self-trust when inviter equals redeemer
 *   8. Reserved signature access control
 *   9. Expired pending claim returns null signature
 *  10. Restart loads mappings from invitations.json
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CloutWebServer } from '../../src/web/server.js';
import { FileSystemStore } from '../../src/store/file-store.js';

// ─── Helpers ───────────────────────────────────────────────────────────

/** Generate a valid 64-char hex public key from a seed character. */
function makePubKey(seed: string): string {
  return seed.repeat(64).slice(0, 64);
}

const KEY_A = makePubKey('a');
const KEY_B = makePubKey('b');
const INVITER = makePubKey('f');

/**
 * Create a temp data dir and a CloutWebServer instance with initialized
 * UserDataStore and FileSystemStore. Does NOT call start() or initializeClout()
 * — we test the invitation state machine in isolation.
 */
async function withServer(
  fn: (server: CloutWebServer, dataDir: string) => Promise<void>
): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'clout-inv-'));
  const prevDataDir = process.env.CLOUT_DATA_DIR;
  process.env.CLOUT_DATA_DIR = dataDir;

  let server: CloutWebServer | undefined;
  try {
    server = new CloutWebServer({ port: 0 });
    // Init stores that are normally initialized in start()/initializeClout()
    await (server as any).userDataStore.init();
    const store = new FileSystemStore();
    await store.init();
    // Store is now on the runtime, not directly on the server
    (server as any).runtime.store = store;

    await fn(server, dataDir);
  } finally {
    // Clear AuthManager cleanup timer so the process can exit
    const authManager = (server as any)?.authManager;
    if (authManager?.cleanupTimer) {
      clearInterval(authManager.cleanupTimer);
    }
    process.env.CLOUT_DATA_DIR = prevDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
}

/** Seed a pending invitation claim directly into the redemption module's in-memory state. */
function seedPendingClaim(
  server: CloutWebServer,
  code: string,
  publicKey: string,
  opts: { signature?: string; inviter?: string; claimedAt?: number } = {}
): void {
  (server as any).invitationRedemption.pendingInvitationClaims.set(code, {
    publicKey,
    signature: opts.signature ?? 'test-signature',
    claimedAt: opts.claimedAt ?? Date.now(),
    inviter: opts.inviter,
  });
}

/** Write a minimal invitations.json so saveUsedInvitationCode can update it. */
function seedInvitationsFile(dataDir: string, codes: Array<{ code: string; signature?: string }>): void {
  const invitesFile = join(dataDir, 'invitations.json');
  writeFileSync(invitesFile, JSON.stringify({
    created: new Date().toISOString(),
    count: codes.length,
    codes: codes.map(c => c.code),
    invitations: codes.map(c => ({ code: c.code, signature: c.signature ?? 'test-sig' })),
    inviter: INVITER,
    usedCodes: [],
    redemptions: {}
  }, null, 2));
}

// ─── Tests ────────────────────────────────────────────────────────────

/** 1. Used code rejects consume */
async function testUsedCodeRejectsConsume(): Promise<void> {
  await withServer(async (server) => {
    const code = 'used-code-1';
    (server as any).invitationRedemption.usedInvitationCodes.add(code);
    seedPendingClaim(server, code, KEY_A);

    const result = await (server as any).invitationRedemption.consume(code, KEY_A);
    assert.equal(result, false, 'consume must reject already-used code');
  });
}

/** 2. Pending claim must match redeemer */
async function testPendingClaimMustMatchRedeemer(): Promise<void> {
  await withServer(async (server) => {
    const code = 'claim-mismatch-1';
    seedPendingClaim(server, code, KEY_A);

    const result = await (server as any).invitationRedemption.consume(code, KEY_B);
    assert.equal(result, false, 'consume must reject when pending claim belongs to different user');
  });
}

/** 3. Successful consume persists state */
async function testSuccessfulConsume(): Promise<void> {
  await withServer(async (server, dataDir) => {
    const code = 'success-code-1';
    seedInvitationsFile(dataDir, [{ code }]);
    seedPendingClaim(server, code, KEY_A, { inviter: INVITER });

    const result = await (server as any).invitationRedemption.consume(code, KEY_A);
    assert.equal(result, true, 'consume must succeed for matching pending claim');

    // Code moved to usedInvitationCodes
    assert.ok(
      (server as any).invitationRedemption.usedInvitationCodes.has(code),
      'code must be in usedInvitationCodes after consume'
    );

    // Pending claim deleted
    assert.ok(
      !(server as any).invitationRedemption.pendingInvitationClaims.has(code),
      'pending claim must be deleted after consume'
    );

    // Persisted to invitations.json
    const invitesFile = join(dataDir, 'invitations.json');
    assert.ok(existsSync(invitesFile), 'invitations.json must exist after consume');
    const data = JSON.parse(readFileSync(invitesFile, 'utf-8'));
    assert.ok(data.usedCodes?.includes(code), 'code must be in usedCodes array');
    assert.ok(data.redemptions?.[code], 'redemption entry must exist');
    assert.equal(data.redemptions[code].redeemedBy, KEY_A);
  });
}

/** 4. First redeemer becomes owner */
async function testFirstRedeemerBecomesOwner(): Promise<void> {
  await withServer(async (server, dataDir) => {
    assert.equal((server as any).ownerRegistry.get(), undefined, 'no owner should be set initially');

    const code = 'owner-code-1';
    seedPendingClaim(server, code, KEY_A, { inviter: INVITER });

    await (server as any).invitationRedemption.consume(code, KEY_A);

    assert.equal(
      (server as any).ownerRegistry.get(), KEY_A,
      'first redeemer must become owner'
    );

    // owner.json should exist
    const ownerFile = join(dataDir, 'owner.json');
    assert.ok(existsSync(ownerFile), 'owner.json must exist');
    const ownerData = JSON.parse(readFileSync(ownerFile, 'utf-8'));
    assert.equal(ownerData.publicKey, KEY_A);
  });
}

/** 5. Existing owner not overwritten */
async function testExistingOwnerNotOverwritten(): Promise<void> {
  await withServer(async (server) => {
    // Set existing owner
    (server as any).ownerRegistry.setIfAbsent(KEY_B);
    assert.equal((server as any).ownerRegistry.get(), KEY_B);

    const code = 'owner-code-2';
    seedPendingClaim(server, code, KEY_A, { inviter: KEY_B });

    await (server as any).invitationRedemption.consume(code, KEY_A);

    assert.equal(
      (server as any).ownerRegistry.get(), KEY_B,
      'existing owner must not be overwritten by new redeemer'
    );
  });
}

/** 6. Auto-trust is bidirectional */
async function testAutoTrustBidirectional(): Promise<void> {
  await withServer(async (server) => {
    const code = 'trust-code-1';
    seedPendingClaim(server, code, KEY_A, { inviter: INVITER });

    await (server as any).invitationRedemption.consume(code, KEY_A);

    // Redeemer trusts inviter
    const redeemerTrusts = await (server as any).userDataStore.getTrustGraph(KEY_A);
    assert.ok(
      redeemerTrusts.includes(INVITER),
      'redeemer must trust inviter after consume'
    );

    // Inviter trusts redeemer
    const inviterTrusts = await (server as any).userDataStore.getTrustGraph(INVITER);
    assert.ok(
      inviterTrusts.includes(KEY_A),
      'inviter must trust redeemer after consume'
    );
  });
}

/** 7. No self-trust when inviter equals redeemer */
async function testAutoTrustNoSelfTrust(): Promise<void> {
  await withServer(async (server) => {
    const code = 'self-trust-code-1';
    seedPendingClaim(server, code, KEY_A, { inviter: KEY_A });

    await (server as any).invitationRedemption.consume(code, KEY_A);

    const trustGraph = await (server as any).userDataStore.getTrustGraph(KEY_A);
    assert.ok(
      !trustGraph.includes(KEY_A),
      'must not create self-trust when inviter equals redeemer'
    );
  });
}

/** 8. Reserved signature access control */
async function testReservedSignatureAccessControl(): Promise<void> {
  await withServer(async (server) => {
    const code = 'sig-code-1';
    const signature = 'test-sig-123';
    seedPendingClaim(server, code, KEY_A, { signature });

    // Matching code + publicKey returns signature
    const sig = (server as any).invitationRedemption.getReservedSignature(code, KEY_A);
    assert.equal(sig, signature, 'must return signature for matching code+publicKey');

    // Wrong publicKey returns null
    const wrongSig = (server as any).invitationRedemption.getReservedSignature(code, KEY_B);
    assert.equal(wrongSig, null, 'must return null for wrong publicKey');

    // Non-existent code returns null
    const missingSig = (server as any).invitationRedemption.getReservedSignature('nonexistent', KEY_A);
    assert.equal(missingSig, null, 'must return null for non-existent code');
  });
}

/** 9. Expired pending claim returns null signature */
async function testReservedSignatureExpiredClaim(): Promise<void> {
  await withServer(async (server) => {
    const code = 'expired-code-1';
    // Seed a claim that's 20 minutes old (past the 15-min timeout)
    const oldTime = Date.now() - (20 * 60 * 1000);
    seedPendingClaim(server, code, KEY_A, { claimedAt: oldTime });

    const sig = (server as any).invitationRedemption.getReservedSignature(code, KEY_A);
    assert.equal(sig, null, 'must return null for expired pending claim');
  });
}

/** 10. Restart loads mappings from invitations.json */
async function testRestartLoadMappings(): Promise<void> {
  await withServer(async (server, dataDir) => {
    // Write an invitations.json file simulating a previous run
    const invitesFile = join(dataDir, 'invitations.json');
    writeFileSync(invitesFile, JSON.stringify({
      created: new Date().toISOString(),
      count: 2,
      codes: ['restart-code-1', 'restart-code-2'],
      invitations: [
        { code: 'restart-code-1', signature: 'sig-1' },
        { code: 'restart-code-2', signature: 'sig-2' }
      ],
      inviter: INVITER,
      usedCodes: ['restart-code-1'],
      redemptions: {
        'restart-code-1': {
          redeemedBy: KEY_A,
          redeemedAt: Date.now() - 1000
        }
      }
    }, null, 2));

    // Load mappings (simulates restart)
    (server as any).invitationRedemption.loadMappings();

    // Used codes restored
    assert.ok(
      (server as any).invitationRedemption.usedInvitationCodes.has('restart-code-1'),
      'used code must be restored from invitations.json'
    );
    assert.ok(
      !(server as any).invitationRedemption.usedInvitationCodes.has('restart-code-2'),
      'unused code must not be in usedInvitationCodes'
    );

    // Code -> inviter mappings restored
    assert.equal(
      (server as any).invitationRedemption.invitationCodeToInviter.get('restart-code-1'),
      INVITER,
      'inviter mapping must be restored'
    );
    assert.equal(
      (server as any).invitationRedemption.invitationCodeToInviter.get('restart-code-2'),
      INVITER,
      'inviter mapping must be restored for unused code too'
    );

    // Code -> signature mappings restored
    assert.equal(
      (server as any).invitationRedemption.invitationCodeToSignature.get('restart-code-1'),
      'sig-1',
      'signature mapping must be restored'
    );
    assert.equal(
      (server as any).invitationRedemption.invitationCodeToSignature.get('restart-code-2'),
      'sig-2',
      'signature mapping must be restored for unused code too'
    );
  });
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n========================================');
  console.log('Invitation Redemption Characterization Tests (Phase 0)');
  console.log('========================================\n');

  await testUsedCodeRejectsConsume();
  console.log('✅ used code rejects consume');

  await testPendingClaimMustMatchRedeemer();
  console.log('✅ pending claim must match redeemer');

  await testSuccessfulConsume();
  console.log('✅ successful consume persists state');

  await testFirstRedeemerBecomesOwner();
  console.log('✅ first redeemer becomes owner');

  await testExistingOwnerNotOverwritten();
  console.log('✅ existing owner not overwritten');

  await testAutoTrustBidirectional();
  console.log('✅ auto-trust is bidirectional');

  await testAutoTrustNoSelfTrust();
  console.log('✅ no self-trust when inviter equals redeemer');

  await testReservedSignatureAccessControl();
  console.log('✅ reserved signature access control');

  await testReservedSignatureExpiredClaim();
  console.log('✅ expired pending claim returns null signature');

  await testRestartLoadMappings();
  console.log('✅ restart loads mappings from invitations.json');

  console.log('\n========================================');
  console.log('✅ ALL INVITATION REDEMPTION TESTS PASSED');
  console.log('========================================\n');
}

main().catch((error) => {
  console.error('❌ Invitation redemption tests failed:', error);
  process.exit(1);
});
