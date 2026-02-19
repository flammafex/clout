/**
 * API Module - HTTP communication layer
 *
 * Handles all API calls to the Clout server.
 * Supports both unsigned (legacy) and signed (browser-identity) requests.
 */

export const API_BASE = '/api';

/**
 * Make an API call to the Clout server
 * @param {string} endpoint - API endpoint (e.g., '/feed')
 * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
 * @param {object} body - Request body for POST/PUT
 * @param {object} extraHeaders - Additional request headers
 * @returns {Promise<any>} Response data
 */
export async function apiCall(endpoint, method = 'GET', body = null, extraHeaders = {}) {
  try {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...extraHeaders
      }
    };

    // Include browser user's public key for authenticated requests (admin routes)
    // This allows the server to identify which browser user is making the request
    if (window.userPublicKey) {
      options.headers['X-User-PublicKey'] = window.userPublicKey;
    }

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${API_BASE}${endpoint}`, options);
    const data = await response.json();

    if (!data.success) {
      const error = new Error(data.error || 'Request failed');
      error.code = data.code;
      throw error;
    }

    return data.data;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

/**
 * Get the current browser identity
 * @returns {Promise<Object|null>} Identity with privateKey, publicKey, publicKeyHex
 */
export async function getBrowserIdentity() {
  if (!window.CloutIdentity) {
    console.warn('[API] CloutIdentity not available');
    return null;
  }
  return await window.CloutIdentity.load();
}

/**
 * Ensure user has a valid Day Pass for posting
 * @param {Object} identity - Browser identity
 * @param {string} invitationCode - Optional invitation code for new users
 * @returns {Promise<Object>} Day Pass status
 */
export async function ensureDayPass(identity, invitationCode = null) {
  if (!window.CloutDayPass) {
    throw new Error('Day Pass module not loaded');
  }

  // Check current status
  const status = await window.CloutDayPass.getDayPassStatus(identity.publicKeyHex);

  if (status.hasTicket && !status.isExpired) {
    return status;
  }

  // Need to obtain a new Day Pass
  console.log('[API] No valid Day Pass, requesting new one...');
  const dayPass = await window.CloutDayPass.requestDayPass(identity.publicKey, {
    invitationCode
  });

  return {
    hasTicket: true,
    isExpired: false,
    expiry: dayPass.expiry,
    remainingMs: dayPass.expiry - Date.now()
  };
}

/**
 * Submit a signed post using browser identity
 * @param {string} content - Post content
 * @param {Object} options - Post options (replyTo, mediaCid, link, nsfw, contentWarning)
 * @returns {Promise<Object>} Post result
 */
export async function submitSignedPost(content, options = {}) {
  const identity = await getBrowserIdentity();
  if (!identity) {
    throw new Error('No browser identity found. Please create an identity first.');
  }

  // Ensure we have a valid Day Pass
  await ensureDayPass(identity);

  // Sign the post with browser's private key
  const Crypto = window.CloutCrypto;
  if (!Crypto) {
    throw new Error('Crypto module not loaded');
  }

  const signedPost = Crypto.signPost(content, identity.privateKey, {
    replyTo: options.replyTo,
    mediaCid: options.mediaCid,
    link: options.link,
    nsfw: options.nsfw,
    contentWarning: options.contentWarning
  });

  // Get browser user's profile for displayName and avatar
  let authorDisplayName = null;
  let authorAvatar = null;
  if (window.CloutUserData) {
    try {
      const myProfile = await window.CloutUserData.getProfile(identity.publicKeyHex);
      if (myProfile) {
        authorDisplayName = myProfile.displayName || null;
        authorAvatar = myProfile.avatar || null;
      }
    } catch (e) {
      console.warn('[API] Failed to load profile for post:', e.message);
    }
  }

  // Submit to the signature-verified endpoint with profile info
  const response = await fetch(`${API_BASE}/post/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...signedPost,
      authorDisplayName,
      authorAvatar
    })
  });

  const data = await response.json();

  if (!data.success) {
    const error = new Error(data.error || 'Post submission failed');
    error.code = data.code;
    throw error;
  }

  return data.data;
}

/**
 * Submit a signed trust signal using browser identity
 * @param {string} trusteePublicKey - Public key of user to trust (hex)
 * @param {number} weight - Trust weight (0.1 to 1.0)
 * @returns {Promise<Object>} Trust result
 */
export async function submitSignedTrust(trusteePublicKey, weight = 1.0) {
  const identity = await getBrowserIdentity();
  if (!identity) {
    throw new Error('No browser identity found. Please create an identity first.');
  }

  const Crypto = window.CloutCrypto;
  if (!Crypto) {
    throw new Error('Crypto module not loaded');
  }

  const timestamp = Date.now();

  // Create encrypted trust signal (Dark Social Graph - server can't see who we trust)
  const encryptedSignal = Crypto.createEncryptedTrustSignal(
    identity.privateKey,
    identity.publicKeyHex,
    trusteePublicKey,
    weight,
    timestamp
  );

  // Build submission payload
  const payload = {
    truster: identity.publicKeyHex,
    trusteeCommitment: encryptedSignal.trusteeCommitment,
    encryptedTrustee: {
      ephemeralPublicKey: Crypto.toHex(encryptedSignal.encryptedTrustee.ephemeralPublicKey),
      ciphertext: Crypto.toHex(encryptedSignal.encryptedTrustee.ciphertext)
    },
    signature: Crypto.toHex(encryptedSignal.signature),
    weight,
    timestamp
  };

  // Submit to the signature-verified endpoint
  const response = await fetch(`${API_BASE}/trust/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!data.success) {
    const error = new Error(data.error || 'Trust submission failed');
    error.code = data.code;
    throw error;
  }

  return data.data;
}

/**
 * Upload media file to server
 * @param {File} file - File to upload
 * @param {function} onProgress - Progress callback
 * @returns {Promise<object>} Upload result { cid, mimeType, filename, size }
 */
export async function uploadMediaFile(file) {
  const buffer = await file.arrayBuffer();

  const response = await fetch(`${API_BASE}/media/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type,
      'X-Filename': file.name
    },
    body: buffer
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Upload failed');
  }

  return data.data;
}
