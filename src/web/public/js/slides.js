/**
 * Slides Module - Encrypted DMs
 *
 * Handles:
 * - Sending encrypted slides
 * - Loading and displaying slides
 * - Slide replies
 */

import * as state from './state.js';
import { apiCall } from './api.js';
import { $, showLoading, showResult, escapeHtml, formatRelativeTime } from './ui.js';

/**
 * Send an encrypted slide using browser identity
 */
export async function sendSlide(requireMembership) {
  if (!requireMembership()) return;

  // Check for browser identity
  if (!window.CloutIdentity || !window.CloutCrypto) {
    showResult('slide-result', 'Browser crypto not available', false);
    return;
  }

  const identity = await window.CloutIdentity.load();
  if (!identity) {
    showResult('slide-result', 'No browser identity found. Create one first.', false);
    return;
  }

  const recipientKey = $('slide-recipient').value.trim();
  const message = $('slide-message').value.trim();

  if (!recipientKey || !message) {
    showResult('slide-result', 'Please enter recipient key and message', false);
    return;
  }

  // Validate recipient key
  if (recipientKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(recipientKey)) {
    showResult('slide-result', 'Invalid recipient key: must be 64 hex characters', false);
    return;
  }

  try {
    $('send-slide-btn').disabled = true;
    $('send-slide-btn').textContent = 'Encrypting...';

    const Crypto = window.CloutCrypto;

    // Convert Ed25519 keys to X25519 for encryption
    const recipientX25519 = Crypto.ed25519ToX25519(recipientKey);
    const senderX25519Priv = Crypto.ed25519PrivToX25519(identity.privateKey);

    // Encrypt the message
    const encrypted = Crypto.encrypt(message, recipientX25519);

    // Create slide package
    const timestamp = Date.now();
    const slideData = {
      sender: identity.publicKeyHex,
      recipient: recipientKey,
      ephemeralPublicKey: Crypto.toHex(encrypted.ephemeralPublicKey),
      ciphertext: Crypto.toHex(encrypted.ciphertext),
      timestamp
    };

    // Sign the slide
    const signaturePayload = `slide:${slideData.sender}:${slideData.recipient}:${timestamp}`;
    slideData.signature = Crypto.toHex(Crypto.sign(signaturePayload, identity.privateKey));

    $('send-slide-btn').textContent = 'Sending...';

    // Submit to server
    await apiCall('/slide/submit', 'POST', slideData);

    showResult('slide-result', 'Slide sent! (end-to-end encrypted with your identity)', true);
    $('slide-recipient').value = '';
    $('slide-message').value = '';
    $('slide-char-count').textContent = '0';

    await loadSlides();
  } catch (error) {
    showResult('slide-result', `Error: ${error.message}`, false);
  } finally {
    $('send-slide-btn').disabled = false;
    $('send-slide-btn').textContent = 'Send Encrypted Slide';
  }
}

/**
 * Load slides addressed to the browser identity
 */
export async function loadSlides() {
  showLoading('slides-list');
  try {
    const slidesList = $('slides-list');

    // Check for browser identity
    if (!window.CloutIdentity || !window.CloutCrypto) {
      slidesList.innerHTML = `
        <div class="empty-state-helpful">
          <div class="empty-icon">⚠️</div>
          <h4>Browser crypto not available</h4>
          <p>Slides require browser crypto support.</p>
        </div>
      `;
      return;
    }

    const identity = await window.CloutIdentity.load();
    if (!identity) {
      slidesList.innerHTML = `
        <div class="empty-state-helpful">
          <div class="empty-icon">🔑</div>
          <h4>No identity found</h4>
          <p>Create or import an identity to receive encrypted messages.</p>
        </div>
      `;
      updateSlidesBadge(0);
      return;
    }

    // Request slides for this browser's public key
    const data = await apiCall(`/slides/${identity.publicKeyHex}`);

    if (window.CloutUserData) {
      await window.CloutUserData.markSeen('slides');
    }

    updateSlidesBadge(data.slides?.length || 0);

    if (!data.slides || data.slides.length === 0) {
      slidesList.innerHTML = `
        <div class="empty-state-helpful">
          <div class="empty-icon">📬</div>
          <h4>No messages yet</h4>
          <p>Send an encrypted slide to someone in your trust circle</p>
        </div>
      `;
      return;
    }

    // Decrypt slides with browser's private key
    const Crypto = window.CloutCrypto;
    const x25519PrivKey = Crypto.ed25519PrivToX25519(identity.privateKey);
    const x25519PubKey = Crypto.ed25519ToX25519(identity.publicKeyHex);

    // Get nicknames for display
    let nicknames = new Map();
    if (window.CloutUserData) {
      nicknames = await window.CloutUserData.getAllNicknames();
    }

    const decryptedSlides = [];
    const trustRequests = [];  // Collect trust requests to process separately
    const trustResponses = []; // Collect trust request responses

    for (const slide of data.slides) {
      try {
        // Decrypt the message
        const ephemeralPublicKey = Crypto.fromHex(slide.ephemeralPublicKey);
        const ciphertext = Crypto.fromHex(slide.ciphertext);
        const decrypted = Crypto.decrypt(ephemeralPublicKey, ciphertext, x25519PrivKey, x25519PubKey);

        // Check if this is a special message type (JSON with type field)
        let isSpecialMessage = false;
        try {
          const parsed = JSON.parse(decrypted);
          if (parsed.type === 'trust-request') {
            // This is an incoming trust request
            trustRequests.push({ ...parsed, slideId: slide.id });
            isSpecialMessage = true;
            console.log('[Slides] Received trust request from', parsed.requester?.slice(0, 12));
          } else if (parsed.type === 'trust-request-accepted') {
            // Our trust request was accepted
            trustResponses.push({ ...parsed, slideId: slide.id });
            isSpecialMessage = true;
            console.log('[Slides] Trust request accepted by', parsed.accepter?.slice(0, 12));
          }
        } catch (e) {
          // Not JSON, just a regular message
        }

        // Only add to slides list if it's a regular message
        if (!isSpecialMessage) {
          decryptedSlides.push({
            ...slide,
            decryptedContent: decrypted,
            senderNickname: nicknames.get(slide.sender) || null
          });
        }
      } catch (decryptError) {
        console.warn('[Slides] Failed to decrypt slide from', slide.sender?.slice(0, 12), ':', decryptError.message);
        decryptedSlides.push({
          ...slide,
          decryptedContent: '[Unable to decrypt]',
          senderNickname: nicknames.get(slide.sender) || null
        });
      }
    }

    // Process any trust requests received
    if (trustRequests.length > 0 && window.CloutUserData) {
      await processTrustRequestSlides(trustRequests);
    }

    // Process any trust request acceptances
    if (trustResponses.length > 0 && window.CloutUserData) {
      await processTrustResponseSlides(trustResponses);
    }

    slidesList.innerHTML = decryptedSlides.map(slide => {
      const senderNickname = slide.senderNickname;
      const senderName = senderNickname || (slide.sender ? slide.sender.slice(0, 16) + '...' : 'Unknown');
      const hasNickname = !!senderNickname;
      return `
        <div class="slide-item">
          <div class="slide-header">
            <div class="slide-sender">From: <span class="${hasNickname ? 'has-nickname' : ''}" title="${slide.sender || ''}">${escapeHtml(senderName)}</span></div>
            <div class="slide-timestamp">${formatRelativeTime(slide.timestamp)}</div>
          </div>
          <div class="slide-message">${escapeHtml(slide.decryptedContent || '')}</div>
          <button class="btn btn-small" onclick="window.cloutApp.startSlideReply('${slide.sender || ''}')">Reply</button>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('[Slides] Error loading:', error);
    $('slides-list').innerHTML = `<p class="empty-state">Error loading slides: ${error.message}</p>`;
  }
}

/**
 * Update slides notification badge
 */
export function updateSlidesBadge(count) {
  const badge = $('slides-badge');
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

/**
 * Start slide reply
 */
export function startSlideReply(recipientKey) {
  $('slide-recipient').value = recipientKey;
  $('slide-message').focus();
}

/**
 * Process incoming trust request slides
 * Store them as incoming trust requests in IndexedDB
 */
async function processTrustRequestSlides(trustRequests) {
  for (const request of trustRequests) {
    try {
      // Check if we already have this request
      const existing = await window.CloutUserData.getIncomingTrustRequests(true);
      const alreadyExists = existing.some(r => r.id === request.id);

      if (!alreadyExists) {
        // Store as incoming trust request
        await window.CloutUserData.storeIncomingTrustRequest({
          id: request.id,
          requester: request.requester,
          requesterDisplayName: request.requesterDisplayName,
          requesterAvatar: request.requesterAvatar,
          recipient: window.browserIdentity?.publicKeyHex,
          weight: request.weight,
          status: 'pending',
          createdAt: request.timestamp,
          updatedAt: request.timestamp,
          message: request.message || null,
          slideId: request.slideId
        });

        console.log('[Slides] Stored incoming trust request from', request.requester?.slice(0, 12));
      }
    } catch (error) {
      console.error('[Slides] Error processing trust request:', error);
    }
  }
}

/**
 * Process trust request acceptance slides
 * Update our outgoing request status
 */
async function processTrustResponseSlides(responses) {
  for (const response of responses) {
    try {
      if (response.type === 'trust-request-accepted') {
        // Update our outgoing request to accepted
        await window.CloutUserData.updateOutgoingRequestStatus(response.accepter, 'accepted');
        console.log('[Slides] Our trust request was accepted by', response.accepter?.slice(0, 12));
      }
    } catch (error) {
      console.error('[Slides] Error processing trust response:', error);
    }
  }
}

/**
 * Send an acceptance slide when accepting a trust request
 */
export async function sendTrustAcceptanceSlide(requesterKey, requestId) {
  if (!window.CloutIdentity || !window.CloutCrypto) {
    console.warn('[Slides] Cannot send acceptance slide - crypto not available');
    return;
  }

  const identity = await window.CloutIdentity.load();
  if (!identity) {
    console.warn('[Slides] Cannot send acceptance slide - no identity');
    return;
  }

  const Crypto = window.CloutCrypto;

  // Get our profile info
  let myProfile = null;
  if (window.CloutUserData) {
    myProfile = await window.CloutUserData.getProfile(identity.publicKeyHex);
  }

  // Create acceptance payload
  const acceptancePayload = {
    type: 'trust-request-accepted',
    version: 1,
    requestId,
    accepter: identity.publicKeyHex,
    accepterDisplayName: myProfile?.displayName || null,
    accepterAvatar: myProfile?.avatar || null,
    timestamp: Date.now()
  };

  // Convert Ed25519 keys to X25519 for encryption
  const recipientX25519 = Crypto.ed25519ToX25519(requesterKey);

  // Encrypt the acceptance payload as JSON
  const message = JSON.stringify(acceptancePayload);
  const encrypted = Crypto.encrypt(message, recipientX25519);

  // Create slide package
  const timestamp = Date.now();
  const slideData = {
    sender: identity.publicKeyHex,
    recipient: requesterKey,
    ephemeralPublicKey: Crypto.toHex(encrypted.ephemeralPublicKey),
    ciphertext: Crypto.toHex(encrypted.ciphertext),
    timestamp
  };

  // Sign the slide
  const signaturePayload = `slide:${slideData.sender}:${slideData.recipient}:${timestamp}`;
  slideData.signature = Crypto.toHex(Crypto.sign(signaturePayload, identity.privateKey));

  // Submit to server for gossip propagation
  try {
    const response = await fetch('/api/slide/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slideData)
    });
    if (!response.ok) throw new Error('Failed to send acceptance slide');
    console.log('[Slides] Trust acceptance slide sent to', requesterKey.slice(0, 12));
  } catch (error) {
    console.error('[Slides] Error sending acceptance slide:', error);
  }
}
