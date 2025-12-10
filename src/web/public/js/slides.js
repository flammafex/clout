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
    for (const slide of data.slides) {
      try {
        // Decrypt the message
        const ephemeralPublicKey = Crypto.fromHex(slide.ephemeralPublicKey);
        const ciphertext = Crypto.fromHex(slide.ciphertext);
        const decrypted = Crypto.decrypt(ephemeralPublicKey, ciphertext, x25519PrivKey, x25519PubKey);

        decryptedSlides.push({
          ...slide,
          decryptedContent: decrypted,
          senderNickname: nicknames.get(slide.sender) || null
        });
      } catch (decryptError) {
        console.warn('[Slides] Failed to decrypt slide from', slide.sender?.slice(0, 12), ':', decryptError.message);
        decryptedSlides.push({
          ...slide,
          decryptedContent: '[Unable to decrypt]',
          senderNickname: nicknames.get(slide.sender) || null
        });
      }
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
