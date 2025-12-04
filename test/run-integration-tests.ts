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

const tests = [
  'integration/01-clout-gossip.test.js'
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

  process.exit(failed > 0 ? 1 : 0);
}

runAllTests().catch(error => {
  console.error('Fatal error running tests:', error);
  process.exit(1);
});
