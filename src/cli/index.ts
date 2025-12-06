#!/usr/bin/env node
/**
 * Clout CLI - Command-line interface for Clout protocol
 *
 * A CLI for managing identity, posts, and trust relationships.
 */

import { Command } from './command.js';
import { IdentityCommand } from './commands/identity.js';
import { ConfigCommand } from './commands/config.js';
import { CloutCommand } from './commands/clout.js';
import { tryLoadWasm } from '../vendor/hypertoken/WasmBridge.js';

const VERSION = '0.1.0';

async function main() {
  // Initialize WASM backend for Chronicle (7x performance boost)
  await tryLoadWasm();

  const args = process.argv.slice(2);

  // Show help if no arguments
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showHelp();
    process.exit(0);
  }

  // Show version
  if (args[0] === '--version' || args[0] === '-v') {
    console.log(`Clout CLI v${VERSION}`);
    process.exit(0);
  }

  // Parse command
  const commandName = args[0];
  const commandArgs = args.slice(1);

  // Map commands - Clout commands get the full args
  const cloutCommands = ['post', 'reply', 'follow', 'trust', 'feed', 'thread', 'slide', 'slides', 'profile', 'id', 'invite', 'ticket', 'pass'];

  if (cloutCommands.includes(commandName)) {
    const cloutCmd = new CloutCommand();
    try {
      await cloutCmd.execute(args); // Pass full args including command name
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      if (process.env.DEBUG) {
        console.error(error.stack);
      }
      process.exit(1);
    }
    return;
  }

  // Other commands
  const commands: { [key: string]: Command } = {
    identity: new IdentityCommand(),
    config: new ConfigCommand(),
  };

  const command = commands[commandName];

  if (!command) {
    console.error(`Unknown command: ${commandName}`);
    console.error('Run "clout --help" for usage information');
    process.exit(1);
  }

  try {
    await command.execute(commandArgs);
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

function showHelp() {
  console.log(`
Clout CLI v${VERSION}
Uncensorable reputation protocol - P2P social network with trust-based filtering

USAGE:
  clout <command> [options]

CORE COMMANDS:
  post           Create a new post
  reply          Reply to a post
  follow         Trust/follow a user (alias: trust)
  feed           View your feed
  thread         View a thread (post + replies)
  slide          Send encrypted DM (slide)
  slides         View your slides inbox
  id             Show your identity (quick view)
  invite         Create an invitation
  ticket         Check day pass status (alias: pass)

MANAGEMENT:
  identity       Manage identities and keys
  config         Configuration management

OPTIONS:
  -h, --help     Show this help message
  -v, --version  Show version information

EXAMPLES:
  # Create a new identity
  clout identity create

  # Post a message
  clout post "Hello, Clout!"

  # Follow someone
  clout follow a1b2c3d4e5f6...

  # View your feed
  clout feed

  # Create invitation
  clout invite a1b2c3d4e5f6...

For detailed command help:
  clout <command> --help

Documentation: https://github.com/flammafex/clout
`);
}

// Run CLI
main().catch((error) => {
  console.error('Fatal error:', error.message);
  if (process.env.DEBUG) {
    console.error(error.stack);
  }
  process.exit(1);
});
