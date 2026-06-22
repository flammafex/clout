/**
 * Integration Test Runner for Clout
 *
 * Runs all integration tests in sequence.
 */

/// <reference types="node" />

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// NOTE: 05-live-services.test.ts is intentionally excluded from this runner.
// It is a "live service seam" that requires running Freebird, Witness, and
// HyperToken services with allowInsecureFallback: false (non-default ports
// 18081/18082/18080/13000). It cannot pass in a clean CI environment without
// the full live stack. Run it manually via: npm run test:live
const tests = [
  'integration/01-clout-gossip.test.js',
  'integration/02-encrypted-trust-signal.test.js',
  'integration/03-web-route-hardening.test.js',
  'integration/04-trust-graph-hardening.test.js',
  'integration/06-invitation-redemption.test.js'
];

async function runTest(testPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const fullPath = join(__dirname, testPath);
    console.log(`\nRunning: ${testPath}`);
    console.log('='.repeat(50));

    const proc = spawn('node', [fullPath], {
      stdio: 'inherit',
      cwd: join(__dirname, '..')
    });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ ${testPath} passed\n`);
        resolve(true);
      } else {
        console.log(`❌ ${testPath} failed with code ${code}\n`);
        resolve(false);
      }
    });

    proc.on('error', (error) => {
      console.error(`Error running ${testPath}:`, error);
      resolve(false);
    });
  });
}

async function runAllTests() {
  console.log('\n========================================');
  console.log('Clout Integration Test Suite');
  console.log('========================================');

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const success = await runTest(test);
    if (success) {
      passed++;
    } else {
      failed++;
    }
  }

  console.log('\n========================================');
  console.log('Test Results');
  console.log('========================================');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${tests.length}`);
  console.log('========================================\n');
  console.log('Note: 05-live-services.test.ts is not included here.');
  console.log('      Run it separately with: npm run test:live\n');

  process.exit(failed > 0 ? 1 : 0);
}

runAllTests().catch(error => {
  console.error('Fatal error running tests:', error);
  process.exit(1);
});
