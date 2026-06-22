/**
 * FreebirdBootstrap - Bootstrap Freebird owner and Dunbar invitation pool
 *
 * Owner registration runs on every startup (Freebird handles idempotency).
 * Invitation bootstrap runs if no invitations exist yet.
 *
 * Extracted from CloutWebServer as part of Tier 3 Phase 5.
 */

import { createFreebirdAdminFromEnv, normalizeSignatureToBase64Url } from '../integrations/freebird-admin.js';
import type { InvitationRedemption } from './invitation-redemption.js';
import type { InvitationRedemptionStore } from '../store/invitation-redemption-store.js';

export interface FreebirdBootstrapConfig {
  readonly invitationRedemption: InvitationRedemption;
  readonly invitationStore: InvitationRedemptionStore;
}

export class FreebirdBootstrap {
  private readonly invitationRedemption: InvitationRedemption;
  private readonly invitationStore: InvitationRedemptionStore;

  constructor(config: FreebirdBootstrapConfig) {
    this.invitationRedemption = config.invitationRedemption;
    this.invitationStore = config.invitationStore;
  }

  /**
   * Register Self as Freebird owner and bootstrap invitations if needed.
   *
   * @param selfPublicKey The public key of the Self identity (hex string)
   */
  async bootstrap(selfPublicKey: string): Promise<void> {
    const sybilMode = process.env.FREEBIRD_SYBIL_MODE || 'invitation';

    if (sybilMode !== 'invitation') {
      console.log('[Bootstrap] Skipping Freebird setup (not in invitation mode)');
      return;
    }

    const freebirdAdmin = createFreebirdAdminFromEnv();
    if (!freebirdAdmin) {
      console.warn('[Bootstrap] No admin key configured, skipping Freebird setup');
      return;
    }

    try {
      // Check if Freebird is accessible
      const isHealthy = await freebirdAdmin.healthCheck();
      if (!isHealthy) {
        console.warn('[Bootstrap] Freebird admin API not accessible, skipping setup');
        return;
      }

      // Always register Self as the Freebird owner (first registration wins)
      await freebirdAdmin.registerOwner(selfPublicKey);

      // Check if invitations already exist
      const existingInvites = await freebirdAdmin.listInvitations();

      // Only bootstrap if we successfully got an empty list (count === 0)
      // If listInvitations returned null (error), skip bootstrap to be safe
      if (existingInvites === null) {
        console.log(`[Bootstrap] Could not check existing invitations, skipping bootstrap`);
        return;
      }

      if (existingInvites.length > 0) {
        console.log(`[Bootstrap] ${existingInvites.length} invitations already exist, skipping bootstrap`);

        // Re-download mappings if local invitations.json is missing
        if (!this.invitationStore.exists()) {
          console.log(`[Bootstrap] Local invitations.json missing, re-downloading from Freebird...`);
          for (const inv of existingInvites) {
            this.invitationRedemption.registerInvitation(
              inv.code,
              selfPublicKey,
              inv.signature ? normalizeSignatureToBase64Url(inv.signature) : undefined
            );
          }
          this.invitationStore.saveBootstrapInvitations({
            invitations: existingInvites.map(i => ({
              code: i.code,
              signature: i.signature ? normalizeSignatureToBase64Url(i.signature) : ''
            })),
            inviter: selfPublicKey,
            adminUrl: freebirdAdmin.getAdminUiUrl()
          });
          console.log(`[Bootstrap] Re-downloaded ${existingInvites.length} invitation mappings`);
        }
        return;
      }

      // Create the Dunbar pool (50 invitations - within Freebird's 1-100 limit)
      const invitations = await freebirdAdmin.bootstrapDunbarPool(selfPublicKey, 50);

      // Store invitation-to-inviter and invitation-to-signature mappings
      for (const inv of invitations) {
        this.invitationRedemption.registerInvitation(inv.code, selfPublicKey, inv.signature);
      }

      // Save invitation codes AND signatures to a file for admin reference
      this.invitationStore.saveBootstrapInvitations({
        invitations: invitations.map(i => ({ code: i.code, signature: i.signature })),
        inviter: selfPublicKey,
        adminUrl: freebirdAdmin.getAdminUiUrl()
      });

      console.log(`[Bootstrap] ✅ Dunbar pool created!`);
      console.log(`[Bootstrap] 📝 ${invitations.length} invitation codes saved`);
      console.log(`[Bootstrap] 🔧 Admin UI: ${freebirdAdmin.getAdminUiUrl()}`);

    } catch (error: any) {
      console.warn(`[Bootstrap] Freebird setup failed: ${error.message}`);
      console.warn('[Bootstrap] You can configure via the Freebird Admin UI');
    }
  }
}
