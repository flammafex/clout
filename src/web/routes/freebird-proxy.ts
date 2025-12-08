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
import type { FreebirdAdapter } from '../../integrations/freebird.js';

export interface FreebirdProxyConfig {
  /** Get the FreebirdAdapter instance */
  getFreebirdAdapter: () => FreebirdAdapter | undefined;
  /** Check if the server is initialized */
  isInitialized: () => boolean;
}

/**
 * Create Freebird proxy routes
 */
export function createFreebirdProxyRoutes(config: FreebirdProxyConfig): Router {
  const { getFreebirdAdapter, isInitialized } = config;
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

      const { blinded_element_b64, invitation_code } = req.body;

      if (!blinded_element_b64 || typeof blinded_element_b64 !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'blinded_element_b64 is required'
        });
      }

      // Set invitation code if provided
      if (invitation_code && typeof invitation_code === 'string') {
        adapter.setInvitationCode(invitation_code);
      }

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

      // Issue the token via Freebird
      const tokenBytes = await adapter.issueToken(blindedBytes);

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
