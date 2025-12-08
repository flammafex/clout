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
import { apiCall } from './api.js';
import { $, showLoading, showResult, escapeHtml, getWeightLabel } from './ui.js';
import { loadFeed } from './feed.js';

/**
 * Load and display trusted users list
 */
export async function loadTrustedUsers() {
  showLoading('trusted-users-list');
  try {
    const data = await apiCall('/trusted');
    const container = $('trusted-users-list');
    const countBadge = $('trust-count-badge');

    countBadge.textContent = data.count || 0;

    if (!data.users || data.users.length === 0) {
      container.innerHTML = `
        <div class="empty-state-helpful">
          <div class="empty-icon">&#x1F331;</div>
          <h4>Your trust circle is empty</h4>
          <p>Start by trusting someone you know. Their posts will appear in your feed, and you'll see posts from people they trust too.</p>
        </div>
      `;
      return;
    }

    // Dark Social Graph: Load private data from IndexedDB
    let localNicknames = new Map();
    let localMuted = new Set();
    let localTags = {};
    if (window.CloutUserData) {
      localNicknames = await window.CloutUserData.getAllNicknames();
      const mutedList = await window.CloutUserData.getMutedUsers();
      localMuted = new Set(mutedList);
      localTags = await window.CloutUserData.getAllTagsWithUsers();
    }

    container.innerHTML = data.users.map(user => {
      const localNickname = localNicknames.get(user.publicKey);
      const nickname = localNickname || user.nickname;
      const isMuted = localMuted.has(user.publicKey);

      // Get tags for this user
      const userTags = [];
      for (const [tag, users] of Object.entries(localTags)) {
        if (users.includes(user.publicKey)) {
          userTags.push(tag);
        }
      }
      const tags = userTags.length > 0 ? userTags : (user.tags || []);
      const tagsHtml = tags.length > 0
        ? `<div class="user-tags">${tags.map(t => `<span class="tag-badge-small">${escapeHtml(t)}</span>`).join('')}</div>`
        : '';
      const hasNickname = !!nickname;
      const displayName = user.displayName || nickname || user.publicKeyShort + '...';
      const isSelf = user.isSelf || false;
      const weight = user.weight ?? 1.0;
      const weightLabel = getWeightLabel(weight);
      const weightClass = weight >= 0.9 ? 'weight-full' : weight >= 0.5 ? 'weight-medium' : 'weight-low';

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
        ? `<button class="btn-small btn-unmute" onclick="window.cloutApp.unmuteUser('${user.publicKey}')" title="Unredact">&#x1F50A;</button>`
        : `<button class="btn-small btn-mute" onclick="window.cloutApp.muteUser('${user.publicKey}', '${escapeHtml(displayName)}')" title="Redact">&#x1F507;</button>`;

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
            <button class="btn-small btn-nickname" onclick="window.cloutApp.editNickname('${user.publicKey}', '${escapeHtml(nickname || '')}')" title="Set nickname">&#x270F;&#xFE0F;</button>
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

    await apiCall('/trust', 'POST', { publicKey, weight });

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
    await apiCall('/trust', 'POST', { publicKey });

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
