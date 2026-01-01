/**
 * FreebirdAdapter Federated Trust Tests
 *
 * Verifies that the 'federated_trust' sybil mode works correctly for
 * cross-community onboarding. Users with valid tokens from a trusted
 * community can use them to obtain tokens without needing an invitation.
 */

/// <reference types="node" />

import {
  FreebirdAdapter,
  type SybilMode,
  type FederatedToken
} from '../../src/integrations/freebird.js';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log('\n========================================');
  console.log('FreebirdAdapter Federated Trust Unit Tests');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;

  // Test 1: SybilMode type includes 'federated_trust'
  try {
    console.log('Test 1: SybilMode type includes "federated_trust"');
    const modes: SybilMode[] = ['none', 'pow', 'invitation', 'registered', 'federated_trust'];
    assert(modes.includes('federated_trust'), 'SybilMode should include "federated_trust"');
    console.log('  ✓ Passed\n');
    passed++;
  } catch (e) {
    console.log(`  ✗ Failed: ${e}\n`);
    failed++;
  }

  // Test 2: FreebirdAdapter can be created with 'federated_trust' mode
  try {
    console.log('Test 2: FreebirdAdapter can be created with "federated_trust" mode');
    const mockToken: FederatedToken = {
      sourceIssuerId: 'issuer:community-b.com:v1',
      token: new Uint8Array(130), // Mock VOPRF token
      expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
      issuedAt: Math.floor(Date.now() / 1000),
      communityName: 'Community B'
    };
    const adapter = new FreebirdAdapter({
      issuerEndpoints: ['http://localhost:8081'],
      verifierUrl: 'http://localhost:8082',
      sybilMode: 'federated_trust',
      federatedToken: mockToken
    });
    assert(adapter.getSybilMode() === 'federated_trust', 'Adapter should have federated_trust mode');
    console.log('  ✓ Passed\n');
    passed++;
  } catch (e) {
    console.log(`  ✗ Failed: ${e}\n`);
    failed++;
  }

  // Test 3: setFederatedToken() stores the token
  try {
    console.log('Test 3: setFederatedToken() stores the token');
    const adapter = new FreebirdAdapter({
      issuerEndpoints: ['http://localhost:8081'],
      verifierUrl: 'http://localhost:8082',
      sybilMode: 'federated_trust'
    });

    const mockToken: FederatedToken = {
      sourceIssuerId: 'issuer:trusted-community.org:v1',
      token: new Uint8Array(130),
      expiresAt: Math.floor(Date.now() / 1000) + 7200, // 2 hours from now
      issuedAt: Math.floor(Date.now() / 1000),
      communityName: 'Trusted Community'
    };

    adapter.setFederatedToken(mockToken);
    const retrieved = adapter.getFederatedToken();
    assert(retrieved !== undefined, 'Should have federated token after setFederatedToken');
    assert(retrieved!.sourceIssuerId === mockToken.sourceIssuerId, 'Issuer ID should match');
    assert(retrieved!.communityName === 'Trusted Community', 'Community name should match');
    console.log('  ✓ Passed\n');
    passed++;
  } catch (e) {
    console.log(`  ✗ Failed: ${e}\n`);
    failed++;
  }

  // Test 4: hasFederatedToken() returns correct value
  try {
    console.log('Test 4: hasFederatedToken() returns correct value');
    const adapter = new FreebirdAdapter({
      issuerEndpoints: ['http://localhost:8081'],
      verifierUrl: 'http://localhost:8082',
      sybilMode: 'federated_trust'
    });

    assert(!adapter.hasFederatedToken(), 'Should not have token initially');

    const mockToken: FederatedToken = {
      sourceIssuerId: 'issuer:example.com:v1',
      token: new Uint8Array(130),
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      issuedAt: Math.floor(Date.now() / 1000)
    };

    adapter.setFederatedToken(mockToken);
    assert(adapter.hasFederatedToken(), 'Should have token after setting');
    console.log('  ✓ Passed\n');
    passed++;
  } catch (e) {
    console.log(`  ✗ Failed: ${e}\n`);
    failed++;
  }

  // Test 5: hasFederatedToken() returns false for expired tokens
  try {
    console.log('Test 5: hasFederatedToken() returns false for expired tokens');
    const adapter = new FreebirdAdapter({
      issuerEndpoints: ['http://localhost:8081'],
      verifierUrl: 'http://localhost:8082',
      sybilMode: 'federated_trust',
      federatedToken: {
        sourceIssuerId: 'issuer:expired.com:v1',
        token: new Uint8Array(130),
        expiresAt: Math.floor(Date.now() / 1000) - 100, // Expired 100 seconds ago
        issuedAt: Math.floor(Date.now() / 1000) - 3700
      }
    });

    assert(!adapter.hasFederatedToken(), 'Should return false for expired token');
    console.log('  ✓ Passed\n');
    passed++;
  } catch (e) {
    console.log(`  ✗ Failed: ${e}\n`);
    failed++;
  }

  // Test 6: setFederatedToken() rejects expired tokens
  try {
    console.log('Test 6: setFederatedToken() rejects expired tokens');
    const adapter = new FreebirdAdapter({
      issuerEndpoints: ['http://localhost:8081'],
      verifierUrl: 'http://localhost:8082',
      sybilMode: 'federated_trust'
    });

    let threw = false;
    try {
      adapter.setFederatedToken({
        sourceIssuerId: 'issuer:expired.com:v1',
        token: new Uint8Array(130),
        expiresAt: Math.floor(Date.now() / 1000) - 100, // Expired
        issuedAt: Math.floor(Date.now() / 1000) - 3700
      });
    } catch {
      threw = true;
    }

    assert(threw, 'Should throw when setting expired token');
    console.log('  ✓ Passed\n');
    passed++;
  } catch (e) {
    console.log(`  ✗ Failed: ${e}\n`);
    failed++;
  }

  // Test 7: clearFederatedToken() removes the token
  try {
    console.log('Test 7: clearFederatedToken() removes the token');
    const adapter = new FreebirdAdapter({
      issuerEndpoints: ['http://localhost:8081'],
      verifierUrl: 'http://localhost:8082',
      sybilMode: 'federated_trust',
      federatedToken: {
        sourceIssuerId: 'issuer:example.com:v1',
        token: new Uint8Array(130),
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        issuedAt: Math.floor(Date.now() / 1000)
      }
    });

    assert(adapter.hasFederatedToken(), 'Should have token initially');
    adapter.clearFederatedToken();
    assert(!adapter.hasFederatedToken(), 'Should not have token after clear');
    console.log('  ✓ Passed\n');
    passed++;
  } catch (e) {
    console.log(`  ✗ Failed: ${e}\n`);
    failed++;
  }

  // Test 8: createFederatedToken static helper works correctly
  try {
    console.log('Test 8: createFederatedToken static helper works correctly');
    const token = new Uint8Array([1, 2, 3, 4, 5]);
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;

    const fedToken = FreebirdAdapter.createFederatedToken(
      token,
      'issuer:helper-test.com:v1',
      expiresAt,
      undefined,
      'Helper Test Community'
    );

    assert(fedToken.sourceIssuerId === 'issuer:helper-test.com:v1', 'Issuer ID should match');
    assert(fedToken.expiresAt === expiresAt, 'Expires at should match');
    assert(fedToken.communityName === 'Helper Test Community', 'Community name should match');
    assert(fedToken.token.length === 5, 'Token should have correct length');
    assert(fedToken.issuedAt > 0, 'Issued at should be set automatically');
    console.log('  ✓ Passed\n');
    passed++;
  } catch (e) {
    console.log(`  ✗ Failed: ${e}\n`);
    failed++;
  }

  // Test 9: setSybilMode to federated_trust works
  try {
    console.log('Test 9: setSybilMode to federated_trust works');
    const adapter = new FreebirdAdapter({
      issuerEndpoints: ['http://localhost:8081'],
      verifierUrl: 'http://localhost:8082',
      sybilMode: 'invitation'
    });

    assert(adapter.getSybilMode() === 'invitation', 'Should start in invitation mode');

    adapter.setSybilMode('federated_trust');
    assert(adapter.getSybilMode() === 'federated_trust', 'Should switch to federated_trust mode');
    console.log('  ✓ Passed\n');
    passed++;
  } catch (e) {
    console.log(`  ✗ Failed: ${e}\n`);
    failed++;
  }

  // Test 10: FederatedToken can be created without optional communityName
  try {
    console.log('Test 10: FederatedToken works without optional fields');
    const fedToken = FreebirdAdapter.createFederatedToken(
      new Uint8Array(130),
      'issuer:minimal.com:v1',
      Math.floor(Date.now() / 1000) + 3600
    );

    assert(fedToken.communityName === undefined, 'Community name should be undefined');
    assert(fedToken.issuedAt > 0, 'Issued at should be auto-set');

    // Should work when setting on adapter
    const adapter = new FreebirdAdapter({
      issuerEndpoints: ['http://localhost:8081'],
      verifierUrl: 'http://localhost:8082',
      sybilMode: 'federated_trust'
    });
    adapter.setFederatedToken(fedToken);
    assert(adapter.hasFederatedToken(), 'Should accept token without optional fields');
    console.log('  ✓ Passed\n');
    passed++;
  } catch (e) {
    console.log(`  ✗ Failed: ${e}\n`);
    failed++;
  }

  // Summary
  console.log('========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('========================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
