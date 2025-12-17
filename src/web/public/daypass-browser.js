/**
 * Browser-side Day Pass Flow
 *
 * Handles the complete privacy-preserving token issuance flow:
 * 1. Blind public key locally (server cannot see original)
 * 2. Request token via server proxy to Freebird
 * 3. Verify token locally using DLEQ proof
 * 4. Exchange verified token for a Day Pass
 *
 * The server never sees the unblinded value - only the blinded
 * request and the final token. This preserves user privacy.
 */

import * as VOPRF from './voprf-browser.js';
import { Crypto } from './crypto-browser.js';

/**
 * Request a Day Pass for the current user.
 *
 * This is the main entry point for new users who need to post.
 * It handles the full VOPRF blinding flow automatically.
 *
 * For registered users (those who have previously redeemed an invitation),
 * no invitation code is needed - the backend will use registered mode.
 *
 * @param {Uint8Array} publicKeyBytes - User's Ed25519 public key (32 bytes)
 * @param {Object} options - Optional configuration
 * @param {string} options.invitationCode - Invitation code for sybil resistance (optional for registered users)
 * @param {string} options.apiBase - API base URL (default: '')
 * @returns {Promise<Object>} Day Pass info: { publicKey, expiry, durationHours }
 */
export async function requestDayPass(publicKeyBytes, options = {}) {
  const { invitationCode, apiBase = '' } = options;
  const publicKeyHex = Crypto.toHex(publicKeyBytes);

  console.log('[DayPass] Starting privacy-preserving token flow...');

  // Step 1: Blind the public key locally
  console.log('[DayPass] Blinding public key locally...');
  const { blinded, blindedB64 } = VOPRF.blind(publicKeyBytes);

  // Step 2: Request token via server proxy
  // Send user_public_key so backend can check if user is registered (for Day Pass renewal)
  console.log('[DayPass] Requesting token from Freebird (via proxy)...');
  const issueResponse = await fetch(`${apiBase}/api/freebird/proxy/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blinded_element_b64: blindedB64,
      invitation_code: invitationCode,
      user_public_key: publicKeyHex
    })
  });

  if (!issueResponse.ok) {
    const error = await issueResponse.json();
    if (error.code === 'INVITATION_REQUIRED') {
      throw new Error('Invitation code required. Please obtain an invitation from an existing user.');
    }
    if (error.code === 'THRESHOLD_NOT_MET') {
      throw new Error('Freebird network unavailable. Please try again later.');
    }
    throw new Error(error.error || 'Failed to request token');
  }

  const { data: issueData } = await issueResponse.json();
  const { token: tokenB64, issuer_pubkey: issuerPubkeyB64 } = issueData;

  // Step 3: Verify the token locally using DLEQ proof
  console.log('[DayPass] Verifying token locally...');
  let tokenBytes;
  try {
    tokenBytes = VOPRF.finalize(blinded, tokenB64, issuerPubkeyB64);
    console.log('[DayPass] Token verified successfully');
  } catch (error) {
    console.error('[DayPass] Token verification failed:', error);
    // Clean up blind state on error
    VOPRF.clearBlindState(blinded);
    throw new Error('Token verification failed: ' + error.message);
  }

  // Step 4: Exchange token for Day Pass
  console.log('[DayPass] Minting Day Pass...');
  const mintResponse = await fetch(`${apiBase}/api/daypass/mint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: publicKeyHex,
      token: tokenB64  // Already base64url encoded
    })
  });

  if (!mintResponse.ok) {
    const error = await mintResponse.json();
    throw new Error(error.error || 'Failed to mint Day Pass');
  }

  const { data: dayPass } = await mintResponse.json();
  console.log('[DayPass] Day Pass obtained successfully!');
  console.log(`[DayPass] Expires: ${new Date(dayPass.expiry).toLocaleString()}`);

  return dayPass;
}

/**
 * Check the current Day Pass status for a user.
 *
 * @param {string} publicKeyHex - User's public key (hex string)
 * @param {Object} options - Optional configuration
 * @param {string} options.apiBase - API base URL (default: '')
 * @returns {Promise<Object>} Status info: { hasTicket, isExpired, expiry, remainingHours }
 */
export async function getDayPassStatus(publicKeyHex, options = {}) {
  const { apiBase = '' } = options;

  const response = await fetch(`${apiBase}/api/daypass/status/${publicKeyHex}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to check Day Pass status');
  }

  const { data } = await response.json();
  return data;
}

/**
 * Check if a Day Pass is valid and not expired.
 *
 * @param {string} publicKeyHex - User's public key (hex string)
 * @param {Object} options - Optional configuration
 * @returns {Promise<boolean>} True if Day Pass is valid
 */
export async function hasDayPass(publicKeyHex, options = {}) {
  try {
    const status = await getDayPassStatus(publicKeyHex, options);
    return status.hasTicket && !status.isExpired;
  } catch {
    return false;
  }
}

/**
 * Get Freebird issuer information.
 * Useful for debugging or displaying issuer status to users.
 *
 * @param {Object} options - Optional configuration
 * @param {string} options.apiBase - API base URL (default: '')
 * @returns {Promise<Object>} Issuer info: { issuer_id, pubkey, sybil_mode }
 */
export async function getIssuerInfo(options = {}) {
  const { apiBase = '' } = options;

  const response = await fetch(`${apiBase}/api/freebird/issuer-info`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get issuer info');
  }

  const { data } = await response.json();
  return data;
}

// Export for use as ES module
export default {
  requestDayPass,
  getDayPassStatus,
  hasDayPass,
  getIssuerInfo
};
