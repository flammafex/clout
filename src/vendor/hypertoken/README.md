# HyperToken Vendored Code

This directory contains vendored code from the [HyperToken](https://github.com/flammafex/hypertoken) project.

## Files

### Client-Side Networking
- **HybridPeerManager.ts** - Hybrid WebSocket + WebRTC peer manager with auto-upgrade
- **PeerConnection.ts** - WebSocket-based P2P connection class
- **WebRTCConnection.ts** - WebRTC DataChannel connection
- **SignalingService.ts** - WebRTC signaling handler
- **webrtc-polyfill.ts** - Node.js WebRTC compatibility

### Core Utilities
- **events.ts** - Event emitter base class
- **crypto.ts** - Cryptographic utility functions

### State Management
- **Chronicle.ts** - CRDT state management (Automerge + WASM)
- **WasmBridge.ts** - WASM module loader
- **pkg/** - Compiled WASM binaries

### Relay Server
- **relay/RelayServer.ts** - Standalone P2P relay server
- **relay/start-relay.ts** - Entry point script

## Running the Relay Server

### Development (with ts-node)
```bash
npx ts-node src/vendor/hypertoken/relay/start-relay.ts 3000
```

### Production (compiled)
```bash
npm run build
node dist/src/vendor/hypertoken/relay/start-relay.js 3000
```

### With Docker
```bash
docker compose up -d hypertoken-relay
```

### Environment Variables
- `RELAY_PORT` - Port to listen on (default: 8080)
- `RELAY_VERBOSE` - Enable verbose logging (set to "true")

### Command Line
```bash
# Specify port
node start-relay.js 3000

# Enable verbose logging
node start-relay.js 3000 --verbose
```

## License

These files are licensed under the Apache License 2.0, Copyright 2025 The Carpocratian Church of Commonality and Equality, Inc.

Original source: https://github.com/flammafex/hypertoken

## Modifications

Minor modifications have been made:
- Removed `Engine` import from PeerConnection.ts (changed type to `any`)
- Updated import paths to be local to this vendor directory
- Added WebRTC tie-breaker to prevent glare in HybridPeerManager
- Added "Vendored for Clout" notices

## Updating

To update these vendored files:

1. Check the hypertoken repository for updates
2. Copy the latest versions of the files
3. Re-apply the modifications listed above
4. Test that compilation and integration still work
