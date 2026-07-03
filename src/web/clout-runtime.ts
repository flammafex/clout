/**
 * CloutRuntime - Clout instance initialization lifecycle
 *
 * Owns the Clout instance lifecycle: identity load/create, Freebird bootstrap,
 * infrastructure initialization, and Clout construction.
 *
 * Extracted from CloutWebServer as part of Tier 3 Phase 7.
 */

import { IdentityManager } from '../cli/identity-manager.js';
import { InfrastructureManager } from '../cli/infrastructure.js';
import { Clout } from '../clout.js';
import { FileSystemStore } from '../store/file-store.js';
import { FreebirdBootstrap } from './freebird-bootstrap.js';
import type { OwnerRegistry } from './owner-registry.js';
import type { InvitationRedemption } from './invitation-redemption.js';
import type { InvitationRedemptionStore } from '../store/invitation-redemption-store.js';
import type { FreebirdAdapter } from '../integrations/freebird.js';

export interface CloutRuntimeConfig {
  readonly identityManager: IdentityManager;
  readonly infraManager: InfrastructureManager;
  readonly ownerRegistry: OwnerRegistry;
  readonly invitationRedemption: InvitationRedemption;
  readonly invitationStore: InvitationRedemptionStore;
}

export class CloutRuntime {
  private readonly identityManager: IdentityManager;
  private readonly infraManager: InfrastructureManager;
  private readonly ownerRegistry: OwnerRegistry;
  private readonly freebirdBootstrap: FreebirdBootstrap;

  private clout?: Clout;
  private initialized = false;
  private freebirdAdapter?: FreebirdAdapter;
  private store?: FileSystemStore;

  constructor(config: CloutRuntimeConfig) {
    this.identityManager = config.identityManager;
    this.infraManager = config.infraManager;
    this.ownerRegistry = config.ownerRegistry;
    this.freebirdBootstrap = new FreebirdBootstrap({
      invitationRedemption: config.invitationRedemption,
      invitationStore: config.invitationStore
    });
  }

  getClout(): Clout | undefined {
    return this.clout;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getFreebirdAdapter(): FreebirdAdapter | undefined {
    return this.freebirdAdapter;
  }

  getStore(): FileSystemStore | undefined {
    return this.store;
  }

  /**
   * Initialize Clout instance.
   * Startup order MUST remain: identity → Freebird bootstrap → owner load →
   * infrastructure init → FileSystemStore → Clout construction → loadSavedTicket.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load or create identity
    let identity;
    try {
      identity = this.identityManager.getIdentity();
    } catch (error) {
      // No identity exists - create a default one
      console.log('No identity found, creating default identity...');
      identity = this.identityManager.createIdentity('default', true);
      console.log(`Created new identity: ${identity.publicKey.slice(0, 16)}...`);
    }
    const secretKey = this.identityManager.getSecretKey();

    // Register Self as Freebird owner and bootstrap invitations if needed
    await this.freebirdBootstrap.bootstrap(identity.publicKey);

    // Check if we have admin capabilities (have admin key)
    const hasAdminKey = !!process.env.FREEBIRD_ADMIN_KEY;

    // Load owner public key from environment or file
    this.ownerRegistry.load();

    // Initialize infrastructure (Freebird, Witness, Gossip)
    console.log('Initializing Clout infrastructure...');
    const infra = await this.infraManager.initialize({
      userPublicKey: identity.publicKey,
      isOwner: hasAdminKey
    });

    // Store Freebird adapter for browser VOPRF proxy
    this.freebirdAdapter = infra.freebird;

    // Initialize persistent storage (path logged by FileStore)
    this.store = new FileSystemStore();
    await this.store.init();

    this.clout = new Clout({
      publicKey: identity.publicKey,
      privateKey: secretKey,
      freebird: infra.freebird,
      witness: infra.witness,
      gossip: infra.gossip,
      store: this.store
    });

    // Load persisted ticket if available (survives Docker restarts)
    await this.clout.loadSavedTicket();

    this.initialized = true;
    console.log(`Clout initialized with identity: ${identity.publicKey.slice(0, 16)}...`);
    if (hasAdminKey) {
      console.log(`Admin key configured (admin API enabled)`);
      if (this.ownerRegistry.get()) {
        console.log(`Instance owner: ${this.ownerRegistry.get()!.slice(0, 16)}...`);
      } else {
        console.log(`No instance owner set - first bootstrap invitation redeemer will become owner`);
      }
    }
  }

}
