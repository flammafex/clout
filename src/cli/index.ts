#!/usr/bin/env node
/**
 * Clout CLI - Command-line interface for Clout protocol
 *
 * A CLI for managing identity, posts, and trust relationships.
 */

import { Command } from './command.js';
import { WalletCommand } from './commands/wallet.js';
import { ConfigCommand } from './commands/config.js';
import { InteractiveCommand } from './commands/interactive.js';

const VERSION = '0.1.0';

async function main() {
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

  // Map commands
  const commands: { [key: string]: Command } = {
    wallet: new WalletCommand(),
    config: new ConfigCommand(),
    interactive: new InteractiveCommand(),
    repl: new InteractiveCommand(), // Alias
  };

  const command = commands[commandName];

  if (!command) {
    console.error(`Unknown command: ${commandName}`);
    console.error('Run "scar --help" for usage information');
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

COMMANDS:
  wallet         Manage wallets and keys
  config         Configuration management
  interactive    Interactive REPL mode

OPTIONS:
  -h, --help     Show this help message
  -v, --version  Show version information

EXAMPLES:
  # Create a new wallet
  clout wallet create

  # Start interactive mode
  clout interactive

  # Start interactive mode
  scar interactive

For detailed command help:
  scar <command> --help

Documentation: https://github.com/flammafex/scarcity
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
