/**
 * Clout Command - Core protocol operations
 *
 * Handles posting, following, viewing feed, and invitations
 */

import { Command } from '../command.js';
import { IdentityManager } from '../identity-manager.js';
import { InfrastructureManager } from '../infrastructure.js';
import { Clout } from '../../clout.js';
import { FileSystemStore } from '../../store/file-store.js';
import { readFileSync, writeFileSync } from 'fs';

export class CloutCommand extends Command {
  private identityManager = new IdentityManager();
  private infraManager = new InfrastructureManager();
  private store?: FileSystemStore;

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
      case 'thread':
        await this.handleThread(subcommandArgs);
        break;
      case 'slide':
        await this.handleSlide(subcommandArgs);
        break;
      case 'slides':
        await this.handleSlides(subcommandArgs);
        break;
      case 'profile':
        await this.handleProfile(subcommandArgs);
        break;
      case 'identity':
        await this.handleIdentity();
        break;
      case 'invite':
        await this.handleInvite(subcommandArgs);
        break;
      case 'ticket':
        await this.handleTicket();
        break;
      case 'import':
        await this.handleImport(subcommandArgs);
        break;
      case 'export':
        await this.handleExport(subcommandArgs);
        break;
      default:
        console.error(`Unknown subcommand: ${subcommand}`);
        this.showHelp();
    }
  }

  private async getStore(): Promise<FileSystemStore> {
    if (!this.store) {
      this.store = new FileSystemStore();
      await this.store.init();
    }
    return this.store;
  }

  private async getClout(): Promise<Clout> {
    const identity = this.identityManager.getIdentity();
    const infra = this.infraManager.getInfrastructure();
    const secretKey = this.identityManager.getSecretKey();

    // Check if infrastructure is ready (Fix TS18048)
    if (!infra) {
      throw new Error('Infrastructure not initialized. Run "clout init" first.');
    }

    const store = await this.getStore();

    return new Clout({
      publicKey: identity.publicKey,
      privateKey: secretKey,
      freebird: infra.freebird,
      witness: infra.witness,
      gossip: infra.gossip,
      store
    });
  }

  private async handlePost(args: string[]): Promise<void> {
    if (args.length < 1) {
      console.error('Usage: clout post <message>');
      return;
    }

    const message = args.join(' ');
    
    try {
      const clout = await this.getClout();

      // Auto-buy ticket if needed
      // Fix TS2339: use hasActiveTicket() instead of ticketBooth.hasTicket()
      if (!clout.hasActiveTicket()) {
        console.log('Minting day pass...');
        const token = await clout.obtainToken();
        await clout.buyDayPass(token);
      }

      const post = await clout.post(message);
      console.log(`\n✅ Post created: ${post.getPackage().id.slice(0, 8)}`);
    } catch (error: any) {
      console.error('Failed to post:', error.message);
    }
  }

  private async handleReply(args: string[]): Promise<void> {
    if (args.length < 2) {
      console.error('Usage: clout reply <postId> <message>');
      return;
    }

    const postId = args[0];
    const message = args.slice(1).join(' ');
    
    try {
      const clout = await this.getClout();

      // Fix TS2339: use hasActiveTicket()
      if (!clout.hasActiveTicket()) {
        console.log('Minting day pass...');
        const token = await clout.obtainToken();
        await clout.buyDayPass(token);
      }

      const post = await clout.post(message, { replyTo: postId });
      console.log(`\n✅ Reply created: ${post.getPackage().id.slice(0, 8)}`);
    } catch (error: any) {
      console.error('Failed to reply:', error.message);
    }
  }

  private async handleFollow(args: string[]): Promise<void> {
    if (args.length < 1) {
      console.error('Usage: clout follow <publicKey>');
      return;
    }

    const targetKey = args[0];

    try {
      const clout = await this.getClout();
      const store = await this.getStore();
      const identity = this.identityManager.getIdentity();

      // Gossip the trust signal to the network
      await clout.trust(targetKey);

      // Persist to CLI's local trust graph (Dark Social Graph)
      await store.saveTrustEdge(identity.publicKey, targetKey);
      console.log(`[CLI] 📂 Trust edge saved locally`);
    } catch (error: any) {
      console.error('Failed to follow:', error.message);
    }
  }

  private async handleFeed(args: string[]): Promise<void> {
    const limit = args.length > 0 ? parseInt(args[0], 10) : 20;

    try {
      const clout = await this.getClout();
      const store = await this.getStore();
      const identity = this.identityManager.getIdentity();

      // Load CLI's local trust graph from file store (Dark Social Graph)
      const trustGraphMap = await store.getTrustGraph();
      const myTrusts = trustGraphMap.get(identity.publicKey) || new Set<string>();
      // Always include self in trust graph
      myTrusts.add(identity.publicKey);

      // Get feed filtered by local trust graph
      const allPosts = await clout.getFeed({
        filterByTrust: true,
        trustGraph: myTrusts
      });
      const posts = allPosts.slice(0, limit);

      console.log(`\nYOUR FEED (${allPosts.length} posts from ${myTrusts.size} trusted users)\n`);
      console.log(`──────────────────────────────────────────────────────`);

      for (const post of posts) {
        const author = post.author.slice(0, 8);
        const date = new Date(post.proof.timestamp).toLocaleString();

        console.log(`\n[${author}] ${date} (ID: ${post.id.slice(0, 8)})`);
        if (post.replyTo) {
          console.log(`↪ Replying to: ${post.replyTo.slice(0, 8)}`);
        }
        console.log(`${post.content}`);
        console.log(`\n──────────────────────────────────────────────────────`);
      }

      if (allPosts.length > limit) {
        console.log(`\nShowing ${limit} of ${allPosts.length} posts. Use 'clout feed ${allPosts.length}' to see all.`);
      }
    } catch (error: any) {
      console.error('Failed to load feed:', error.message);
    }
  }

  private async handleThread(args: string[]): Promise<void> {
    if (args.length < 1) {
      console.error('Usage: clout thread <postId>');
      return;
    }

    const postId = args[0];

    try {
      const clout = await this.getClout();
      const allPosts = await clout.getFeed();

      const parentPost = allPosts.find((p: any) => p.id === postId);
      if (!parentPost) {
        console.error('Post not found in your feed');
        return;
      }

      const replies = allPosts
        .filter((p: any) => p.replyTo === postId)
        .sort((a: any, b: any) => a.proof.timestamp - b.proof.timestamp);

      console.log(`\nTHREAD (${1 + replies.length} posts)\n`);
      
      // Print Parent
      const pAuthor = parentPost.author.slice(0, 8);
      const pDate = new Date(parentPost.proof.timestamp).toLocaleString();
      console.log(`[${pAuthor}] ${pDate} (ID: ${parentPost.id.slice(0, 8)})`);
      console.log(`${parentPost.content}`);
      console.log(`──────────────────────────────────────────────────────`);

      // Print Replies
      for (const reply of replies) {
        const rAuthor = reply.author.slice(0, 8);
        const rDate = new Date(reply.proof.timestamp).toLocaleString();
        console.log(`    ↳ [${rAuthor}] ${rDate}`);
        console.log(`      ${reply.content}`);
        console.log(`──────────────────────────────────────────────────────`);
      }
    } catch (error: any) {
      console.error('Failed to load thread:', error.message);
    }
  }

  private async handleSlide(args: string[]): Promise<void> {
    if (args.length < 2) {
      console.error('Usage: clout slide <publicKey> <message>');
      return;
    }

    const recipient = args[0];
    const message = args.slice(1).join(' ');
    
    try {
      const clout = await this.getClout();
      await clout.slide(recipient, message);
      // Success message logged by Clout
    } catch (error: any) {
      console.error('Failed to send slide:', error.message);
    }
  }

  private async handleSlides(args: string[]): Promise<void> {
    const limit = args.length > 0 ? parseInt(args[0], 10) : 10;
    
    try {
      const clout = await this.getClout();
      const inbox = await clout.getInbox();

      if (inbox.slides.length === 0) {
        console.log('\nNo slides in your inbox.\n');
        return;
      }

      console.log(`\nYOUR SLIDES (${inbox.slides.length})\n`);
      
      const slidesToShow = inbox.slides.slice(0, limit);

      for (const slide of slidesToShow) {
        const sender = slide.sender.slice(0, 8);
        const timestamp = new Date(slide.proof.timestamp).toLocaleString();
        let content = '[Encrypted]';

        try {
          content = clout.decryptSlide(slide);
        } catch (e) {
          content = '[Decryption Failed]';
        }

        console.log(`┌─ From: ${sender} ─────────────────────────────────┐`);
        console.log(`│ ${content.padEnd(50)} │`);
        console.log(`├─────────────────────────────────────────────────────┤`);
        console.log(`│ ${timestamp.padEnd(50)} │`);
        console.log(`└─────────────────────────────────────────────────────┘\n`);
      }

      if (inbox.slides.length > limit) {
        console.log(`Showing ${limit} of ${inbox.slides.length} slides. Use 'clout slides ${inbox.slides.length}' to see all.\n`);
      }
    } catch (error: any) {
      console.error('Failed to load slides:', error.message);
    }
  }

  private async handleProfile(args: string[]): Promise<void> {
    const subcommand = args[0];

    if (!subcommand || subcommand === 'show') {
      // Show current profile
      await this.showProfile();
    } else if (subcommand === 'set') {
      // Set profile metadata
      await this.setProfile(args.slice(1));
    } else if (subcommand === 'get') {
      // Get profile for a specific user
      await this.getProfile(args[1]);
    } else {
      console.error('Usage:');
      console.error('  clout profile show                    - Show your profile');
      console.error('  clout profile set --name "..." --bio "..." --avatar "..."');
      console.error('  clout profile get <publicKey>         - View another user\'s profile');
    }
  }

  private async showProfile(): Promise<void> {
    try {
      const clout = await this.getClout();
      const profile = clout.getProfile();

      console.log('\n═══════════════════════════════════════════════');
      console.log('                 YOUR PROFILE');
      console.log('═══════════════════════════════════════════════\n');

      if (profile.metadata?.displayName) {
        console.log(`Name:        ${profile.metadata.displayName}`);
      }
      if (profile.metadata?.bio) {
        console.log(`Bio:         ${profile.metadata.bio}`);
      }
      if (profile.metadata?.avatar) {
        console.log(`Avatar:      ${profile.metadata.avatar}`);
      }

      console.log(`Public Key:  ${profile.publicKey.slice(0, 16)}...`);
      console.log(`Following:   ${profile.trustGraph.size} users\n`);
    } catch (error: any) {
      console.error('Failed to get profile:', error.message);
    }
  }

  private async setProfile(args: string[]): Promise<void> {
    try {
      // Parse arguments
      const metadata: any = {};
      for (let i = 0; i < args.length; i += 2) {
        const flag = args[i];
        const value = args[i + 1];

        if (!value) {
          console.error(`Missing value for ${flag}`);
          return;
        }

        if (flag === '--name') {
          metadata.displayName = value;
        } else if (flag === '--bio') {
          metadata.bio = value;
        } else if (flag === '--avatar') {
          metadata.avatar = value;
        } else {
          console.error(`Unknown flag: ${flag}`);
          return;
        }
      }

      if (Object.keys(metadata).length === 0) {
        console.error('No metadata provided. Use --name, --bio, or --avatar');
        return;
      }

      const clout = await this.getClout();
      await clout.setProfileMetadata(metadata);

      console.log('\n✅ Profile updated successfully!');
      console.log('   Your profile will sync to peers automatically.\n');
    } catch (error: any) {
      console.error('Failed to update profile:', error.message);
    }
  }

  private async getProfile(publicKey?: string): Promise<void> {
    if (!publicKey) {
      console.error('Error: Public key required');
      console.error('Usage: clout profile get <publicKey>');
      return;
    }

    try {
      const clout = await this.getClout();
      const profile = clout.getProfileForUser(publicKey);

      if (!profile) {
        console.log(`\nNo profile found for ${publicKey}\n`);
        return;
      }

      console.log('\n═══════════════════════════════════════════════');
      console.log(`            PROFILE: ${publicKey.slice(0, 16)}...`);
      console.log('═══════════════════════════════════════════════\n');

      if (profile.metadata?.displayName) {
        console.log(`Name:        ${profile.metadata.displayName}`);
      } else {
        console.log(`Name:        (not set)`);
      }

      if (profile.metadata?.bio) {
        console.log(`Bio:         ${profile.metadata.bio}`);
      }

      if (profile.metadata?.avatar) {
        console.log(`Avatar:      ${profile.metadata.avatar}`);
      }

      console.log(`Public Key:  ${profile.publicKey.slice(0, 16)}...`);
      console.log(`Following:   ${profile.trustGraph.size} users\n`);
    } catch (error: any) {
      console.error('Failed to get profile:', error.message);
    }
  }

  private async handleIdentity(): Promise<void> {
    const identity = this.identityManager.getIdentity();
    console.log(`\nActive Identity: ${identity.name}`);
    console.log(`Public Key:      ${identity.publicKey}`);
    console.log(`Created:         ${new Date(identity.created).toLocaleString()}\n`);
  }

  private async handleInvite(args: string[]): Promise<void> {
    if (args.length < 1) {
      console.error('Usage: clout invite <publicKey>');
      return;
    }
    try {
      const clout = await this.getClout();
      const { code } = await clout.invite(args[0], {});
      console.log(`\nInvitation created!`);
      // In real app, code would be hex string
    } catch (error: any) {
      console.error('Failed to invite:', error.message);
    }
  }

  private async handleTicket(): Promise<void> {
    try {
      const clout = await this.getClout();
      // Fix TS2339: use hasActiveTicket()
      const hasTicket = clout.hasActiveTicket();

      console.log(`\nDay Pass Status: ${hasTicket ? '✅ Active' : '❌ Expired/Missing'}`);
      if (hasTicket) {
        // Logic to show expiry would go here
      }
      console.log('');
    } catch (error: any) {
      console.error('Failed to check ticket:', error.message);
    }
  }

  private async handleImport(args: string[]): Promise<void> {
    if (args.length < 1) {
      console.error('Usage: clout import <backup.json>');
      console.error('');
      console.error('Import a backup file exported from Clout browser or CLI.');
      console.error('This restores your Dark Social Graph (trust, nicknames, tags, etc.)');
      return;
    }

    const filePath = args[0];

    try {
      console.log(`\nReading backup from: ${filePath}`);
      const raw = readFileSync(filePath, 'utf-8');
      const backup = JSON.parse(raw);

      const identity = this.identityManager.getIdentity();
      const store = await this.getStore();

      // Check for Dark Social Graph data (browser export format)
      if (backup.darkSocialGraph) {
        console.log('Found Dark Social Graph data in backup...');
        const result = store.importDarkSocialGraph(identity.publicKey, backup.darkSocialGraph);

        console.log(`\n✅ Import complete!`);
        console.log(`   Trust edges:   ${result.imported.trust}`);
        console.log(`   Nicknames:     ${result.imported.nicknames}`);
        console.log(`   Tags:          ${result.imported.tags}`);
        console.log(`   Muted users:   ${result.imported.muted}`);
        console.log(`   Bookmarks:     ${result.imported.bookmarks}\n`);
      } else if (backup.trustGraph || backup.nicknames || backup.tags) {
        // Direct Dark Social Graph format (CLI export or raw browser export)
        console.log('Importing Dark Social Graph data...');
        const result = store.importDarkSocialGraph(identity.publicKey, backup);

        console.log(`\n✅ Import complete!`);
        console.log(`   Trust edges:   ${result.imported.trust}`);
        console.log(`   Nicknames:     ${result.imported.nicknames}`);
        console.log(`   Tags:          ${result.imported.tags}`);
        console.log(`   Muted users:   ${result.imported.muted}`);
        console.log(`   Bookmarks:     ${result.imported.bookmarks}\n`);
      } else {
        console.error('No Dark Social Graph data found in backup.');
        console.error('Expected darkSocialGraph, trustGraph, or nicknames fields.');
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        console.error(`File not found: ${filePath}`);
      } else if (error instanceof SyntaxError) {
        console.error('Invalid JSON in backup file');
      } else {
        console.error('Failed to import:', error.message);
      }
    }
  }

  private async handleExport(args: string[]): Promise<void> {
    const outputPath = args[0] || 'clout-backup.json';

    try {
      const identity = this.identityManager.getIdentity();
      const store = await this.getStore();

      // Export in browser-compatible format
      const darkSocialGraph = store.exportDarkSocialGraph(identity.publicKey);

      const backup = {
        version: '1.0',
        exportedAt: Date.now(),
        exportedFrom: 'cli',
        publicKey: identity.publicKey,
        darkSocialGraph
      };

      writeFileSync(outputPath, JSON.stringify(backup, null, 2), 'utf-8');

      console.log(`\n✅ Backup exported to: ${outputPath}`);
      console.log(`   Trust edges:   ${darkSocialGraph.trustGraph.length}`);
      console.log(`   Nicknames:     ${Object.keys(darkSocialGraph.nicknames).length}`);
      console.log(`   Tags:          ${Object.keys(darkSocialGraph.tags).length}`);
      console.log(`   Muted users:   ${darkSocialGraph.muted.length}`);
      console.log(`   Bookmarks:     ${darkSocialGraph.bookmarks.length}`);
      console.log('');
      console.log('This backup can be imported into browser or CLI.\n');
    } catch (error: any) {
      console.error('Failed to export:', error.message);
    }
  }

  showHelp(): void {
    console.log(`
Clout Command - Core protocol operations

USAGE:
  clout post <message>           Create a new post
  clout reply <postId> <message> Reply to a post
  clout follow <publicKey>       Trust/follow a user
  clout feed [limit]             View your feed (default 20 posts)
  clout thread <postId>          View a thread (post + replies)
  clout slide <publicKey> <msg>  Send encrypted DM (slide)
  clout slides [limit]           View your slides inbox
  clout identity                 Show your identity
  clout invite <publicKey>       Create an invitation
  clout ticket                   Check day pass status
  clout import <backup.json>     Import Dark Social Graph from backup
  clout export [output.json]     Export Dark Social Graph to file

EXAMPLES:
  # Post a message
  clout post "Hello, Clout!"

  # Reply to a post
  clout reply 1db5bcf8 "Great post!"

  # View a thread
  clout thread 1db5bcf8

  # Send an encrypted slide (DM)
  clout slide a1b2c3d4e5f6... "Hey, this is private!"

  # View your slides
  clout slides

  # Follow someone
  clout follow 0x1234...

  # Export your Dark Social Graph
  clout export my-backup.json

  # Import from browser backup
  clout import ~/Downloads/clout-backup.json
`);
  }
}