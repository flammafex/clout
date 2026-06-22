/**
 * Clout live service seam.
 *
 * Exercises the production adapters against running Freebird, Witness, and
 * HyperToken services with insecure fallbacks disabled.
 */

/// <reference types="node" />

import assert from 'assert';
import { Crypto } from '../../src/crypto.js';
import { FreebirdAdapter } from '../../src/integrations/freebird.js';
import { HyperTokenAdapter } from '../../src/integrations/hypertoken.js';
import { WitnessAdapter } from '../../src/integrations/witness.js';
import { TicketBooth } from '../../src/ticket-booth.js';
import type { KeyPair, PublicKey } from '../../src/types.js';

const issuerUrl = process.env.FREEBIRD_ISSUER_URL ?? 'http://127.0.0.1:18081';
const verifierUrl = process.env.FREEBIRD_VERIFIER_URL ?? 'http://127.0.0.1:18082';
const witnessUrl = process.env.WITNESS_GATEWAY_URL ?? 'http://127.0.0.1:18080';
const relayUrl = process.env.HYPERTOKEN_RELAY_URL ?? 'ws://127.0.0.1:13000';

function makeKeyPair(): KeyPair {
  return {
    publicKey: { bytes: Crypto.randomBytes(32) },
    privateKey: { bytes: Crypto.randomBytes(32) },
  };
}

async function issueToken(freebird: FreebirdAdapter, publicKey: PublicKey): Promise<Uint8Array> {
  const blinded = await freebird.blind(publicKey);
  assert(blinded.length > 0, 'Freebird blind() must return a blinded element');

  const token = await freebird.issueToken(blinded);
  assert.equal(token[0], 0x04, 'Freebird token must be V4');
  assert(token.length > 100, 'Freebird V4 token must be non-empty and structured');
  return token;
}

async function runLiveServicesTest(): Promise<void> {
  console.log('\n========================================');
  console.log('Clout Live Service Seam');
  console.log('========================================\n');

  const freebird = new FreebirdAdapter({
    issuerEndpoints: [issuerUrl],
    verifierUrl,
    sybilMode: 'none',
    allowInsecureFallback: false,
  });

  const witness = new WitnessAdapter({
    gatewayUrl: witnessUrl,
    networkId: 'sophia-smoke-network',
    allowInsecureFallback: false,
  });

  const user = makeKeyPair();

  console.log('Test 1: Freebird V4 issue and verify...');
  const probeToken = await issueToken(freebird, user.publicKey);
  assert.equal(await freebird.verifyToken(probeToken), true, 'Freebird verifier must accept issued token');
  console.log('ok Freebird V4 issue and verify');

  console.log('Test 2: Witness timestamp and verify...');
  const attestation = await witness.timestamp(Crypto.hashObject({
    seam: 'clout-live',
    publicKey: Crypto.toHex(user.publicKey.bytes),
  }));
  assert(attestation.witnessIds.length > 0, 'Witness attestation must include witness IDs');
  assert(!attestation.witnessIds.some(id => id.startsWith('mock')), 'Witness IDs must not be mock IDs');
  assert.equal(attestation.canonical?.contract_version, 'sophia/v1', 'Witness attestation must retain canonical contract version');
  assert.equal(attestation.canonical?.artifact_type, 'witness.signed_attestation', 'Witness attestation must retain canonical artifact type');
  assert.equal(attestation.canonical?.attestation.hash, attestation.hash, 'Canonical Witness artifact must bind the attested hash');
  assert(['multisig', 'aggregated'].includes(attestation.canonical?.signatures.kind ?? ''), 'Canonical Witness artifact must identify the signature kind');
  assert.equal(await witness.verify(attestation), true, 'Witness gateway must verify its attestation');
  console.log('ok Witness timestamp and verify');

  console.log('Test 3: TicketBooth mints a live day pass...');
  const boothToken = await issueToken(freebird, user.publicKey);
  const booth = new TicketBooth(freebird, witness);
  const ticket = await booth.mintTicket(user, boothToken, 0.25);
  assert.equal(ticket.owner, Crypto.toHex(user.publicKey.bytes), 'Ticket owner must match user public key');
  assert.equal(ticket.ticketType, 'direct', 'Ticket must be direct Freebird-backed ticket');
  assert(ticket.signature.witnessIds.length > 0, 'Ticket must include live Witness signature');
  assert(!ticket.signature.witnessIds.some(id => id.startsWith('mock')), 'Ticket witness IDs must not be mock IDs');
  console.log('ok TicketBooth live mint');

  console.log('Test 4: HyperToken relay connect...');
  const hypertoken = new HyperTokenAdapter({ relayUrl });
  await hypertoken.connect();
  assert(hypertoken.getMyPeerId(), 'HyperToken must assign a peer ID');
  hypertoken.disconnect();
  console.log('ok HyperToken relay connect');

  console.log('\nClout live service seam passed.\n');
}

runLiveServicesTest().catch(error => {
  console.error('\nClout live service seam failed:', error);
  process.exit(1);
});
