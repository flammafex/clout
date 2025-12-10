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
import { $, showLoading, showResult, escapeHtml, getWeightLabel } from './ui.js';
import { loadFeed } from './feed.js';

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
    const trustedKeys = await window.CloutUserData.getTrustedUsers();
    const localNicknames = await window.CloutUserData.getAllNicknames();
    const mutedList = await window.CloutUserData.getMutedUsers();
    const localMuted = new Set(mutedList);
    const localTags = await window.CloutUserData.getAllTagsWithUsers();

    // Self entry - you trust yourself above all
    const myKey = identity.publicKeyHex;
    const myProfile = await window.CloutUserData.getProfile(myKey);

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

    // Add trusted users (excluding self)
    for (const publicKey of trustedKeys) {
      if (publicKey === myKey) continue;

      const localNickname = localNicknames.get(publicKey);
      const profile = await window.CloutUserData.getProfile(publicKey);
      const isMuted = localMuted.has(publicKey);
      const trustData = await window.CloutUserData.getTrustData(publicKey);
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
