/**
 * FreebirdAdapter Registered Mode Tests
 *
 * Verifies that the 'registered' sybil mode works correctly for Day Pass renewal.
 * Users who have previously redeemed an invitation can use 'registered' mode
 * instead of requiring a new invitation code.
 */

/// <reference types="node" />

import { FreebirdAdapter, type SybilMode } from '../../src/integrations/freebird.js';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log('\n========================================');
  console.log('FreebirdAdapter Registered Mode Unit Tests');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;

  // Test 1: SybilMode type includes 'registered'
  try {
    console.log('Test 1: SybilMode type includes "registered"');
    const modes: SybilMode[] = ['none', 'pow', 'invitation', 'registered'];
    assert(modes.includes('registered'), 'SybilMode should include "registered"');
    console.log('  ✓ Passed\n');
    passed++;
  } catch (e) {
    console.log(`  ✗ Failed: ${e}\n`);
    failed++;
  }

  // Test 2: FreebirdAdapter can be created with 'registered' mode
  try {
    console.log('Test 2: FreebirdAdapter can be created with "registered" mode');
    const adapter = new FreebirdAdapter({
      issuerEndpoints: ['http://localhost:8081'],
      verifierUrl: 'http://localhost:8082',
      sybilMode: 'registered',
      userPublicKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    });
    assert(adapter.getSybilMode() === 'registered', 'Adapter should have registered mode');
    console.log('  ✓ Passed\n');
    passed++;
  } catch (e) {
    console.log(`  ✗ Failed: ${e}\n`);
    failed++;
  }

  // Test 3: markAsRegistered() switches from invitation to registered mode
  try {
    console.log('Test 3: markAsRegistered() switches from invitation to registered mode');
    const adapter = new FreebirdAdapter({
      issuerEndpoints: ['http://localhost:8081'],
      verifierUrl: 'http://localhost:8082',
      sybilMode: 'invitation',
      userPublicKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    });
    assert(adapter.getSybilMode() === 'invitation', 'Should start in invitation mode');

    adapter.markAsRegistered();
    assert(adapter.getSybilMode() === 'registered', 'Should switch to registered mode');
    console.log('  ✓ Passed\n');
    passed++;
  } catch (e) {
    console.log(`  ✗ Failed: ${e}\n`);
    failed++;
  }

  // Test 4: setSybilMode() allows explicit mode changes
  try {
    console.log('Test 4: setSybilMode() allows explicit mode changes');
    const adapter = new FreebirdAdapter({
      issuerEndpoints: ['http://localhost:8081'],
      verifierUrl: 'http://localhost:8082',
      sybilMode: 'none',
      userPublicKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    });

    adapter.setSybilMode('invitation');
    assert(adapter.getSybilMode() === 'invitation', 'Should set invitation mode');

    adapter.setSybilMode('registered');
    assert(adapter.getSybilMode() === 'registered', 'Should set registered mode');
    console.log('  ✓ Passed\n');
    passed++;
  } catch (e) {
    console.log(`  ✗ Failed: ${e}\n`);
    failed++;
  }

  // Test 5: isRegistered() returns correct value
  try {
    console.log('Test 5: isRegistered() returns correct value');
    const adapter = new FreebirdAdapter({
      issuerEndpoints: ['http://localhost:8081'],
      verifierUrl: 'http://localhost:8082',
      sybilMode: 'invitation',
      userPublicKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    });

    assert(!adapter.isRegistered(), 'Should not be registered in invitation mode');

    adapter.markAsRegistered();
    assert(adapter.isRegistered(), 'Should be registered after markAsRegistered()');
    console.log('  ✓ Passed\n');
    passed++;
  } catch (e) {
    console.log(`  ✗ Failed: ${e}\n`);
    failed++;
  }

  // Test 6: markAsRegistered() does nothing if already registered
  try {
    console.log('Test 6: markAsRegistered() is idempotent');
    const adapter = new FreebirdAdapter({
      issuerEndpoints: ['http://localhost:8081'],
      verifierUrl: 'http://localhost:8082',
      sybilMode: 'registered',
      userPublicKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    });

    // Should not throw or change mode
    adapter.markAsRegistered();
    assert(adapter.getSybilMode() === 'registered', 'Mode should still be registered');
    console.log('  ✓ Passed\n');
    passed++;
  } catch (e) {
    console.log(`  ✗ Failed: ${e}\n`);
    failed++;
  }

  // Test 7: Registered mode requires userPublicKey (tested via config)
  try {
    console.log('Test 7: Adapter can be created with registered mode and userPublicKey');
    const adapter = new FreebirdAdapter({
      issuerEndpoints: ['http://localhost:8081'],
      verifierUrl: 'http://localhost:8082',
      sybilMode: 'registered',
      userPublicKey: 'deadbeef0123456789abcdef0123456789abcdef0123456789abcdef01234567'
    });
    assert(adapter.isRegistered(), 'Should be in registered mode');
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
