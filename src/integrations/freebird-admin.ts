/**
 * Freebird Admin API Client
 *
 * Provides programmatic access to Freebird's admin endpoints for:
 * - Creating invitation codes (Dunbar pool bootstrap)
 * - Granting invitation quota to users
 * - Viewing/managing users and their invitation trees
 */

export interface FreebirdAdminConfig {
  /** Freebird issuer URL (e.g., http://localhost:8081) */
  issuerUrl: string;
  /** Admin API key */
  adminKey: string;
}

export interface Invitation {
  code: string;
  signature: string;
  created_at: string;
  expires_at: string;
  redeemed: boolean;
  redeemed_by?: string;
}

export interface FreebirdStats {
  total_users: number;
  total_invitations: number;
  total_redemptions: number;
  banned_users: number;
}

export class FreebirdAdmin {
  private readonly issuerUrl: string;
  private readonly adminKey: string;

  constructor(config: FreebirdAdminConfig) {
    this.issuerUrl = config.issuerUrl.replace(/\/$/, ''); // Remove trailing slash
    this.adminKey = config.adminKey;
  }

  /**
   * Make an authenticated request to the admin API
   */
  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' = 'GET',
    body?: object
  ): Promise<T> {
    const url = `${this.issuerUrl}${endpoint}`;
    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': this.adminKey
      }
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Freebird Admin API error (${response.status}): ${error}`);
    }

    return response.json();
  }

  /**
   * Check if the admin API is accessible and the key is valid
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.request('/admin/health');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get system statistics
   */
  async getStats(): Promise<FreebirdStats> {
    return this.request('/admin/stats');
  }

  /**
   * Create invitation codes
   *
   * @param inviterId The public key of the user creating the invitations
   * @param count Number of invitations to create (default: 1)
   * @param expiresInDays Days until expiration (default: 30)
   * @returns Array of created invitation codes
   */
  async createInvitations(inviterId: string, count: number = 1, expiresInDays: number = 30): Promise<Invitation[]> {
    const response = await this.request<{ invitations: Invitation[] }>(
      '/admin/invitations/create',
      'POST',
      { inviter_id: inviterId, count, expires_in_days: expiresInDays }
    );
    return response.invitations || [];
  }

  /**
   * Grant invitation quota to a user
   *
   * @param userId User's public key
   * @param quota Number of invitations to grant
   */
  async grantInvitationQuota(userId: string, quota: number): Promise<void> {
    await this.request('/admin/invites/grant', 'POST', {
      user_id: userId,
      quota
    });
  }

  /**
   * List all invitations
   */
  async listInvitations(): Promise<Invitation[]> {
    try {
      const response = await this.request<{ invitations: Invitation[] }>('/admin/invitations');
      return response.invitations || [];
    } catch (error) {
      // If endpoint doesn't exist or fails, return empty array
      if (error instanceof Error && error.message.includes('404')) {
        console.log(`[FreebirdAdmin] ℹ️ List invitations not available`);
        return [];
      }
      console.warn(`[FreebirdAdmin] Failed to list invitations: ${error}`);
      return [];
    }
  }

  /**
   * Bootstrap the Dunbar pool
   *
   * Creates the initial set of invitations for the admin to distribute.
   * This is called on first initialization to seed the network.
   *
   * @param inviterId The public key of the owner creating the invitations
   * @param count Number of invitations (default: 50, max 100 per Freebird limit)
   * @returns The created invitations
   */
  async bootstrapDunbarPool(inviterId: string, count: number = 50): Promise<Invitation[]> {
    console.log(`[FreebirdAdmin] 🎫 Bootstrapping Dunbar pool with ${count} invitations...`);

    const invitations = await this.createInvitations(inviterId, count, 365); // 1 year expiry

    console.log(`[FreebirdAdmin] ✅ Created ${invitations.length} invitation codes`);
    return invitations;
  }

  /**
   * Get the admin UI URL
   */
  getAdminUiUrl(): string {
    return `${this.issuerUrl}/admin`;
  }

  /**
   * Register the owner of this Freebird instance
   *
   * This ties the Freebird instance to a Clout user (the "Self" user).
   * Can only be called once - first registration wins.
   *
   * @param userId The public key of the owner (Clout's "Self" user)
   * @returns The registered owner info
   */
  async registerOwner(userId: string): Promise<{ success: boolean; owner: string }> {
    console.log(`[FreebirdAdmin] 👤 Registering owner: ${userId.substring(0, 16)}...`);

    try {
      const response = await this.request<{ success: boolean; owner: string }>(
        '/admin/register-owner',
        'POST',
        { user_id: userId }
      );

      console.log(`[FreebirdAdmin] ✅ Owner registered successfully`);
      return response;
    } catch (error) {
      // If owner already registered, that's fine - just log and continue
      if (error instanceof Error && error.message.includes('already')) {
        console.log(`[FreebirdAdmin] ℹ️ Owner already registered`);
        return { success: true, owner: userId };
      }
      // If endpoint doesn't exist (404), Freebird needs to be updated
      if (error instanceof Error && error.message.includes('404')) {
        console.log(`[FreebirdAdmin] ℹ️ Owner registration not available (update Freebird)`);
        return { success: false, owner: '' };
      }
      throw error;
    }
  }
}

/**
 * Create a FreebirdAdmin instance from environment variables
 */
export function createFreebirdAdminFromEnv(): FreebirdAdmin | null {
  const issuerUrl = process.env.FREEBIRD_ISSUER_URL || 'http://localhost:8081';
  const adminKey = process.env.FREEBIRD_ADMIN_KEY;

  if (!adminKey) {
    console.warn('[FreebirdAdmin] No FREEBIRD_ADMIN_KEY set, admin features disabled');
    return null;
  }

  return new FreebirdAdmin({ issuerUrl, adminKey });
}
