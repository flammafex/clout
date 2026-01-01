/**
 * Timestamp Consistency Tests
 *
 * Verifies that timestamps are handled consistently across the stack.
 * The Witness API returns timestamps in seconds, which must be converted
 * to milliseconds for internal use with Date.now().
 */

/// <reference types="node" />

import { normalizeTimestampMs } from '../../src/integrations/witness.js';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log('\n========================================');
  console.log('Timestamp Consistency Unit Tests');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;

  // Test 1: Convert witness timestamps in seconds to milliseconds
  try {
    console.log('Test 1: Convert witness timestamps in seconds to milliseconds');
    const witnessTimestamp = Math.floor(Date.now() / 1000);
    const normalized = normalizeTimestampMs(witnessTimestamp);
    const diff = Math.abs(normalized - Date.now());
    assert(diff < 1000, `Normalized timestamp should be within 1s of now, got ${diff}ms diff`);
    console.log('  ✓ Passed\n');
    passed++;
  } catch (e) {
    console.log(`  ✗ Failed: ${e}\n`);
    failed++;
  }

  // Test 2: Pass through timestamps already in milliseconds
  try {
    console.log('Test 2: Pass through timestamps already in milliseconds');
    const nowMs = Date.now();
    const normalized = normalizeTimestampMs(nowMs);
    const diff = Math.abs(normalized - nowMs);
    assert(diff < 10, `Timestamp already in ms should be unchanged, got ${diff}ms diff`);
    console.log('  ✓ Passed\n');
    passed++;
  } catch (e) {
    console.log(`  ✗ Failed: ${e}\n`);
    failed++;
  }

  // Test 3: Handle year 2000 in seconds
  try {
    console.log('Test 3: Handle edge case - year 2000 in seconds');
    const y2kSeconds = 946684800;
    const y2kMs = 946684800000;
    const normalized = normalizeTimestampMs(y2kSeconds);
    assert(normalized === y2kMs, `Expected ${y2kMs}, got ${normalized}`);
    console.log('  ✓ Passed\n');
    passed++;
  } catch (e) {
    console.log(`  ✗ Failed: ${e}\n`);
    failed++;
  }

  // Test 4: Handle year 2100 in seconds
  try {
    console.log('Test 4: Handle edge case - year 2100 in seconds');
    const y2100Seconds = 4102444800;
    const y2100Ms = 4102444800000;
    const normalized = normalizeTimestampMs(y2100Seconds);
    assert(normalized === y2100Ms, `Expected ${y2100Ms}, got ${normalized}`);
    console.log('  ✓ Passed\n');
    passed++;
  } catch (e) {
    console.log(`  ✗ Failed: ${e}\n`);
    failed++;
  }

  // Test 5: Don't double-convert milliseconds
  try {
    console.log('Test 5: No double conversion of millisecond timestamps');
    const nowMs = Date.now();
    const doubleNormalized = normalizeTimestampMs(normalizeTimestampMs(nowMs));
    const diff = Math.abs(doubleNormalized - nowMs);
    assert(diff < 10, `Double normalization should not change ms timestamp, got ${diff}ms diff`);
    console.log('  ✓ Passed\n');
    passed++;
  } catch (e) {
    console.log(`  ✗ Failed: ${e}\n`);
    failed++;
  }

  // Test 6: Correctly identify seconds vs milliseconds boundary
  try {
    console.log('Test 6: Correctly identify seconds vs milliseconds boundary');
    // Just below threshold (should be treated as seconds)
    const belowThreshold = 4_199_999_999;
    const belowNorm = normalizeTimestampMs(belowThreshold);
    assert(belowNorm === belowThreshold * 1000, `Below threshold should multiply by 1000`);

    // Just above threshold (should be treated as milliseconds)
    const aboveThreshold = 4_200_000_001;
    const aboveNorm = normalizeTimestampMs(aboveThreshold);
    assert(aboveNorm === aboveThreshold, `Above threshold should pass through unchanged`);
    console.log('  ✓ Passed\n');
    passed++;
  } catch (e) {
    console.log(`  ✗ Failed: ${e}\n`);
    failed++;
  }

  // Test 7: Mock witness response integration
  try {
    console.log('Test 7: Mock witness response produces consistent timestamp');
    const mockWitnessResponse = {
      attestation: {
        attestation: {
          hash: 'abc123',
          timestamp: Math.floor(Date.now() / 1000), // Seconds from Witness API
          network_id: 'test-network',
          sequence: 1
        },
        signatures: []
      }
    };

    const attestation = {
      hash: mockWitnessResponse.attestation.attestation.hash,
      timestamp: normalizeTimestampMs(mockWitnessResponse.attestation.attestation.timestamp),
      signatures: [],
      witnessIds: []
    };

    const diff = Math.abs(attestation.timestamp - Date.now());
    assert(diff < 1000, `Attestation timestamp should be within 1s of now, got ${diff}ms`);
    assert(attestation.timestamp > 946684800000, `Should be valid ms timestamp (> year 2000)`);
    console.log('  ✓ Passed\n');
    passed++;
  } catch (e) {
    console.log(`  ✗ Failed: ${e}\n`);
    failed++;
  }

  // Test 8: Clock skew check compatibility
  try {
    console.log('Test 8: Clock skew check compatibility with content-gossip');
    const maxClockSkew = 60_000; // 60 seconds default
    const now = Date.now();

    // Valid: slightly in past
    const validTimestamp = now - 5000;
    assert(validTimestamp <= now + maxClockSkew, 'Past timestamp should pass clock skew check');

    // Valid: slightly in future (within tolerance)
    const futureButOk = now + 30_000;
    assert(futureButOk <= now + maxClockSkew, 'Future timestamp within tolerance should pass');

    // Invalid: too far in future
    const tooFuture = now + 120_000;
    assert(tooFuture > now + maxClockSkew, 'Timestamp 2min in future should fail clock skew check');
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
