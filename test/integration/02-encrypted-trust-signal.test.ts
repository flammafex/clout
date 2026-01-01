/**
 * Encrypted Trust Signal Integration Test
 *
 * Tests the complete round-trip of encrypted trust signals:
 * 1. Truster creates encrypted trust signal for trustee
 * 2. Trustee can decrypt and verify the signal
 * 3. Third parties can verify signature but NOT see trustee identity
 * 4. Invalid recipients cannot decrypt the signal
 *
 * Note: The Crypto API now handles Ed25519 to X25519 key conversion automatically.
 * Callers can pass Ed25519 identity keys directly, and encryption/decryption
 * will convert them to X25519 internally.
 */

/// <reference types="node" />

import { Crypto } from '../../src/crypto.js';

interface TestKeypair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;     // Ed25519 public key (identity)
  publicKeyHex: string;
}

function generateKeypair(name: string): TestKeypair {
  const privateKey = Crypto.randomBytes(32);
  const publicKey = Crypto.getPublicKey(privateKey);  // Ed25519
  const publicKeyHex = Crypto.toHex(publicKey);

  console.log(`[Test] Generated keypair for ${name}: ${publicKeyHex.slice(0, 16)}...`);

  return { privateKey, publicKey, publicKeyHex };
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

    // Note: createEncryptedTrustSignal now auto-converts Ed25519 to X25519
    const encryptedSignal = Crypto.createEncryptedTrustSignal(
      alice.privateKey,
      alice.publicKeyHex,  // Ed25519 identity key
      bob.publicKeyHex,    // Ed25519 identity key (auto-converted to X25519)
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

    // Note: decryptTrustSignal now auto-converts Ed25519 to X25519
    const decryptedByBob = Crypto.decryptTrustSignal(
      encryptedSignal.encryptedTrustee,
      encryptedSignal.trusteeCommitment,
      alice.publicKeyHex,  // Ed25519 identity key for signature verification
      encryptedSignal.signature,
      weight,
      timestamp,
      bob.privateKey,
      bob.publicKey  // Ed25519 public key (auto-converted to X25519)
    );

    if (!decryptedByBob) {
      throw new Error('Bob failed to decrypt signal meant for him');
    }
    if (decryptedByBob.trustee !== bob.publicKeyHex) {
      throw new Error(`Decrypted trustee mismatch: ${decryptedByBob.trustee} !== ${bob.publicKeyHex}`);
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
      alice.publicKeyHex,
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
      alice.publicKeyHex,
      encryptedSignal.signature,
      weight,
      timestamp,
      charlie.privateKey,
      charlie.publicKey
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
      alice.publicKeyHex,
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
      alice.publicKeyHex,
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
      alice.publicKeyHex,
      bob.publicKeyHex,
      trickyWeight,
      timestamp
    );

    // Verification should work even with tricky float
    const trickyValid = Crypto.verifyEncryptedTrustSignature(
      trickySignal.trusteeCommitment,
      alice.publicKeyHex,
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
      alice.publicKeyHex,
      trickySignal.signature,
      trickyWeight,
      timestamp,
      bob.privateKey,
      bob.publicKey
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
      alice.publicKeyHex,
      bob.publicKeyHex,
      weight,
      timestamp
    );

    const signal2 = Crypto.createEncryptedTrustSignal(
      alice.privateKey,
      alice.publicKeyHex,
      bob.publicKeyHex,
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

    // ===== Test 8: Decryption works without explicit public key =====
    console.log('\nTest 8: Decryption works without explicit public key (derived from private)...');

    const decryptedNoExplicitKey = Crypto.decryptTrustSignal(
      encryptedSignal.encryptedTrustee,
      encryptedSignal.trusteeCommitment,
      alice.publicKeyHex,
      encryptedSignal.signature,
      weight,
      timestamp,
      bob.privateKey
      // Note: No public key passed - will be derived internally
    );

    if (!decryptedNoExplicitKey) {
      throw new Error('Decryption should work without explicit public key');
    }
    console.log('  Decryption without explicit public key: PASSED');
    console.log('  Passed: Public key correctly derived from private key');
    passed++;

    // ===== Test 9: Key conversion utility works correctly =====
    console.log('\nTest 9: ed25519ToX25519 conversion produces matching key pairs...');

    // Ed25519 and X25519 use different scalars from the same seed:
    // - Ed25519 scalar = sha512(seed)[0:32]
    // - Raw X25519 scalar = seed directly
    // So ed25519ToX25519(ed25519Pub) !== x25519.getPublicKey(seed)
    // But: ed25519ToX25519(ed25519Pub) == x25519.getPublicKey(ed25519PrivToX25519(seed))

    const ed25519Pub = Crypto.getPublicKey(bob.privateKey);
    const x25519PubFromEd25519 = Crypto.ed25519ToX25519(ed25519Pub);

    // Convert private key and derive X25519 public key from it
    const x25519Priv = Crypto.ed25519PrivToX25519(bob.privateKey);
    const x25519PubFromConvertedPriv = Crypto.getX25519PublicKey(x25519Priv);

    // These should match - the converted public key should correspond to the converted private key
    if (Crypto.toHex(x25519PubFromEd25519) !== Crypto.toHex(x25519PubFromConvertedPriv)) {
      throw new Error('ed25519ToX25519(pubkey) should match x25519.getPublicKey(ed25519PrivToX25519(privkey))');
    }
    console.log(`  Ed25519 public key:     ${Crypto.toHex(ed25519Pub).slice(0, 16)}...`);
    console.log(`  X25519 (from Ed25519):  ${Crypto.toHex(x25519PubFromEd25519).slice(0, 16)}...`);
    console.log(`  X25519 (from priv):     ${Crypto.toHex(x25519PubFromConvertedPriv).slice(0, 16)}...`);
    console.log('  Passed: Key conversions produce matching key pairs');
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
