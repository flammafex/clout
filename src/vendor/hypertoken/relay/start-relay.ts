#!/usr/bin/env npx ts-node
/*
 * start-relay.ts
 * Standalone HyperToken relay server for Clout P2P networking
 *
 * Usage:
 *   npx ts-node src/vendor/hypertoken/relay/start-relay.ts [port]
 *   node dist/src/vendor/hypertoken/relay/start-relay.js [port]
 *
 * Or with environment variable:
 *   RELAY_PORT=3000 npx ts-node src/vendor/hypertoken/relay/start-relay.ts
 */

import { RelayServer } from "./RelayServer.js";

const port = parseInt(process.argv[2] || process.env.RELAY_PORT || "8080", 10);
const verbose = process.env.RELAY_VERBOSE === "true" || process.argv.includes("--verbose");

const relay = new RelayServer({ port, verbose });

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[Relay] Received SIGINT, shutting down...");
  relay.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n[Relay] Received SIGTERM, shutting down...");
  relay.stop();
  process.exit(0);
});

// Start the server
relay.start().then(() => {
  console.log(`[Relay] Ready to accept connections`);
  if (verbose) {
    console.log(`[Relay] Verbose logging enabled`);
  }
}).catch((err) => {
  console.error("[Relay] Failed to start:", err);
  process.exit(1);
});
