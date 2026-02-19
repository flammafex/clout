/**
 * Freebird Proxy Routes
 *
 * Proxies VOPRF requests from the browser to the Freebird issuer.
 * This is necessary because Freebird doesn't enable CORS headers,
 * so browsers can't make direct requests to it.
 *
 * The browser does all the blinding/unblinding locally, so the server
 * never sees the original value - only the blinded element.
 *
 * Flow:
 * 1. Browser calls blind() locally to create blinded element
 * 2. Browser sends blinded element to /freebird/proxy/issue
 * 3. Server forwards to Freebird issuer
 * 4. Server returns token + issuer public key to browser
 * 5. Browser calls finalize() locally to verify and unblind
 */

import { Router } from 'express';
import type { Request } from 'express';
import { Crypto } from '../../crypto.js';
import type { FreebirdAdapter, FreebirdSybilProof } from '../../integrations/freebird.js';
import { getBrowserUserPublicKey, validateSignature } from './validation.js';

export interface FreebirdProxyConfig {
  /** Get the FreebirdAdapter instance */
  getFreebirdAdapter: () => FreebirdAdapter | undefined;
  /** Check if the server is initialized */
  isInitialized: () => boolean;
  /**
   * Check if a user is registered with Freebird (can renew Day Pass without invitation)
   * Returns true if the user has previously redeemed an invitation
   */
  isUserRegistered?: (publicKey: string) => Promise<boolean>;
  /**
   * Mark a user as registered with Freebird
   * Called after successful token issuance
   */
  setUserRegistered?: (publicKey: string, registered: boolean) => Promise<void>;
  /**
   * Resolve invitation signature for a reserved invitation claim.
   * Must only return a signature for the same (code, publicKey) claim.
   */
  getReservedInvitationSignature?: (code: string, publicKey: string) => Promise<string | null>;
  /** Get instance owner public key for privileged federation mutation routes */
  getOwnerPublicKey?: () => string | undefined;
}

const FEDERATION_ADMIN_SIGNATURE_WINDOW_MS = 5 * 60 * 1000;

function verifyOwnerFederationMutation(
  req: Request,
  operation: string,
  ownerPublicKey: string | undefined
): { ok: true } | { ok: false; error: string } {
  const publicKey = getBrowserUserPublicKey(req);
  if (!publicKey || !ownerPublicKey || publicKey !== ownerPublicKey) {
    return { ok: false, error: 'Only the instance owner can perform this operation' };
  }

  const signatureHex = req.body?.adminSignature || req.headers['x-admin-signature'];
  const timestampRaw = req.body?.adminTimestamp || req.headers['x-admin-timestamp'];
  if (!signatureHex || typeof signatureHex !== 'string') {
    return { ok: false, error: 'Missing admin signature' };
  }

  const timestamp = parseInt(String(timestampRaw), 10);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, error: 'Missing or invalid admin timestamp' };
  }

  if (Math.abs(Date.now() - timestamp) > FEDERATION_ADMIN_SIGNATURE_WINDOW_MS) {
    return { ok: false, error: 'Admin signature timestamp is outside the allowed window' };
  }

  try {
    const payload = `admin:${operation}:${publicKey}:${timestamp}`;
    const payloadBytes = new TextEncoder().encode(payload);
    const signatureBytes = validateSignature(signatureHex, 'adminSignature');
    const publicKeyBytes = Crypto.fromHex(publicKey);
    if (!Crypto.verify(payloadBytes, signatureBytes, publicKeyBytes)) {
      return { ok: false, error: 'Invalid admin signature' };
    }
  } catch (error: any) {
    return { ok: false, error: `Admin signature verification failed: ${error.message}` };
  }

  return { ok: true };
}

/**
 * Create Freebird proxy routes
 */
export function createFreebirdProxyRoutes(config: FreebirdProxyConfig): Router {
  const {
    getFreebirdAdapter,
    isInitialized,
    isUserRegistered,
    setUserRegistered,
    getReservedInvitationSignature,
    getOwnerPublicKey
  } = config;
  const router = Router();

  /**
   * GET /freebird/issuer-info
   *
   * Returns information about the Freebird issuer, including
   * the public key needed for DLEQ proof verification.
   */
  router.get('/issuer-info', async (_req, res) => {
    try {
      if (!isInitialized()) {
        return res.status(503).json({
          success: false,
          error: 'Server not initialized'
        });
      }

      const adapter = getFreebirdAdapter();
      if (!adapter) {
        return res.status(503).json({
          success: false,
          error: 'Freebird not configured'
        });
      }

      // Get issuer metadata
      const metadata = await adapter.getIssuerMetadata();

      if (!metadata) {
        return res.status(503).json({
          success: false,
          error: 'Freebird issuer not available'
        });
      }

      res.json({
        success: true,
        data: {
          issuer_id: metadata.issuer_id,
          pubkey: metadata.voprf?.pubkey,
          epoch: metadata.epoch,
          sybil_mode: metadata.sybil?.mode || 'unknown'
        }
      });
    } catch (error: any) {
      console.error('[FreebirdProxy] Error getting issuer info:', error.message);
      res.status(500).json({
        success: false,
        error: 'Failed to get issuer info'
      });
    }
  });

  /**
   * POST /freebird/proxy/issue
   *
   * Proxies a VOPRF token issuance request to Freebird.
   *
   * Request body:
   * - blinded_element_b64: Base64url encoded blinded element
   * - invitation_code?: Optional invitation code for sybil resistance
   * - user_public_key?: User's public key (for registered user mode)
   *
   * Response:
   * - token: Base64url encoded VOPRF token
   * - issuer_pubkey: Base64url encoded issuer public key (for verification)
   */
  router.post('/proxy/issue', async (req, res) => {
    try {
      if (!isInitialized()) {
        return res.status(503).json({
          success: false,
          error: 'Server not initialized'
        });
      }

      const adapter = getFreebirdAdapter();
      if (!adapter) {
        return res.status(503).json({
          success: false,
          error: 'Freebird not configured'
        });
      }

      const { blinded_element_b64, invitation_code, user_public_key } = req.body;

      if (!blinded_element_b64 || typeof blinded_element_b64 !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'blinded_element_b64 is required'
        });
      }

      const currentMode = adapter.getSybilMode();

      // Convert base64url to bytes
      const blindedBytes = base64UrlToBytes(blinded_element_b64);

      // Get issuer metadata for public key
      const metadata = await adapter.getIssuerMetadata();
      if (!metadata || !metadata.voprf?.pubkey) {
        return res.status(503).json({
          success: false,
          error: 'Freebird issuer not available or missing public key'
        });
      }

      let sybilProof: FreebirdSybilProof | undefined;

      // Request-scoped proof selection to avoid global adapter state mutation.
      if (invitation_code && typeof invitation_code === 'string') {
        if (!user_public_key || typeof user_public_key !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'user_public_key is required when invitation_code is provided'
          });
        }
        if (!getReservedInvitationSignature) {
          return res.status(500).json({
            success: false,
            error: 'Invitation signature resolver is not configured'
          });
        }
        const signature = await getReservedInvitationSignature(invitation_code, user_public_key);
        if (!signature) {
          return res.status(401).json({
            success: false,
            error: 'Invitation code not reserved for this user or signature unavailable',
            code: 'INVITATION_REQUIRED'
          });
        }
        sybilProof = {
          type: 'invitation',
          code: invitation_code,
          signature
        };
      } else if (user_public_key && isUserRegistered && currentMode === 'invitation') {
        const registered = await isUserRegistered(user_public_key);
        if (registered) {
          console.log(`[FreebirdProxy] User ${user_public_key.slice(0, 8)}... is registered, using registered mode`);
          sybilProof = {
            type: 'registered_user',
            user_id: user_public_key
          };
        }
      }

      // Issue the token via Freebird
      const tokenBytes = sybilProof
        ? await adapter.issueTokenWithSybilProof(blindedBytes, sybilProof)
        : await adapter.issueToken(blindedBytes);

      // Registration is finalized only after successful /daypass/mint.
      // Do not mark users as registered at token issuance time.

      // Convert to base64url
      const token_b64 = bytesToBase64Url(tokenBytes);

      res.json({
        success: true,
        data: {
          token: token_b64,
          issuer_pubkey: metadata.voprf.pubkey
        }
      });
    } catch (error: any) {
      console.error('[FreebirdProxy] Error issuing token:', error.message);

      // Handle specific error cases
      if (error.message.includes('Invitation')) {
        return res.status(401).json({
          success: false,
          error: error.message,
          code: 'INVITATION_REQUIRED'
        });
      }

      if (error.message.includes('Threshold')) {
        return res.status(503).json({
          success: false,
          error: 'Freebird network unavailable (threshold not met)',
          code: 'THRESHOLD_NOT_MET'
        });
      }

      res.status(500).json({
        success: false,
        error: 'Failed to issue token'
      });
    }
  });

  /**
   * POST /freebird/proxy/verify
   *
   * Proxies a token verification request to Freebird.
   * This is optional - the browser can verify locally using DLEQ.
   */
  router.post('/proxy/verify', async (req, res) => {
    try {
      if (!isInitialized()) {
        return res.status(503).json({
          success: false,
          error: 'Server not initialized'
        });
      }

      const adapter = getFreebirdAdapter();
      if (!adapter) {
        return res.status(503).json({
          success: false,
          error: 'Freebird not configured'
        });
      }

      const { token_b64 } = req.body;

      if (!token_b64 || typeof token_b64 !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'token_b64 is required'
        });
      }

      // Convert base64url to bytes
      const tokenBytes = base64UrlToBytes(token_b64);

      // Verify the token
      const isValid = await adapter.verifyToken(tokenBytes);

      res.json({
        success: true,
        data: {
          valid: isValid
        }
      });
    } catch (error: any) {
      console.error('[FreebirdProxy] Error verifying token:', error.message);
      res.status(500).json({
        success: false,
        error: 'Failed to verify token'
      });
    }
  });

  /**
   * GET /freebird/federation/export-token
   *
   * Exports a user's VOPRF token in the FederatedToken format.
   * This allows users to take their token to another community
   * that trusts this issuer via federated trust.
   *
   * Query params:
   * - token_b64: Base64url encoded VOPRF token (required)
   * - expires_at: Token expiry timestamp in seconds (required)
   * - issued_at: Token issued timestamp in seconds (optional, defaults to now)
   * - community_name: Name of this community (optional, uses instance name)
   *
   * Response:
   * - federated_token: Portable token with issuer metadata
   */
  router.get('/federation/export-token', async (req, res) => {
    try {
      if (!isInitialized()) {
        return res.status(503).json({
          success: false,
          error: 'Server not initialized'
        });
      }

      const adapter = getFreebirdAdapter();
      if (!adapter) {
        return res.status(503).json({
          success: false,
          error: 'Freebird not configured'
        });
      }

      const { token_b64, expires_at, issued_at, community_name } = req.query;

      // Validate required parameters
      if (!token_b64 || typeof token_b64 !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'token_b64 query parameter is required'
        });
      }

      if (!expires_at || typeof expires_at !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'expires_at query parameter is required (unix timestamp in seconds)'
        });
      }

      const expiresAtNum = parseInt(expires_at, 10);
      if (isNaN(expiresAtNum)) {
        return res.status(400).json({
          success: false,
          error: 'expires_at must be a valid unix timestamp'
        });
      }

      // Check if token is expired
      const now = Math.floor(Date.now() / 1000);
      if (expiresAtNum <= now) {
        return res.status(400).json({
          success: false,
          error: 'Cannot export an expired token'
        });
      }

      // Get issuer metadata to include issuer_id
      const metadata = await adapter.getIssuerMetadata();
      if (!metadata || !metadata.issuer_id) {
        return res.status(503).json({
          success: false,
          error: 'Freebird issuer not available'
        });
      }

      // Parse optional issued_at or default to now
      const issuedAtNum = issued_at && typeof issued_at === 'string'
        ? parseInt(issued_at, 10)
        : now;

      // Use provided community name or fall back to instance name
      const communityNameStr = community_name && typeof community_name === 'string'
        ? community_name
        : process.env.INSTANCE_NAME || undefined;

      // Convert token from base64url to bytes for validation
      const tokenBytes = base64UrlToBytes(token_b64);

      // Build the federated token response
      const federatedToken = {
        source_issuer_id: metadata.issuer_id,
        token_b64: token_b64,  // Keep as base64url for portability
        expires_at: expiresAtNum,
        issued_at: issuedAtNum,
        community_name: communityNameStr,
        // Include issuer public key for verification at destination
        issuer_pubkey: metadata.voprf?.pubkey
      };

      console.log(`[FreebirdProxy] Exported federated token for issuer ${metadata.issuer_id}`);

      res.json({
        success: true,
        data: {
          federated_token: federatedToken,
          // Instructions for using this token
          usage: {
            description: 'Present this token to a community that trusts this issuer',
            set_mode: 'Set sybil_mode to "federated_trust" when requesting a token',
            import_endpoint: '/freebird/federation/import-token'
          }
        }
      });
    } catch (error: any) {
      console.error('[FreebirdProxy] Error exporting federated token:', error.message);
      res.status(500).json({
        success: false,
        error: 'Failed to export federated token'
      });
    }
  });

  /**
   * POST /freebird/federation/import-token
   *
   * Imports a federated token from another community for use with
   * this issuer's federated_trust mode.
   *
   * This validates the token format and stores it in the adapter
   * for use in subsequent token issuance requests.
   *
   * Request body:
   * - federated_token: The federated token object from export
   *   - source_issuer_id: string
   *   - token_b64: string
   *   - expires_at: number
   *   - issued_at: number
   *   - community_name?: string
   *
   * Response:
   * - imported: true on success
   * - can_issue: whether this issuer accepts tokens from the source
   */
  router.post('/federation/import-token', async (req, res) => {
    try {
      if (!isInitialized()) {
        return res.status(503).json({
          success: false,
          error: 'Server not initialized'
        });
      }

      const authz = verifyOwnerFederationMutation(req, 'federation/import-token', getOwnerPublicKey?.());
      if (!authz.ok) {
        return res.status(403).json({
          success: false,
          error: authz.error
        });
      }

      const adapter = getFreebirdAdapter();
      if (!adapter) {
        return res.status(503).json({
          success: false,
          error: 'Freebird not configured'
        });
      }

      const { federated_token } = req.body;

      if (!federated_token || typeof federated_token !== 'object') {
        return res.status(400).json({
          success: false,
          error: 'federated_token object is required in request body'
        });
      }

      const { source_issuer_id, token_b64, expires_at, issued_at, community_name } = federated_token;

      // Validate required fields
      if (!source_issuer_id || typeof source_issuer_id !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'federated_token.source_issuer_id is required'
        });
      }

      if (!token_b64 || typeof token_b64 !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'federated_token.token_b64 is required'
        });
      }

      if (!expires_at || typeof expires_at !== 'number') {
        return res.status(400).json({
          success: false,
          error: 'federated_token.expires_at is required (unix timestamp)'
        });
      }

      // Check if token is expired
      const now = Math.floor(Date.now() / 1000);
      if (expires_at <= now) {
        return res.status(400).json({
          success: false,
          error: 'Federated token has expired'
        });
      }

      // Convert token to bytes
      const tokenBytes = base64UrlToBytes(token_b64);

      // Import the federated token into the adapter
      // The adapter will use this for federated_trust mode
      adapter.setFederatedToken({
        sourceIssuerId: source_issuer_id,
        token: tokenBytes,
        expiresAt: expires_at,
        issuedAt: issued_at || now,
        communityName: community_name
      });

      // Check if this issuer is in federated_trust mode and accepts this source
      // For now, we just import - the actual trust check happens during issuance
      const currentMode = adapter.getSybilMode();

      console.log(`[FreebirdProxy] Imported federated token from ${source_issuer_id} (community: ${community_name || 'unknown'})`);

      res.json({
        success: true,
        data: {
          imported: true,
          source_issuer_id,
          community_name: community_name || null,
          expires_at,
          current_mode: currentMode,
          can_issue: currentMode === 'federated_trust' || currentMode === 'none',
          hint: currentMode !== 'federated_trust'
            ? 'Set sybil_mode to federated_trust to use this token for issuance'
            : 'Token ready for federated trust issuance'
        }
      });
    } catch (error: any) {
      console.error('[FreebirdProxy] Error importing federated token:', error.message);

      // Check for specific error types
      if (error.message.includes('expired')) {
        return res.status(400).json({
          success: false,
          error: error.message
        });
      }

      res.status(500).json({
        success: false,
        error: 'Failed to import federated token'
      });
    }
  });

  /**
   * GET /freebird/federation/status
   *
   * Returns the current federation status including:
   * - Whether federated trust is enabled
   * - Currently imported federated token (if any)
   * - This issuer's ID for export purposes
   */
  router.get('/federation/status', async (req, res) => {
    try {
      if (!isInitialized()) {
        return res.status(503).json({
          success: false,
          error: 'Server not initialized'
        });
      }

      const adapter = getFreebirdAdapter();
      if (!adapter) {
        return res.status(503).json({
          success: false,
          error: 'Freebird not configured'
        });
      }

      const metadata = await adapter.getIssuerMetadata();
      const currentMode = adapter.getSybilMode();
      const hasFederatedToken = adapter.hasFederatedToken();
      const federatedToken = adapter.getFederatedToken();

      res.json({
        success: true,
        data: {
          this_issuer: {
            issuer_id: metadata?.issuer_id || null,
            community_name: process.env.INSTANCE_NAME || null
          },
          federation: {
            mode_enabled: currentMode === 'federated_trust',
            current_sybil_mode: currentMode,
            has_imported_token: hasFederatedToken,
            imported_token: hasFederatedToken && federatedToken ? {
              source_issuer_id: federatedToken.sourceIssuerId,
              community_name: federatedToken.communityName || null,
              expires_at: federatedToken.expiresAt,
              is_valid: federatedToken.expiresAt > Math.floor(Date.now() / 1000)
            } : null
          }
        }
      });
    } catch (error: any) {
      console.error('[FreebirdProxy] Error getting federation status:', error.message);
      res.status(500).json({
        success: false,
        error: 'Failed to get federation status'
      });
    }
  });

  return router;
}

// ============================================================================
// Helpers
// ============================================================================

function base64UrlToBytes(base64: string): Uint8Array {
  const binString = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binString, (m) => m.codePointAt(0)!);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
