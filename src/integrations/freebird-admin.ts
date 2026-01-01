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

export interface FreebirdUser {
  user_id: string;
  invited_by?: string;
  invite_quota: number;
  invites_used: number;
  is_banned: boolean;
  created_at: string;
  invitees?: string[];
}

export interface FreebirdInvitationDetails {
  code: string;
  inviter_id: string;
  invitee_id: string | null;
  created_at: number;
  expires_at: number;
  redeemed: boolean;
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
   * @param freebirdUserId The Freebird user_id (invitee_id generated during invitation redemption)
   * @param count Number of invitations to grant
   */
  async grantInvitationQuota(freebirdUserId: string, count: number): Promise<void> {
    await this.request('/admin/invites/grant', 'POST', {
      user_id: freebirdUserId,
      count
    });
  }

  /**
   * Get invitation details by code
   *
   * Used to look up the Freebird invitee_id from an invitation code.
   * This enables the flow: Clout publicKey → invitation code → Freebird invitee_id
   *
   * @param code The invitation code
   * @returns Invitation details including invitee_id, or null if not found
   */
  async getInvitationByCode(code: string): Promise<FreebirdInvitationDetails | null> {
    try {
      return await this.request<FreebirdInvitationDetails>(`/admin/invitations/${encodeURIComponent(code)}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * List all invitations
   * Returns null if the request fails (to distinguish from "no invitations")
   */
  async listInvitations(): Promise<Invitation[] | null> {
    try {
      const response = await this.request<{ invitations: Invitation[] }>('/admin/invitations');
      return response.invitations || [];
    } catch (error) {
      // If endpoint doesn't exist or fails, return null to indicate failure
      if (error instanceof Error && error.message.includes('404')) {
        console.log(`[FreebirdAdmin] ℹ️ List invitations not available`);
      } else {
        console.warn(`[FreebirdAdmin] Failed to list invitations: ${error}`);
      }
      return null;
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
   * Ban a user from the network
   *
   * @param userId User's public key to ban
   * @param banTree If true, also ban all users invited by this user (default: false)
   * @returns Success status and number of users banned
   */
  async banUser(userId: string, banTree: boolean = false): Promise<{ success: boolean; banned_count: number }> {
    console.log(`[FreebirdAdmin] 🚫 Banning user: ${userId.substring(0, 16)}... (tree: ${banTree})`);

    const response = await this.request<{ success: boolean; banned_count: number }>(
      '/admin/users/ban',
      'POST',
      { user_id: userId, ban_tree: banTree }
    );

    console.log(`[FreebirdAdmin] ✅ Banned ${response.banned_count} user(s)`);
    return response;
  }

  /**
   * List all users (paginated)
   *
   * @param limit Max users to return (default: 100)
   * @param offset Offset for pagination (default: 0)
   */
  async listUsers(limit: number = 100, offset: number = 0): Promise<FreebirdUser[]> {
    const response = await this.request<{ users: FreebirdUser[] }>(
      `/admin/users?limit=${limit}&offset=${offset}`
    );
    return response.users || [];
  }

  /**
   * Get details for a specific user
   *
   * @param userId User's public key
   */
  async getUser(userId: string): Promise<FreebirdUser | null> {
    try {
      return await this.request<FreebirdUser>(`/admin/users/${userId}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        return null;
      }
      throw error;
    }
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
