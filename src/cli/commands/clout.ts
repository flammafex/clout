/**
 * Clout Command - Core protocol operations
 *
 * Handles posting, following, viewing feed, and invitations
 */

import { Command } from '../command.js';
import { IdentityManager } from '../identity-manager.js';
import { InfrastructureManager } from '../infrastructure.js';
import { Clout } from '../../clout.js';

export class CloutCommand extends Command {
  private identityManager = new IdentityManager();
  private infraManager = new InfrastructureManager();

  constructor() {
    super('clout', 'Post, follow, and interact with Clout protocol');
  }

  async execute(args: string[]): Promise<void> {
    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
      this.showHelp();
      return;
    }

    const subcommand = args[0];
    const subcommandArgs = args.slice(1);

    switch (subcommand) {
      case 'post':
        await this.handlePost(subcommandArgs);
        break;
      case 'reply':
        await this.handleReply(subcommandArgs);
        break;
      case 'follow':
      case 'trust':
        await this.handleFollow(subcommandArgs);
        break;
      case 'feed':
        await this.handleFeed(subcommandArgs);
        break;
      case 'identity':
      case 'id':
        await this.handleIdentity(subcommandArgs);
        break;
      case 'invite':
        await this.handleInvite(subcommandArgs);
        break;
      case 'ticket':
      case 'pass':
        await this.handleTicket(subcommandArgs);
        break;
      default:
        console.error(`Unknown subcommand: ${subcommand}`);
        console.error('Run "clout --help" for usage information');
        process.exit(1);
    }
  }

  /**
   * Post a message
   */
  private async handlePost(args: string[]): Promise<void> {
    if (args.length === 0) {
      console.error('Error: Message required');
      console.error('Usage: clout post "Your message here"');
      process.exit(1);
    }

    const message = args.join(' ');

    // Get default identity
    const defaultIdentity = this.identityManager.getDefaultIdentityName();
    if (!defaultIdentity) {
      console.error('Error: No default identity. Create one with: clout identity create');
      process.exit(1);
    }

    const identity = this.identityManager.getIdentity(defaultIdentity);
    const secretKey = this.identityManager.getSecretKey(defaultIdentity);

    // Initialize infrastructure
    console.log('🔨 Initializing Clout infrastructure...');
    const infra = await this.infraManager.initialize();

    // Create Clout instance
    const clout = new Clout({
      publicKey: identity.publicKey,
      privateKey: secretKey,
      freebird: infra.freebird,
      witness: infra.witness,
      gossip: infra.gossip
    });

    // Check if we have a day pass
    console.log('🎟️  Checking for day pass...');
    try {
      // Try to get a token and buy a day pass
      const token = await clout.obtainToken();
      await clout.buyDayPass(token);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      console.error('Hint: You need a Freebird token to post. Use: clout invite <recipient>');
      process.exit(1);
    }

    // Post the message
    console.log('📝 Posting message...');
    const post = await clout.post(message);
    const pkg = post.getPackage();

    console.log(`\n✅ Post created!`);
    console.log(`   ID: ${pkg.id.slice(0, 16)}...`);
    console.log(`   Author: ${identity.publicKey.slice(0, 16)}...`);
    console.log(`   Content: ${message}`);
  }

  /**
   * Reply to a post
   */
  private async handleReply(args: string[]): Promise<void> {
    if (args.length < 2) {
      console.error('Error: Post ID and message required');
      console.error('Usage: clout reply <postId> "Your reply here"');
      process.exit(1);
    }

    const postId = args[0];
    const message = args.slice(1).join(' ');

    // Get default identity
    const defaultIdentity = this.identityManager.getDefaultIdentityName();
    if (!defaultIdentity) {
      console.error('Error: No default identity. Create one with: clout identity create');
      process.exit(1);
    }

    const identity = this.identityManager.getIdentity(defaultIdentity);
    const secretKey = this.identityManager.getSecretKey(defaultIdentity);

    // Initialize infrastructure
    console.log('🔨 Initializing Clout infrastructure...');
    const infra = await this.infraManager.initialize();

    // Create Clout instance
    const clout = new Clout({
      publicKey: identity.publicKey,
      privateKey: secretKey,
      freebird: infra.freebird,
      witness: infra.witness,
      gossip: infra.gossip
    });

    // Check if we have a day pass
    console.log('🎟️  Checking for day pass...');
    try {
      // Try to get a token and buy a day pass
      const token = await clout.obtainToken();
      await clout.buyDayPass(token);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      console.error('Hint: You need a Freebird token to post. Use: clout invite <recipient>');
      process.exit(1);
    }

    // Post the reply
    console.log(`💬 Replying to post ${postId.slice(0, 16)}...`);
    const post = await clout.post(message, postId);
    const pkg = post.getPackage();

    console.log(`\n✅ Reply created!`);
    console.log(`   ID: ${pkg.id.slice(0, 16)}...`);
    console.log(`   Reply to: ${postId.slice(0, 16)}...`);
    console.log(`   Author: ${identity.publicKey.slice(0, 16)}...`);
    console.log(`   Content: ${message}`);
  }

  /**
   * Follow/trust a user
   */
  private async handleFollow(args: string[]): Promise<void> {
    if (args.length === 0) {
      console.error('Error: Public key required');
      console.error('Usage: clout follow <publicKey>');
      process.exit(1);
    }

    const targetPublicKey = args[0];

    // Get default identity
    const defaultIdentity = this.identityManager.getDefaultIdentityName();
    if (!defaultIdentity) {
      console.error('Error: No default identity. Create one with: clout identity create');
      process.exit(1);
    }

    const identity = this.identityManager.getIdentity(defaultIdentity);
    const secretKey = this.identityManager.getSecretKey(defaultIdentity);

    // Initialize infrastructure
    console.log('🔨 Initializing Clout infrastructure...');
    const infra = await this.infraManager.initialize();

    // Create Clout instance
    const clout = new Clout({
      publicKey: identity.publicKey,
      privateKey: secretKey,
      freebird: infra.freebird,
      witness: infra.witness,
      gossip: infra.gossip
    });

    // Trust the user
    console.log(`🤝 Trusting ${targetPublicKey.slice(0, 16)}...`);
    await clout.trust(targetPublicKey);

    console.log(`\n✅ Successfully trusted ${targetPublicKey.slice(0, 16)}...`);
    console.log('   They are now in your trust graph');
    console.log('   You will see their posts in your feed');
  }

  /**
   * View feed
   */
  private async handleFeed(args: string[]): Promise<void> {
    const limit = args.length > 0 ? parseInt(args[0], 10) : 20;

    // Get default identity
    const defaultIdentity = this.identityManager.getDefaultIdentityName();
    if (!defaultIdentity) {
      console.error('Error: No default identity. Create one with: clout identity create');
      process.exit(1);
    }

    const identity = this.identityManager.getIdentity(defaultIdentity);
    const secretKey = this.identityManager.getSecretKey(defaultIdentity);

    // Initialize infrastructure
    console.log('🔨 Initializing Clout infrastructure...');
    const infra = await this.infraManager.initialize();

    // Create Clout instance
    const clout = new Clout({
      publicKey: identity.publicKey,
      privateKey: secretKey,
      freebird: infra.freebird,
      witness: infra.witness,
      gossip: infra.gossip
    });

    // Get feed
    console.log(`📰 Loading feed (limit: ${limit})...\n`);
    const feed = clout.getFeed();
    const posts = feed.posts.slice(0, limit);

    if (posts.length === 0) {
      console.log('No posts in your feed yet.');
      console.log('\nTo see posts:');
      console.log('  1. Trust someone: clout follow <publicKey>');
      console.log('  2. Create a post: clout post "Hello, world!"');
      return;
    }

    console.log(`═══════════════════════════════════════════════════════`);
    console.log(`                  YOUR CLOUT FEED`);
    console.log(`═══════════════════════════════════════════════════════\n`);

    for (const post of posts) {
      const timestamp = new Date(post.proof.timestamp).toLocaleString();
      const authorShort = post.author.slice(0, 16) + '...';

      console.log(`┌─────────────────────────────────────────────────────┐`);
      console.log(`│ ${authorShort.padEnd(50)} │`);
      console.log(`├─────────────────────────────────────────────────────┤`);
      console.log(`│ ${post.content.padEnd(50).slice(0, 50)} │`);
      if (post.content.length > 50) {
        const lines = post.content.match(/.{1,50}/g) || [];
        for (let i = 1; i < lines.length; i++) {
          console.log(`│ ${lines[i].padEnd(50)} │`);
        }
      }
      console.log(`├─────────────────────────────────────────────────────┤`);
      console.log(`│ ${timestamp.padEnd(50)} │`);
      console.log(`└─────────────────────────────────────────────────────┘\n`);
    }

    console.log(`Showing ${posts.length} of ${feed.posts.length} posts\n`);
  }

  /**
   * Show identity
   */
  private async handleIdentity(args: string[]): Promise<void> {
    // Get default identity
    const defaultIdentity = this.identityManager.getDefaultIdentityName();
    if (!defaultIdentity) {
      console.error('Error: No default identity. Create one with: clout identity create');
      process.exit(1);
    }

    const identity = this.identityManager.getIdentity(defaultIdentity);

    console.log(`\n═══════════════════════════════════════════════════════`);
    console.log(`                   YOUR IDENTITY`);
    console.log(`═══════════════════════════════════════════════════════\n`);
    console.log(`  Identity: ${defaultIdentity}`);
    console.log(`  Public Key: ${identity.publicKey}`);
    console.log(`  Created: ${new Date(identity.created).toLocaleString()}`);
    console.log(`\n═══════════════════════════════════════════════════════\n`);
  }

  /**
   * Create invitation
   */
  private async handleInvite(args: string[]): Promise<void> {
    if (args.length === 0) {
      console.error('Error: Recipient public key required');
      console.error('Usage: clout invite <recipientPublicKey>');
      process.exit(1);
    }

    const recipientPublicKey = args[0];

    // Get default identity
    const defaultIdentity = this.identityManager.getDefaultIdentityName();
    if (!defaultIdentity) {
      console.error('Error: No default identity. Create one with: clout identity create');
      process.exit(1);
    }

    const identity = this.identityManager.getIdentity(defaultIdentity);
    const secretKey = this.identityManager.getSecretKey(defaultIdentity);

    // Initialize infrastructure
    console.log('🔨 Initializing Clout infrastructure...');
    const infra = await this.infraManager.initialize();

    // Create Clout instance
    const clout = new Clout({
      publicKey: identity.publicKey,
      privateKey: secretKey,
      freebird: infra.freebird,
      witness: infra.witness,
      gossip: infra.gossip
    });

    // Create invitation
    console.log(`📧 Creating invitation for ${recipientPublicKey.slice(0, 16)}...`);
    const invitation = await clout.invite(recipientPublicKey, {});

    console.log(`\n✅ Invitation created!`);
    console.log(`\n   Invitation Code:`);
    console.log(`   ${Buffer.from(invitation.code).toString('base64')}\n`);
    console.log(`   Share this code with the recipient.`);
    console.log(`   They can accept it with: clout accept <code>`);
  }

  /**
   * Show ticket/day pass status
   */
  private async handleTicket(args: string[]): Promise<void> {
    console.log('\n🎟️  Day Pass System');
    console.log('\nThe day pass system allows unlimited posting for 24 hours.');
    console.log('When you post, a day pass is automatically obtained if needed.');
    console.log('\nUsage:');
    console.log('  clout post "Your message"  - Will auto-obtain day pass');
  }

  showHelp(): void {
    console.log(`
Clout Command - Core protocol operations

USAGE:
  clout post <message>           Create a new post
  clout reply <postId> <message> Reply to a post
  clout follow <publicKey>       Trust/follow a user
  clout feed [limit]             View your feed (default 20 posts)
  clout identity                 Show your identity
  clout invite <publicKey>       Create an invitation
  clout ticket                   Check day pass status

EXAMPLES:
  # Post a message
  clout post "Hello, Clout!"

  # Reply to a post
  clout reply 1db5bcf8 "Great post!"

  # Follow someone
  clout follow a1b2c3d4e5f6...

  # View your feed
  clout feed

  # View last 50 posts
  clout feed 50

  # Create invitation
  clout invite a1b2c3d4e5f6...
`);
  }
}
