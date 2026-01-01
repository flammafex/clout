/**
 * Trust Module - Trust list management
 *
 * Handles:
 * - Loading and displaying trusted users
 * - Adding/removing trust
 * - Nickname management
 * - Redact functionality
 * - Quick trust from feed
 */

import * as state from './state.js';
import { apiCall, submitSignedTrust } from './api.js';
import { $, showLoading, showResult, escapeHtml, getWeightLabel, renderAvatar } from './ui.js';
import { loadFeed } from './feed.js';
import { sendTrustAcceptanceSlide } from './slides.js';

// Helper to invalidate trust cache after mutations
function invalidateTrustCacheAfterMutation() {
  state.invalidateTrustCache();
}

/**
 * Load and display trusted users list from browser's Dark Social Graph (IndexedDB)
 */
export async function loadTrustedUsers() {
  showLoading('trusted-users-list');
  try {
    const container = $('trusted-users-list');
    const countBadge = $('trust-count-badge');

    // Get browser identity
    if (!window.CloutIdentity || !window.CloutUserData) {
      container.innerHTML = `
        <div class="empty-state-helpful">
          <div class="empty-icon">⚠️</div>
          <h4>Browser storage not available</h4>
          <p>Your trust circle is stored locally in your browser. Please ensure JavaScript is enabled.</p>
        </div>
      `;
      return;
    }

    const identity = await window.CloutIdentity.load();
    if (!identity) {
      container.innerHTML = `
        <div class="empty-state-helpful">
          <div class="empty-icon">🔑</div>
          <h4>No identity found</h4>
          <p>Create or import an identity to start building your trust circle.</p>
        </div>
      `;
      countBadge.textContent = '0';
      return;
    }

    // Load trust data from IndexedDB (browser-local Dark Social Graph)
    // Fetch all base data in parallel
    const myKey = identity.publicKeyHex;
    const [trustedKeys, localNicknames, mutedList, localTags, myProfile] = await Promise.all([
      window.CloutUserData.getTrustedUsers(),
      window.CloutUserData.getAllNicknames(),
      window.CloutUserData.getMutedUsers(),
      window.CloutUserData.getAllTagsWithUsers(),
      window.CloutUserData.getProfile(myKey)
    ]);
    const localMuted = new Set(mutedList);

    const users = [];

    // Add self first
    users.push({
      publicKey: myKey,
      publicKeyShort: myKey.slice(0, 12),
      displayName: myProfile?.displayName || 'You',
      nickname: null,
      tags: [],
      isMuted: false,
      isSelf: true,
      weight: 1.0
    });

    // Filter out self from trusted keys
    const otherTrustedKeys = trustedKeys.filter(k => k !== myKey);

    // Fetch all profiles and trust data in parallel (fixes N+1 query problem)
    const [profiles, trustDataList] = await Promise.all([
      Promise.all(otherTrustedKeys.map(k => window.CloutUserData.getProfile(k))),
      Promise.all(otherTrustedKeys.map(k => window.CloutUserData.getTrustData(k)))
    ]);

    // Build user objects from parallel-fetched data
    for (let i = 0; i < otherTrustedKeys.length; i++) {
      const publicKey = otherTrustedKeys[i];
      const localNickname = localNicknames.get(publicKey);
      const profile = profiles[i];
      const isMuted = localMuted.has(publicKey);
      const trustData = trustDataList[i];
      const weight = trustData?.weight ?? 1.0;

      // Get tags for this user
      const userTags = [];
      for (const [tag, tagUsers] of Object.entries(localTags)) {
        if (tagUsers.includes(publicKey)) {
          userTags.push(tag);
        }
      }

      users.push({
        publicKey,
        publicKeyShort: publicKey.slice(0, 12),
        displayName: profile?.displayName || localNickname || publicKey.slice(0, 12) + '...',
        nickname: localNickname || null,
        tags: userTags,
        isMuted,
        isSelf: false,
        weight
      });
    }

    countBadge.textContent = users.length || 0;

    if (users.length === 0) {
      container.innerHTML = `
        <div class="empty-state-helpful">
          <div class="empty-icon">🌱</div>
          <h4>Your trust circle is empty</h4>
          <p>Start by trusting someone you know. Their posts will appear in your feed, and you'll see posts from people they trust too.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = users.map(user => {
      const nickname = user.nickname;
      const tagsHtml = user.tags.length > 0
        ? `<div class="user-tags">${user.tags.map(t => `<span class="tag-badge-small">${escapeHtml(t)}</span>`).join('')}</div>`
        : '';
      const hasNickname = !!nickname;
      const displayName = user.displayName;
      const isSelf = user.isSelf || false;
      const weight = user.weight ?? 1.0;
      const weightLabel = getWeightLabel(weight);
      const weightClass = weight >= 0.9 ? 'weight-full' : weight >= 0.5 ? 'weight-medium' : 'weight-low';
      const isMuted = user.isMuted;

      if (isSelf) {
        return `
          <div class="trusted-user-card self-card">
            <div class="trusted-user-info">
              <div class="trusted-user-name" title="${user.publicKey}">
                ${escapeHtml(displayName)}
                <span class="self-badge">You</span>
              </div>
              <div class="trusted-user-key-small">${user.publicKeyShort}...</div>
            </div>
            <div class="trusted-user-actions">
              <button class="btn-small" onclick="window.cloutApp.copyToClipboard('${user.publicKey}')">Copy</button>
            </div>
          </div>
        `;
      }

      const muteBtn = isMuted
        ? `<button class="btn-small btn-unmute" onclick="window.cloutApp.unmuteUser('${user.publicKey}')" title="Unredact">🔊</button>`
        : `<button class="btn-small btn-mute" onclick="window.cloutApp.muteUser('${user.publicKey}', '${escapeHtml(displayName)}')" title="Redact">🔇</button>`;

      const weightBadge = weight < 1.0
        ? `<span class="weight-badge ${weightClass}" title="${weightLabel}">${weight.toFixed(1)}</span>`
        : '';

      return `
        <div class="trusted-user-card ${isMuted ? 'muted' : ''}">
          <div class="trusted-user-info">
            <div class="trusted-user-name ${hasNickname ? 'has-nickname' : ''} ${isMuted ? 'muted-name' : ''}" title="${user.publicKey}">
              ${escapeHtml(displayName)}
              ${weightBadge}
              ${isMuted ? '<span class="muted-badge">redacted</span>' : ''}
            </div>
            <div class="trusted-user-key-small">${user.publicKeyShort}...</div>
            ${tagsHtml}
          </div>
          <div class="trusted-user-actions">
            <button class="btn-small btn-untrust" onclick="window.cloutApp.untrustUser('${user.publicKey}', '${escapeHtml(displayName)}')" title="Remove from trust circle">✕</button>
            ${muteBtn}
            <button class="btn-small btn-nickname" onclick="window.cloutApp.editNickname('${user.publicKey}', '${escapeHtml(nickname || '')}')" title="Set nickname">✏️</button>
            <button class="btn-small" onclick="window.cloutApp.copyToClipboard('${user.publicKey}')">Copy</button>
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Error loading trusted users:', error);
    $('trusted-users-list').innerHTML = `<p class="empty-state">Error loading trust circle</p>`;
  }
}

/**
 * Trust a user
 */
export async function trustUser(requireMembership) {
  if (!requireMembership()) return;

  const publicKey = $('trust-public-key').value.trim();

  if (!publicKey) {
    showResult('trust-result', 'Please enter a public key', false);
    return;
  }

  const weightSlider = $('trust-weight');
  const weight = weightSlider ? parseInt(weightSlider.value, 10) / 100 : 1.0;

  try {
    $('trust-btn').disabled = true;
    $('trust-btn').textContent = 'Adding...';

    // Use browser-side signing for secure trust signal
    await submitSignedTrust(publicKey, weight);

    // Also store locally in Dark Social Graph (IndexedDB)
    if (window.CloutUserData) {
      console.log('[App] Saving trust to IndexedDB:', publicKey.slice(0, 12), 'weight:', weight);
      await window.CloutUserData.trust(publicKey, weight);
      console.log('[App] Trust saved to IndexedDB');
      invalidateTrustCacheAfterMutation();
    }

    const weightLabel = getWeightLabel(weight);
    showResult('trust-result', `Added ${publicKey.slice(0, 8)}... with ${weightLabel} (${weight.toFixed(1)})`, true);
    $('trust-public-key').value = '';

    if (weightSlider) {
      weightSlider.value = 100;
      updateTrustWeightDisplay();
    }

    await loadTrustedUsers();
  } catch (error) {
    showResult('trust-result', `Error: ${error.message}`, false);
  } finally {
    $('trust-btn').disabled = false;
    $('trust-btn').textContent = 'Trust';
  }
}

/**
 * Quick trust a user from feed
 */
export async function quickTrust(publicKey, requireMembership) {
  if (!requireMembership()) return;

  try {
    // Use browser-side signing for secure trust signal
    await submitSignedTrust(publicKey, 1.0);

    // Also store locally in Dark Social Graph (IndexedDB)
    if (window.CloutUserData) {
      console.log('[App] Saving trust to IndexedDB:', publicKey.slice(0, 12));
      await window.CloutUserData.trust(publicKey, 1.0);
      console.log('[App] Trust saved to IndexedDB');
      invalidateTrustCacheAfterMutation();
    }

    showResult('feed-list', `Added ${publicKey.slice(0, 8)}... to your trust circle!`, true);
    setTimeout(() => loadFeed(), 1000);
  } catch (error) {
    alert(`Could not trust user: ${error.message}`);
  }
}

/**
 * Redact a user (hide their posts from your feed)
 */
export async function muteUser(publicKey, displayName, requireMembership) {
  if (!requireMembership()) return;

  if (!confirm(`Redact ${displayName || publicKey.slice(0, 8)}...?\n\nTheir posts will be hidden from your feed. You can unredact them anytime from the Trust tab.`)) {
    return;
  }

  try {
    if (window.CloutUserData) {
      await window.CloutUserData.mute(publicKey);
    }
    showResult('feed-list', `Redacted ${displayName || publicKey.slice(0, 8)}...`, true);
    setTimeout(() => loadFeed(), 500);
  } catch (error) {
    alert(`Could not redact user: ${error.message}`);
  }
}

/**
 * Unredact a user (show their posts in your feed again)
 */
export async function unmuteUser(publicKey) {
  try {
    if (window.CloutUserData) {
      await window.CloutUserData.unmute(publicKey);
    }
    await loadTrustedUsers();
    showResult('trust-result', `Unredacted ${publicKey.slice(0, 8)}...`, true);
  } catch (error) {
    alert(`Could not unredact user: ${error.message}`);
  }
}

/**
 * Revoke trust from a user (remove from trust circle)
 */
export async function untrustUser(publicKey, displayName) {
  if (!confirm(`Remove ${displayName || publicKey.slice(0, 8)}... from your trust circle?\n\nTheir posts will no longer appear in your feed.`)) {
    return;
  }

  try {
    // Remove from local IndexedDB first
    if (window.CloutUserData) {
      await window.CloutUserData.untrust(publicKey);
      invalidateTrustCacheAfterMutation();
    }

    // Send revocation signal via API (for gossip propagation)
    await apiCall(`/trust/${publicKey}`, 'DELETE');

    showResult('trust-result', `Removed ${publicKey.slice(0, 8)}... from trust circle`, true);
    await loadTrustedUsers();
    await loadFeed();
  } catch (error) {
    alert(`Could not remove user: ${error.message}`);
  }
}

/**
 * Edit nickname for a user
 */
export async function editNickname(publicKey, currentNickname) {
  const newNickname = prompt(
    `Set a nickname for ${publicKey.slice(0, 12)}...`,
    currentNickname || ''
  );

  if (newNickname === null) return;

  try {
    if (window.CloutUserData) {
      await window.CloutUserData.setNickname(publicKey, newNickname.trim());
      invalidateTrustCacheAfterMutation();
    }

    await loadTrustedUsers();
    await loadFeed();

    if (newNickname.trim()) {
      showResult('trust-result', `Nickname set: "${newNickname.trim()}"`, true);
    } else {
      showResult('trust-result', 'Nickname removed', true);
    }
  } catch (error) {
    showResult('trust-result', `Error: ${error.message}`, false);
  }
}

/**
 * Update trust weight display
 */
export function updateTrustWeightDisplay() {
  const slider = $('trust-weight');
  const valueDisplay = $('trust-weight-value');
  const labelDisplay = $('trust-weight-label');

  if (!slider || !valueDisplay) return;

  const weight = parseInt(slider.value, 10) / 100;
  valueDisplay.textContent = weight.toFixed(1);

  if (labelDisplay) {
    labelDisplay.textContent = getWeightLabel(weight);
  }
}

// =========================================================================
//  TRUST REQUESTS (Consent-based trust)
// =========================================================================

const GHOST_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Load and display trust requests (incoming and outgoing)
 */
export async function loadTrustRequests() {
  if (!window.CloutUserData) return;

  try {
    const [incoming, outgoing] = await Promise.all([
      window.CloutUserData.getIncomingTrustRequests(false),
      window.CloutUserData.getOutgoingTrustRequests()
    ]);

    // Update incoming requests UI
    const incomingContainer = $('incoming-requests-list');
    const incomingBadge = $('incoming-requests-badge');

    if (incomingContainer) {
      if (incoming.length === 0) {
        incomingContainer.innerHTML = `
          <div class="empty-state-small">
            <span>No pending requests</span>
          </div>
        `;
      } else {
        incomingContainer.innerHTML = incoming.map(req => renderIncomingRequest(req)).join('');
      }
    }

    if (incomingBadge) {
      incomingBadge.textContent = incoming.length;
      incomingBadge.style.display = incoming.length > 0 ? 'inline' : 'none';
    }

    // Update outgoing requests UI
    const outgoingContainer = $('outgoing-requests-list');
    if (outgoingContainer) {
      const pendingOutgoing = outgoing.filter(r => r.status === 'pending' || r.status === 'ghosted');

      if (pendingOutgoing.length === 0) {
        outgoingContainer.innerHTML = `
          <div class="empty-state-small">
            <span>No pending requests</span>
          </div>
        `;
      } else {
        outgoingContainer.innerHTML = pendingOutgoing.map(req => renderOutgoingRequest(req)).join('');
      }
    }
  } catch (error) {
    console.error('Error loading trust requests:', error);
  }
}

/**
 * Render an incoming trust request card
 */
function renderIncomingRequest(request) {
  const timeAgo = formatTimeAgo(request.createdAt);
  const requesterShort = request.requester.slice(0, 12);
  const displayName = request.requesterDisplayName || requesterShort + '...';
  const avatarHtml = renderAvatar(request.requesterAvatar);

  return `
    <div class="trust-request-card incoming">
      <div class="trust-request-avatar">${avatarHtml}</div>
      <div class="trust-request-info">
        <div class="trust-request-name" title="${escapeHtml(request.requester)}">
          ${escapeHtml(displayName)}
        </div>
        <div class="trust-request-key">${requesterShort}...</div>
        <div class="trust-request-meta">
          <span class="trust-request-time">${timeAgo}</span>
          ${request.message ? `<span class="trust-request-message">"${escapeHtml(request.message)}"</span>` : ''}
        </div>
      </div>
      <div class="trust-request-actions">
        <button class="btn-small btn-accept" onclick="window.cloutApp.acceptTrustRequest('${escapeHtml(request.id)}')" title="Accept">✓</button>
        <button class="btn-small btn-reject" onclick="window.cloutApp.rejectTrustRequest('${escapeHtml(request.id)}')" title="Reject">✕</button>
      </div>
    </div>
  `;
}

/**
 * Render an outgoing trust request card
 */
function renderOutgoingRequest(request) {
  const timeAgo = formatTimeAgo(request.createdAt);
  const recipientShort = request.recipient.slice(0, 12);
  const isGhosted = request.status === 'ghosted';
  const canRetry = isGhosted && request.retryCount < 1;

  return `
    <div class="trust-request-card outgoing ${isGhosted ? 'ghosted' : ''}">
      <div class="trust-request-info">
        <div class="trust-request-name" title="${escapeHtml(request.recipient)}">
          ${escapeHtml(request.recipientDisplayName || recipientShort + '...')}
          ${isGhosted ? '<span class="ghost-badge">no response</span>' : '<span class="pending-badge">pending</span>'}
        </div>
        <div class="trust-request-meta">
          <span class="trust-request-time">${timeAgo}</span>
        </div>
      </div>
      <div class="trust-request-actions">
        ${canRetry ? `<button class="btn-small btn-retry" onclick="window.cloutApp.retryTrustRequest('${escapeHtml(request.id)}')" title="Retry">↻</button>` : ''}
        <button class="btn-small btn-withdraw" onclick="window.cloutApp.withdrawTrustRequest('${escapeHtml(request.id)}')" title="Withdraw">✕</button>
      </div>
    </div>
  `;
}

/**
 * Format timestamp as relative time
 */
function formatTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

/**
 * Send a trust request (instead of immediate trust)
 * Sends the request as an encrypted slide for E2E privacy in transit
 */
export async function sendTrustRequest(requireMembership) {
  if (!requireMembership()) return;

  const publicKey = $('trust-public-key').value.trim();

  if (!publicKey) {
    showResult('trust-result', 'Please enter a public key', false);
    return;
  }

  if (!window.CloutUserData || !window.CloutIdentity || !window.CloutCrypto) {
    showResult('trust-result', 'Browser crypto not available', false);
    return;
  }

  const identity = await window.CloutIdentity.load();
  if (!identity) {
    showResult('trust-result', 'No browser identity found', false);
    return;
  }

  // Check if already trusted
  const isTrusted = await window.CloutUserData.isTrusted(publicKey);
  if (isTrusted) {
    showResult('trust-result', 'Already in your trust circle', false);
    return;
  }

  // Check if request already exists
  const existingRequest = await window.CloutUserData.hasOutgoingRequestTo(publicKey);
  if (existingRequest) {
    showResult('trust-result', 'Request already sent', false);
    return;
  }

  // Check pending limit
  const pendingCount = await window.CloutUserData.getPendingOutgoingCount();
  if (pendingCount >= 20) {
    showResult('trust-result', 'Maximum pending requests reached (20)', false);
    return;
  }

  // Check if blocked from requesting
  const isBlocked = await window.CloutUserData.isBlockedFromRequesting(publicKey);
  if (isBlocked) {
    showResult('trust-result', 'Cannot send request to this user', false);
    return;
  }

  const weightSlider = $('trust-weight');
  const weight = weightSlider ? parseInt(weightSlider.value, 10) / 100 : 1.0;

  try {
    $('trust-btn').disabled = true;
    $('trust-btn').textContent = 'Encrypting...';

    // Get requester profile info
    const myProfile = await window.CloutUserData.getProfile(identity.publicKeyHex);
    const timestamp = Date.now();
    const requestId = `${identity.publicKeyHex}-${publicKey}-${timestamp}`;

    // Create the trust request payload (will be E2E encrypted)
    const trustRequestPayload = {
      type: 'trust-request',
      version: 1,
      id: requestId,
      requester: identity.publicKeyHex,
      requesterDisplayName: myProfile?.displayName || null,
      requesterAvatar: myProfile?.avatar || null,
      weight,
      message: null,  // Optional message could be added later
      timestamp
    };

    // Create local request record
    await window.CloutUserData.createTrustRequest(publicKey, weight);

    $('trust-btn').textContent = 'Sending...';

    // Send as encrypted slide (E2E encrypted in transit)
    await sendTrustRequestSlide(identity, publicKey, trustRequestPayload);

    showResult('trust-result', `Request sent to ${publicKey.slice(0, 8)}... (encrypted)`, true);
    $('trust-public-key').value = '';

    if (weightSlider) {
      weightSlider.value = 100;
      updateTrustWeightDisplay();
    }

    await loadTrustRequests();
  } catch (error) {
    showResult('trust-result', `Error: ${error.message}`, false);
  } finally {
    $('trust-btn').disabled = false;
    $('trust-btn').textContent = 'Request Trust';
  }
}

/**
 * Send a trust request as an encrypted slide
 */
async function sendTrustRequestSlide(identity, recipientKey, payload) {
  const Crypto = window.CloutCrypto;

  // Convert Ed25519 keys to X25519 for encryption
  const recipientX25519 = Crypto.ed25519ToX25519(recipientKey);

  // Encrypt the trust request payload as JSON
  const message = JSON.stringify(payload);
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

  // Sign the slide (encode as bytes for ed25519)
  const signaturePayload = `slide:${slideData.sender}:${slideData.recipient}:${timestamp}`;
  const signatureBytes = new TextEncoder().encode(signaturePayload);
  slideData.signature = Crypto.toHex(Crypto.sign(signatureBytes, identity.privateKey));

  // Submit to server for gossip propagation
  await apiCall('/slide/submit', 'POST', slideData);

  console.log('[Trust] Trust request sent as encrypted slide to', recipientKey.slice(0, 12));
}

/**
 * Accept an incoming trust request
 * Sends an encrypted acceptance slide back to the requester
 */
export async function acceptTrustRequest(requestId) {
  if (!window.CloutUserData) return;

  try {
    // Get the request to find the requester
    const incoming = await window.CloutUserData.getIncomingTrustRequests(true);
    const request = incoming.find(r => r.id === requestId);

    if (!request) {
      alert('Request not found');
      return;
    }

    // Accept locally
    await window.CloutUserData.acceptTrustRequest(requestId);

    // Add to trust circle
    await submitSignedTrust(request.requester, request.weight || 1.0);
    await window.CloutUserData.trust(request.requester, request.weight || 1.0);
    invalidateTrustCacheAfterMutation();

    // Send encrypted acceptance slide back to requester
    await sendTrustAcceptanceSlide(request.requester, requestId);

    showResult('trust-result', `Accepted ${request.requester.slice(0, 8)}...`, true);

    await loadTrustRequests();
    await loadTrustedUsers();
  } catch (error) {
    alert(`Error accepting request: ${error.message}`);
  }
}

/**
 * Reject an incoming trust request (silently)
 */
export async function rejectTrustRequest(requestId) {
  if (!window.CloutUserData) return;

  try {
    await window.CloutUserData.rejectTrustRequest(requestId);
    await apiCall(`/trust-request/${requestId}/reject`, 'POST');

    await loadTrustRequests();
  } catch (error) {
    alert(`Error rejecting request: ${error.message}`);
  }
}

/**
 * Withdraw an outgoing trust request
 */
export async function withdrawTrustRequest(requestId) {
  if (!window.CloutUserData) return;

  if (!confirm('Withdraw this trust request?')) return;

  try {
    await window.CloutUserData.withdrawTrustRequest(requestId);
    await apiCall(`/trust-request/${requestId}`, 'DELETE');

    showResult('trust-result', 'Request withdrawn', true);
    await loadTrustRequests();
  } catch (error) {
    alert(`Error withdrawing request: ${error.message}`);
  }
}

/**
 * Retry a ghosted trust request
 * Re-sends the encrypted slide
 */
export async function retryTrustRequest(requestId) {
  if (!window.CloutUserData || !window.CloutIdentity || !window.CloutCrypto) return;

  try {
    const identity = await window.CloutIdentity.load();
    if (!identity) {
      alert('No browser identity found');
      return;
    }

    // Get the request details
    const outgoing = await window.CloutUserData.getOutgoingTrustRequests();
    const request = outgoing.find(r => r.id === requestId);

    if (!request) {
      alert('Request not found');
      return;
    }

    // Update local status
    await window.CloutUserData.retryTrustRequest(requestId);

    // Get requester profile info
    const myProfile = await window.CloutUserData.getProfile(identity.publicKeyHex);
    const timestamp = Date.now();
    const newRequestId = `${identity.publicKeyHex}-${request.recipient}-${timestamp}`;

    // Create the trust request payload (will be E2E encrypted)
    const trustRequestPayload = {
      type: 'trust-request',
      version: 1,
      id: newRequestId,
      requester: identity.publicKeyHex,
      requesterDisplayName: myProfile?.displayName || null,
      requesterAvatar: myProfile?.avatar || null,
      weight: request.weight,
      message: request.message || null,
      timestamp,
      isRetry: true
    };

    // Re-send as encrypted slide
    await sendTrustRequestSlide(identity, request.recipient, trustRequestPayload);

    showResult('trust-result', 'Request sent again (encrypted)', true);
    await loadTrustRequests();
  } catch (error) {
    alert(`Error retrying request: ${error.message}`);
  }
}
