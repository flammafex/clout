/**
 * Quick verification that Chronicle WASM backend is working
 */

import { tryLoadWasm, isWasmAvailable } from '../src/vendor/hypertoken/WasmBridge.js';
import { CloutStateManager } from '../src/chronicle/clout-state.js';

async function verify() {
  console.log('🔍 Verifying Chronicle WASM Backend\n');

  // Load WASM
  await tryLoadWasm();

  console.log(`WASM Available: ${isWasmAvailable() ? '✅ Yes' : '❌ No'}`);

  // Create a Chronicle instance
  const stateManager = new CloutStateManager({
    myPosts: [],
    myTrustSignals: []
  });

  console.log(`Chronicle WASM Enabled: ${stateManager.chronicle.isWasmEnabled ? '✅ Yes' : '❌ No'}`);

  if (stateManager.chronicle.isWasmEnabled) {
    console.log('\n🚀 Chronicle is using Rust/WASM backend for 7x performance boost!');
  } else {
    console.log('\n⚠️  Chronicle is using TypeScript Automerge fallback');
  }
}

verify().catch(console.error);
