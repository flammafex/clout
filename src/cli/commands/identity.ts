/**
 * Identity command - Manage identities and keys
 */

import { Command } from '../command.js';
import { IdentityManager } from '../identity-manager.js';

export class IdentityCommand extends Command {
  constructor() {
    super('identity', 'Manage identities and keys');
  }

  async execute(args: string[]): Promise<void> {
    const { positional, options } = this.parseArgs(args);

    if (options.help || options.h) {
      this.showHelp();
      return;
    }

    const subcommand = positional[0];

    if (!subcommand) {
      this.showHelp();
      return;
    }

    const identityManager = new IdentityManager();

    switch (subcommand) {
      case 'create':
        await this.create(identityManager, positional, options);
        break;

      case 'list':
        await this.list(identityManager);
        break;

      case 'show':
        await this.show(identityManager, positional, options);
        break;

      case 'import':
        await this.import(identityManager, positional, options);
        break;

      case 'export':
        await this.export(identityManager, positional, options);
        break;

      case 'delete':
        await this.delete(identityManager, positional, options);
        break;

      case 'default':
        await this.setDefault(identityManager, positional, options);
        break;

      default:
        console.error(`Unknown subcommand: ${subcommand}`);
        this.showHelp();
        process.exit(1);
    }
  }

  private async create(manager: IdentityManager, positional: string[], options: any): Promise<void> {
    const name = positional[1] || 'default';
    const setDefault = options.default !== false;

    try {
      const identity = manager.createIdentity(name, setDefault);

      console.log('✅ Identity created successfully!');
      console.log('');
      console.log(`Name:       ${identity.name}`);
      console.log(`Public Key: ${identity.publicKey}`);
      console.log('');
      console.log('⚠️  IMPORTANT: Back up your secret key!');
      console.log('');
      console.log(`Secret Key: ${identity.secretKey}`);
      console.log('');
      console.log('Store this secret key safely. You will need it to sign posts and trust signals.');
      console.log('Anyone with this secret key can impersonate your identity!');
      console.log('');

      if (setDefault) {
        console.log(`✓ Set as default identity`);
      }
    } catch (error: any) {
      console.error(`Failed to create identity: ${error.message}`);
      process.exit(1);
    }
  }

  private async list(manager: IdentityManager): Promise<void> {
    const identities = manager.listIdentities();
    const defaultIdentity = manager.getDefaultIdentityName();

    if (identities.length === 0) {
      console.log('No identities found. Create one with: clout identity create');
      return;
    }

    console.log('');
    console.log('Identities:');
    console.log('');

    for (const identity of identities) {
      const isDefault = identity.name === defaultIdentity ? ' (default)' : '';
      const date = new Date(identity.created).toLocaleString();

      console.log(`  ${identity.name}${isDefault}`);
      console.log(`    Public Key: ${identity.publicKey}`);
      console.log(`    Created:    ${date}`);
      console.log('');
    }
  }

  private async show(manager: IdentityManager, positional: string[], options: any): Promise<void> {
    const name = positional[1];

    try {
      const identity = manager.getIdentity(name);
      const isDefault = name === manager.getDefaultIdentityName() || (!name && manager.getDefaultIdentityName());
      const date = new Date(identity.created).toLocaleString();

      console.log('');
      console.log(`Identity: ${identity.name}${isDefault ? ' (default)' : ''}`);
      console.log('');
      console.log(`Public Key: ${identity.publicKey}`);
      console.log(`Created:    ${date}`);
      console.log('');

      if (options.secret) {
        console.log('⚠️  SECRET KEY (keep safe!):');
        console.log(identity.secretKey);
        console.log('');
      } else {
        console.log('Use --secret to show secret key');
        console.log('');
      }
    } catch (error: any) {
      console.error(`Failed to show identity: ${error.message}`);
      process.exit(1);
    }
  }

  private async import(manager: IdentityManager, positional: string[], options: any): Promise<void> {
    const name = this.requireArg(positional, 1, 'name');
    const secretKey = this.requireOption(options, 'secret', 'secret');
    const setDefault = options.default === true;

    try {
      const identity = manager.importIdentity(name, secretKey as string, setDefault);

      console.log('✅ Identity imported successfully!');
      console.log('');
      console.log(`Name:       ${identity.name}`);
      console.log(`Public Key: ${identity.publicKey}`);
      console.log('');

      if (setDefault) {
        console.log(`✓ Set as default identity`);
      }
    } catch (error: any) {
      console.error(`Failed to import identity: ${error.message}`);
      process.exit(1);
    }
  }

  private async export(manager: IdentityManager, positional: string[], options: any): Promise<void> {
    const name = positional[1];

    try {
      const secretKey = manager.exportSecret(name);

      console.log('');
      console.log('⚠️  SECRET KEY (keep this safe!):');
      console.log('');
      console.log(secretKey);
      console.log('');
      console.log('Anyone with this secret key can impersonate your identity!');
      console.log('');
    } catch (error: any) {
      console.error(`Failed to export identity: ${error.message}`);
      process.exit(1);
    }
  }

  private async delete(manager: IdentityManager, positional: string[], options: any): Promise<void> {
    const name = this.requireArg(positional, 1, 'name');

    if (!options.confirm) {
      console.error('');
      console.error('⚠️  WARNING: This will permanently delete the identity!');
      console.error('Make sure you have backed up the secret key.');
      console.error('');
      console.error('To confirm deletion, add --confirm flag');
      console.error('');
      process.exit(1);
    }

    try {
      manager.deleteIdentity(name);

      console.log('');
      console.log(`✅ Identity '${name}' deleted`);
      console.log('');
    } catch (error: any) {
      console.error(`Failed to delete identity: ${error.message}`);
      process.exit(1);
    }
  }

  private async setDefault(manager: IdentityManager, positional: string[], options: any): Promise<void> {
    const name = this.requireArg(positional, 1, 'name');

    try {
      manager.setDefault(name);

      console.log('');
      console.log(`✅ Set '${name}' as default identity`);
      console.log('');
    } catch (error: any) {
      console.error(`Failed to set default identity: ${error.message}`);
      process.exit(1);
    }
  }

  showHelp(): void {
    console.log(`
USAGE:
  clout identity <subcommand> [options]

SUBCOMMANDS:
  create [name]              Create a new identity
  list                       List all identities
  show [name]                Show identity details
  import <name> --secret KEY Import identity from secret key
  export [name]              Export identity secret key
  delete <name> --confirm    Delete an identity
  default <name>             Set default identity

OPTIONS:
  --secret      Show/provide secret key
  --default     Set as default identity
  --confirm     Confirm destructive operation
  -h, --help    Show this help message

EXAMPLES:
  # Create a new identity
  clout identity create

  # Create a named identity
  clout identity create alice

  # List all identities
  clout identity list

  # Show identity with secret
  clout identity show alice --secret

  # Import an identity
  clout identity import bob --secret 0x1234...

  # Export identity secret
  clout identity export alice

  # Set default identity
  clout identity default alice

  # Delete an identity
  clout identity delete bob --confirm
`);
  }
}
