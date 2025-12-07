# HyperToken Vendored Code

This directory contains vendored code from the [HyperToken](https://github.com/flammafex/hypertoken) project.

## Files

- **PeerConnection.ts** - WebSocket-based P2P connection class
- **events.ts** - Event emitter base class
- **crypto.ts** - Cryptographic utility functions

## License

These files are licensed under the Apache License 2.0, Copyright 2025 The Carpocratian Church of Commonality and Equality, Inc.

Original source: https://github.com/flammafex/hypertoken

## Why Vendored?

We vendor these specific files instead of using the full hypertoken-monorepo package to:

1. **Avoid dependency bloat** - We only need the networking layer, not the full game engine
2. **Simplify TypeScript compilation** - Avoid internal type issues in the broader codebase
3. **Control versioning** - Pin to a known-good version of the networking code

## Modifications

Minor modifications have been made:
- Removed `Engine` import from PeerConnection.ts (changed type to `any`)
- Updated import paths to be local to this vendor directory
- Added "Vendored for Scarcity" notices

## Relay Server

To use HyperToken networking, you need a relay server. The simplest way is to use HyperToken's built-in RelayServer:

```bash
# Clone hypertoken
git clone https://github.com/flammafex/hypertoken
cd hypertoken

# Create simple relay server script
cat > relay.js << 'EOF'
import { RelayServer } from './network/RelayServer.js';

const relay = new RelayServer({ port: 8080, verbose: true });
relay.start();
console.log('Relay server listening on ws://localhost:8080');
EOF

# Run it
node relay.js
```

Alternatively, deploy a production relay using Docker or a cloud service.

## Updating

To update these vendored files:

1. Check the hypertoken repository for updates
2. Copy the latest versions of the files
3. Re-apply the modifications listed above
4. Test that compilation and integration still work

## WASM Module Update Required

The current vendored WASM module stores state as a JSON string internally, which breaks field-level CRDT merge semantics. When changes are made, the entire state is serialized to JSON and stored as a single CRDT field, losing the ability to merge individual field changes correctly.

To restore proper CRDT functionality:

1. Update the WASM module from HyperToken's latest build that uses native Automerge document structure
2. The updated module should expose binary save/load methods that preserve the full Automerge document format
3. Rebuild with: `cd hypertoken && cargo build --release --target wasm32-unknown-unknown`
4. Copy the updated `.wasm` file to this vendor directory

Until the WASM module is updated, the Chronicle implementation uses binary sync via `A.load()` to preserve as much CRDT history as possible when transferring state between WASM and TypeScript layers.
