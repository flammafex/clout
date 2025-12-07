/**
 * Encrypted Trust Signal Integration Test
 *
 * Tests the complete round-trip of encrypted trust signals:
 * 1. Truster creates encrypted trust signal for trustee
 * 2. Trustee can decrypt and verify the signal
 * 3. Third parties can verify signature but NOT see trustee identity
 * 4. Invalid recipients cannot decrypt the signal
 *
 * Note: This test uses separate key types:
 * - Ed25519 keys for signing/identity (via ed25519.getPublicKey)
 * - X25519 keys for encryption (via x25519.getPublicKey)
 * Both are derived from the same 32-byte private key.
 */

/// <reference types="node" />

import { Crypto } from '../../src/crypto.js';
import { x25519, ed25519 } from '@noble/curves/ed25519';

interface TestKeypair {
  privateKey: Uint8Array;
  // Ed25519 public key - for signature verification
  ed25519PublicKey: Uint8Array;
  ed25519PublicKeyHex: string;
  // X25519 public key - for encryption/decryption
  x25519PublicKey: Uint8Array;
  x25519PublicKeyHex: string;
}

function generateKeypair(name: string): TestKeypair {
  const privateKey = Crypto.randomBytes(32);

  // Ed25519 public key for signing
  const ed25519PublicKey = ed25519.getPublicKey(privateKey);
  const ed25519PublicKeyHex = Crypto.toHex(ed25519PublicKey);

  // X25519 public key for encryption
  const x25519PublicKey = x25519.getPublicKey(privateKey);
  const x25519PublicKeyHex = Crypto.toHex(x25519PublicKey);

  console.log(`[Test] Generated keypair for ${name}:`);
  console.log(`       Ed25519 (signing): ${ed25519PublicKeyHex.slice(0, 16)}...`);
  console.log(`       X25519 (encrypt):  ${x25519PublicKeyHex.slice(0, 16)}...`);

  return {
    privateKey,
    ed25519PublicKey,
    ed25519PublicKeyHex,
    x25519PublicKey,
    x25519PublicKeyHex
  };
}

async function runTests() {
  console.log('\n========================================');
  console.log('Encrypted Trust Signal Integration Tests');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;

  try {
    // ===== Setup: Create three identities =====
    console.log('Setup: Creating three identities (Alice, Bob, Charlie)...');
    const alice = generateKeypair('Alice'); // Truster
    const bob = generateKeypair('Bob');     // Trustee
    const charlie = generateKeypair('Charlie'); // Third party
    console.log('');

    // ===== Test 1: Create encrypted trust signal =====
    console.log('Test 1: Alice creates encrypted trust signal for Bob...');
    const weight = 0.85;
    const timestamp = Date.now();

    // Note: createEncryptedTrustSignal uses:
    // - Ed25519 private key for signing
    // - X25519 public key for encrypting to trustee
    const encryptedSignal = Crypto.createEncryptedTrustSignal(
      alice.privateKey,
      alice.ed25519PublicKeyHex,  // For signature verification
      bob.x25519PublicKeyHex,      // For encryption to Bob
      weight,
      timestamp
    );

    if (!encryptedSignal.trusteeCommitment) {
      throw new Error('Missing trusteeCommitment');
    }
    if (!encryptedSignal.encryptedTrustee.ephemeralPublicKey) {
      throw new Error('Missing ephemeralPublicKey');
    }
    if (!encryptedSignal.encryptedTrustee.ciphertext) {
      throw new Error('Missing ciphertext');
    }
    if (!encryptedSignal.signature || encryptedSignal.signature.length !== 64) {
      throw new Error('Invalid signature');
    }

    console.log(`  Commitment: ${encryptedSignal.trusteeCommitment.slice(0, 16)}...`);
    console.log(`  Ciphertext length: ${encryptedSignal.encryptedTrustee.ciphertext.length} bytes`);
    console.log('  Passed: Signal created successfully');
    passed++;

    // ===== Test 2: Bob (trustee) can decrypt and verify =====
    console.log('\nTest 2: Bob (trustee) decrypts and verifies the signal...');

    const decryptedByBob = Crypto.decryptTrustSignal(
      encryptedSignal.encryptedTrustee,
      encryptedSignal.trusteeCommitment,
      alice.ed25519PublicKeyHex,  // Truster's signing key for verification
      encryptedSignal.signature,
      weight,
      timestamp,
      bob.privateKey,
      bob.x25519PublicKey  // Bob's encryption key
    );

    if (!decryptedByBob) {
      throw new Error('Bob failed to decrypt signal meant for him');
    }
    if (decryptedByBob.trustee !== bob.x25519PublicKeyHex) {
      throw new Error(`Decrypted trustee mismatch: ${decryptedByBob.trustee} !== ${bob.x25519PublicKeyHex}`);
    }

    console.log(`  Decrypted trustee: ${decryptedByBob.trustee.slice(0, 16)}...`);
    console.log(`  Nonce recovered: ${decryptedByBob.nonce.slice(0, 16)}...`);
    console.log('  Passed: Bob successfully decrypted and verified');
    passed++;

    // ===== Test 3: Third party (Charlie) can verify signature but NOT decrypt =====
    console.log('\nTest 3: Charlie (third party) can verify signature but NOT decrypt...');

    // Charlie verifies signature is valid
    const signatureValid = Crypto.verifyEncryptedTrustSignature(
      encryptedSignal.trusteeCommitment,
      alice.ed25519PublicKeyHex,
      encryptedSignal.signature,
      weight,
      timestamp
    );

    if (!signatureValid) {
      throw new Error('Charlie should be able to verify signature');
    }
    console.log('  Signature verification: PASSED');

    // Charlie tries to decrypt - should fail
    const decryptedByCharlie = Crypto.decryptTrustSignal(
      encryptedSignal.encryptedTrustee,
      encryptedSignal.trusteeCommitment,
      alice.ed25519PublicKeyHex,
      encryptedSignal.signature,
      weight,
      timestamp,
      charlie.privateKey,
      charlie.x25519PublicKey
    );

    if (decryptedByCharlie !== null) {
      throw new Error('Charlie should NOT be able to decrypt signal meant for Bob');
    }
    console.log('  Decryption attempt: FAILED (as expected - privacy preserved)');
    console.log('  Passed: Third party cannot see trustee identity');
    passed++;

    // ===== Test 4: Invalid signature fails verification =====
    console.log('\nTest 4: Tampered signature fails verification...');

    const tamperedSignature = new Uint8Array(encryptedSignal.signature);
    tamperedSignature[0] ^= 0xFF; // Flip some bits

    const tamperedValid = Crypto.verifyEncryptedTrustSignature(
      encryptedSignal.trusteeCommitment,
      alice.ed25519PublicKeyHex,
      tamperedSignature,
      weight,
      timestamp
    );

    if (tamperedValid) {
      throw new Error('Tampered signature should NOT verify');
    }
    console.log('  Tampered signature verification: FAILED (as expected)');
    console.log('  Passed: Signature tampering detected');
    passed++;

    // ===== Test 5: Wrong weight fails verification =====
    console.log('\nTest 5: Wrong weight fails verification...');

    const wrongWeightValid = Crypto.verifyEncryptedTrustSignature(
      encryptedSignal.trusteeCommitment,
      alice.ed25519PublicKeyHex,
      encryptedSignal.signature,
      0.99, // Wrong weight
      timestamp
    );

    if (wrongWeightValid) {
      throw new Error('Wrong weight should NOT verify');
    }
    console.log('  Wrong weight verification: FAILED (as expected)');
    console.log('  Passed: Weight tampering detected');
    passed++;

    // ===== Test 6: Float precision consistency =====
    console.log('\nTest 6: Float precision consistency (0.1 + 0.2 case)...');

    // This tests that weight.toFixed(2) prevents float precision issues
    const trickyWeight = 0.1 + 0.2; // In JS: 0.30000000000000004

    const trickySignal = Crypto.createEncryptedTrustSignal(
      alice.privateKey,
      alice.ed25519PublicKeyHex,
      bob.x25519PublicKeyHex,
      trickyWeight,
      timestamp
    );

    // Verification should work even with tricky float
    const trickyValid = Crypto.verifyEncryptedTrustSignature(
      trickySignal.trusteeCommitment,
      alice.ed25519PublicKeyHex,
      trickySignal.signature,
      trickyWeight,
      timestamp
    );

    if (!trickyValid) {
      throw new Error('Float precision should be handled correctly');
    }

    // Also verify Bob can decrypt
    const trickyDecrypted = Crypto.decryptTrustSignal(
      trickySignal.encryptedTrustee,
      trickySignal.trusteeCommitment,
      alice.ed25519PublicKeyHex,
      trickySignal.signature,
      trickyWeight,
      timestamp,
      bob.privateKey,
      bob.x25519PublicKey
    );

    if (!trickyDecrypted) {
      throw new Error('Float precision should not break decryption');
    }
    console.log(`  Input weight: ${trickyWeight}`);
    console.log(`  Canonical weight: ${trickyWeight.toFixed(2)}`);
    console.log('  Passed: Float precision handled correctly');
    passed++;

    // ===== Test 7: Commitment uniqueness =====
    console.log('\nTest 7: Each signal has unique commitment (nonce prevents linking)...');

    const signal1 = Crypto.createEncryptedTrustSignal(
      alice.privateKey,
      alice.ed25519PublicKeyHex,
      bob.x25519PublicKeyHex,
      weight,
      timestamp
    );

    const signal2 = Crypto.createEncryptedTrustSignal(
      alice.privateKey,
      alice.ed25519PublicKeyHex,
      bob.x25519PublicKeyHex,
      weight,
      timestamp
    );

    if (signal1.trusteeCommitment === signal2.trusteeCommitment) {
      throw new Error('Different signals should have different commitments');
    }
    console.log(`  Signal 1 commitment: ${signal1.trusteeCommitment.slice(0, 16)}...`);
    console.log(`  Signal 2 commitment: ${signal2.trusteeCommitment.slice(0, 16)}...`);
    console.log('  Passed: Commitments are unique (prevents linking)');
    passed++;

    // ===== Results =====
    console.log('\n========================================');
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log('========================================\n');

    if (failed > 0) {
      process.exit(1);
    }

    console.log('ALL TESTS PASSED');
    process.exit(0);

  } catch (error) {
    console.error('\nTEST FAILED:');
    console.error(error);
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
