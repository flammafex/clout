/**
 * Profile Module - Identity and profile management
 *
 * Handles:
 * - Identity loading and display
 * - Profile editing
 * - QR code generation
 * - Stats loading
 * - Data export/import
 * - Settings management
 */

import * as state from './state.js';
import { apiCall } from './api.js';
import { $, showLoading, showResult, escapeHtml, formatRelativeTime, renderAvatar } from './ui.js';
import { loadFeed } from './feed.js';

// =========================================================================
// Identity & Profile
// =========================================================================

/**
 * Load identity information
 */
export async function loadIdentity() {
  try {
    const data = await apiCall('/identity');

    $('identity-public-key').textContent = data.publicKey;
    $('identity-created').textContent = formatRelativeTime(data.created);

    window.userPublicKey = data.publicKey;

    // Ensure self is trusted in IndexedDB
    if (window.CloutUserData && data.publicKey) {
      const isSelfTrusted = await window.CloutUserData.isTrusted(data.publicKey);
      if (!isSelfTrusted) {
        console.log('[Identity] Adding self to IndexedDB trust graph');
        await window.CloutUserData.trust(data.publicKey, 1.0);
      }
    }
  } catch (error) {
    console.error('Error loading identity:', error);
  }
}

/**
 * Load profile
 */
export async function loadProfile() {
  try {
    const data = await apiCall('/identity');
    const profile = data;

    $('profile-name-display').textContent = profile.metadata?.displayName || '(No name set)';
    $('profile-bio-display').textContent = profile.metadata?.bio || '';
    $('profile-avatar-display').innerHTML = renderAvatar(profile.metadata?.avatar);
    $('identity-public-key').textContent = profile.publicKey;

    if (profile.metadata?.bio) {
      $('profile-bio-display').style.display = 'block';
    } else {
      $('profile-bio-display').style.display = 'none';
    }
  } catch (error) {
    console.error('Failed to load profile:', error);
  }
}

/**
 * Show profile edit form
 */
export function showProfileEdit() {
  apiCall('/identity').then(data => {
    const profile = data;
    $('profile-name').value = profile.metadata?.displayName || '';
    $('profile-bio').value = profile.metadata?.bio || '';
    $('profile-avatar').value = profile.metadata?.avatar || '';
    $('bio-char-count').textContent = ($('profile-bio').value || '').length;
  });

  $('profile-view').style.display = 'none';
  $('profile-edit').style.display = 'block';
  $('profile-result').style.display = 'none';
}

/**
 * Cancel profile edit
 */
export function cancelProfileEdit() {
  $('profile-view').style.display = 'block';
  $('profile-edit').style.display = 'none';
  $('profile-result').style.display = 'none';
}

/**
 * Save profile
 */
export async function saveProfile(requireMembership) {
  if (!requireMembership()) return;

  const displayName = $('profile-name').value.trim();
  const bio = $('profile-bio').value.trim();
  const avatar = $('profile-avatar').value.trim();

  try {
    $('save-profile-btn').disabled = true;
    $('save-profile-btn').textContent = 'Saving...';

    await apiCall('/profile', 'POST', { displayName, bio, avatar });

    showResult('profile-result', 'Profile updated! Changes will sync to peers automatically.', true);

    await loadProfile();

    setTimeout(() => {
      cancelProfileEdit();
    }, 1500);
  } catch (error) {
    showResult('profile-result', `Error: ${error.message}`, false);
  } finally {
    $('save-profile-btn').disabled = false;
    $('save-profile-btn').textContent = 'Save Profile';
  }
}

/**
 * Toggle QR code display
 */
export function toggleQRCode() {
  const container = $('qr-code-container');
  const isHidden = container.style.display === 'none';

  if (isHidden) {
    container.style.display = 'block';

    if (!state.qrCodeGenerated && window.userPublicKey) {
      const qrContainer = $('qr-code');
      qrContainer.innerHTML = '';

      new QRCode(qrContainer, {
        text: window.userPublicKey,
        width: 256,
        height: 256,
        colorDark: '#f1f5f9',
        colorLight: '#0f172a',
        correctLevel: QRCode.CorrectLevel.M
      });

      state.setQrCodeGenerated(true);
    }
  } else {
    container.style.display = 'none';
  }
}

/**
 * Load stats
 */
export async function loadStats() {
  try {
    const data = await apiCall('/stats');
    const feedCount = data.state?.postCount || 0;

    $('stat-posts').textContent = feedCount;
    $('stat-trusted').textContent = data.identity?.trustCount || 0;
    $('stat-network').textContent = feedCount;
  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

// =========================================================================
// Settings
// =========================================================================

/**
 * Load settings
 */
export async function loadSettings() {
  try {
    const data = await apiCall('/settings');

    // NSFW preference from IndexedDB
    let nsfwEnabled = data.nsfwEnabled || false;
    if (window.CloutUserData && window.userPublicKey) {
      const localProfile = await window.CloutUserData.getProfile(window.userPublicKey);
      if (localProfile && localProfile.showNsfw !== undefined) {
        nsfwEnabled = localProfile.showNsfw;
      }
    }

    $('settings-nsfw-enabled').checked = nsfwEnabled;
    $('settings-max-hops').value = data.trustSettings?.maxHops || 3;

    const minRep = data.trustSettings?.minReputation || 0.3;
    $('settings-min-reputation').value = Math.round(minRep * 100);
    $('settings-min-reputation-value').textContent = minRep.toFixed(2);

    // Media filters
    const filters = data.trustSettings?.contentTypeFilters || {};
    const defaultHops = data.trustSettings?.maxHops || 3;

    const imageHops = filters['image/*']?.maxHops ?? defaultHops;
    const videoHops = filters['video/*']?.maxHops ?? defaultHops;
    const audioHops = filters['audio/*']?.maxHops ?? defaultHops;

    $('media-filter-images-hops').value = imageHops;
    $('media-filter-videos-hops').value = videoHops;
    $('media-filter-audio-hops').value = audioHops;

    $('settings-auto-follow-back').checked = data.trustSettings?.autoFollowBack || false;

    // Admin section
    if (data.admin && data.admin.enabled) {
      $('admin-section').style.display = 'block';
      $('freebird-admin-link').href = data.admin.freebirdUrl;
    } else {
      $('admin-section').style.display = 'none';
    }

    await loadTags();
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

/**
 * Save settings
 */
export async function saveSettings(requireMembership) {
  if (!requireMembership()) return;

  try {
    $('save-settings-btn').disabled = true;
    $('save-settings-btn').textContent = 'Saving...';

    const showNsfw = $('settings-nsfw-enabled').checked;
    const settings = {
      showNsfw,
      maxHops: parseInt($('settings-max-hops').value),
      minReputation: parseInt($('settings-min-reputation').value) / 100,
      autoFollowBack: $('settings-auto-follow-back').checked
    };

    if (window.CloutUserData && window.userPublicKey) {
      const localProfile = await window.CloutUserData.getProfile(window.userPublicKey) || {};
      await window.CloutUserData.saveProfile({
        ...localProfile,
        publicKey: window.userPublicKey,
        showNsfw
      });
    }

    await apiCall('/settings', 'POST', settings);
    showResult('settings-result', 'Settings saved!', true);
  } catch (error) {
    showResult('settings-result', `Error: ${error.message}`, false);
  } finally {
    $('save-settings-btn').disabled = false;
    $('save-settings-btn').textContent = 'Save Settings';
  }
}

/**
 * Save media filters
 */
export async function saveMediaFilters(requireMembership) {
  if (!requireMembership()) return;

  try {
    $('save-media-filters-btn').disabled = true;
    $('save-media-filters-btn').textContent = 'Saving...';

    const imageHops = parseInt($('media-filter-images-hops').value);
    const videoHops = parseInt($('media-filter-videos-hops').value);
    const audioHops = parseInt($('media-filter-audio-hops').value);

    const promises = [
      apiCall('/settings/content-filter', 'POST', { contentType: 'image/*', maxHops: imageHops, minReputation: 0.3 }),
      apiCall('/settings/content-filter', 'POST', { contentType: 'video/*', maxHops: videoHops, minReputation: 0.3 }),
      apiCall('/settings/content-filter', 'POST', { contentType: 'audio/*', maxHops: audioHops, minReputation: 0.3 })
    ];

    await Promise.all(promises);
    showResult('media-filter-result', 'Media settings saved!', true);
  } catch (error) {
    showResult('media-filter-result', `Error: ${error.message}`, false);
  } finally {
    $('save-media-filters-btn').disabled = false;
    $('save-media-filters-btn').textContent = 'Save Media Settings';
  }
}

// =========================================================================
// Tags
// =========================================================================

/**
 * Load tags
 */
export async function loadTags() {
  try {
    const tagsList = $('tags-list');

    if (!window.CloutUserData) {
      tagsList.innerHTML = '<p class="empty-state">No tags yet</p>';
      return;
    }

    const allTags = await window.CloutUserData.getAllTags();

    if (!allTags || allTags.size === 0) {
      tagsList.innerHTML = '<p class="empty-state">No tags yet</p>';
      return;
    }

    const tagsArray = Array.from(allTags.entries()).map(([tag, count]) => ({ tag, count }));

    tagsList.innerHTML = tagsArray.map(tag => `
      <div class="tag-item">
        <span class="tag-name">${escapeHtml(tag.tag)}</span>
        <span class="tag-count">${tag.count} users</span>
        <button class="btn btn-small" onclick="window.cloutApp.viewTagUsers('${escapeHtml(tag.tag)}')">View</button>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading tags:', error);
    $('tags-list').innerHTML = '<p class="empty-state">Error loading tags</p>';
  }
}

/**
 * View users with a specific tag
 */
export async function viewTagUsers(tag) {
  try {
    if (!window.CloutUserData) {
      alert('User data not available');
      return;
    }

    const users = await window.CloutUserData.getUsersByTag(tag);

    if (users.length === 0) {
      alert(`No users with tag "${tag}"`);
      return;
    }

    const userList = users.map(u => `${u.slice(0, 12)}...`).join('\n');
    alert(`Users with tag "${tag}":\n\n${userList}`);
  } catch (error) {
    alert(`Error: ${error.message}`);
  }
}

/**
 * Add tag to a user
 */
export async function addTag() {
  const tag = $('new-tag-name').value.trim();
  const publicKey = $('new-tag-user').value.trim();

  if (!tag || !publicKey) {
    showResult('tag-result', 'Please enter both tag name and user public key', false);
    return;
  }

  try {
    $('add-tag-btn').disabled = true;

    if (window.CloutUserData) {
      await window.CloutUserData.addTag(publicKey, tag);
    }

    showResult('tag-result', `Tag "${tag}" added to user!`, true);
    $('new-tag-name').value = '';
    $('new-tag-user').value = '';

    await loadTags();
  } catch (error) {
    showResult('tag-result', `Error: ${error.message}`, false);
  } finally {
    $('add-tag-btn').disabled = false;
  }
}

// =========================================================================
// Data Management
// =========================================================================

/**
 * Export backup
 */
export async function exportBackup() {
  try {
    $('export-backup-btn').disabled = true;
    $('export-backup-btn').textContent = 'Exporting...';

    const response = await fetch('/api/data/export');
    if (!response.ok) throw new Error('Export failed');
    const serverBackup = await response.json();

    let localData = null;
    if (window.CloutUserData) {
      try {
        localData = await window.CloutUserData.exportAll();
        console.log('[Export] Including IndexedDB data:', Object.keys(localData));
      } catch (e) {
        console.warn('[Export] Could not export IndexedDB data:', e);
      }
    }

    const backup = {
      ...serverBackup,
      darkSocialGraph: localData
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clout-backup-${backup.identity.publicKey.slice(0, 8)}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    alert('Backup downloaded successfully!');
  } catch (error) {
    alert(`Export failed: ${error.message}`);
  } finally {
    $('export-backup-btn').disabled = false;
    $('export-backup-btn').textContent = 'Download Backup';
  }
}

/**
 * Import backup
 */
export async function importBackup(file) {
  try {
    const text = await file.text();
    const backup = JSON.parse(text);

    if (!backup.version) {
      throw new Error('Invalid backup file format');
    }

    $('import-backup-btn').disabled = true;
    $('import-backup-btn').textContent = 'Importing...';

    const result = await apiCall('/data/import', 'POST', backup);

    let localDataImported = false;
    if (backup.darkSocialGraph && window.CloutUserData) {
      try {
        await window.CloutUserData.importAll(backup.darkSocialGraph);
        localDataImported = true;
        console.log('[Import] Restored IndexedDB data from backup');
      } catch (e) {
        console.warn('[Import] Could not restore IndexedDB data:', e);
      }
    }

    showResult('import-result',
      `Imported: ${result.trustSignalsImported} trust signals` +
      (localDataImported ? ', local social graph' : ''),
      true);

    setTimeout(() => loadFeed(), 1000);
  } catch (error) {
    showResult('import-result', `Import failed: ${error.message}`, false);
  } finally {
    $('import-backup-btn').disabled = false;
    $('import-backup-btn').textContent = 'Select Backup File';
    $('import-backup-input').value = '';
  }
}

/**
 * Load identities list
 */
export async function loadIdentities() {
  try {
    const data = await apiCall('/data/identities');
    const container = $('identities-list');

    if (!data.identities || data.identities.length === 0) {
      container.innerHTML = '<p class="empty-state">No identities found</p>';
      return;
    }

    container.innerHTML = data.identities.map(id => `
      <div class="identity-card ${id.isDefault ? 'active' : ''}">
        <div class="identity-info">
          <div class="identity-name">
            ${escapeHtml(id.name)}
            ${id.isDefault ? '<span class="identity-badge active">Active</span>' : ''}
          </div>
          <div class="identity-key">${id.publicKeyShort}...</div>
          <div class="identity-created">Created ${formatRelativeTime(id.created)}</div>
        </div>
        <div class="identity-actions">
          ${!id.isDefault ? `<button class="btn-small" onclick="window.cloutApp.switchIdentity('${escapeHtml(id.name)}')">Switch</button>` : ''}
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading identities:', error);
    $('identities-list').innerHTML = '<p class="empty-state">Error loading identities</p>';
  }
}

/**
 * Switch identity
 */
export async function switchIdentity(name) {
  if (!confirm(`Switch to identity "${name}"?\n\nThis requires restarting the server to take effect.`)) {
    return;
  }

  try {
    const result = await apiCall('/data/identities/switch', 'POST', { name });
    alert(result.message || 'Identity switched. Please restart the server.');
    await loadIdentities();
  } catch (error) {
    alert(`Failed to switch identity: ${error.message}`);
  }
}

/**
 * Create new identity
 */
export async function createIdentity() {
  const name = $('new-identity-name').value.trim();

  if (!name) {
    showResult('identity-result', 'Please enter an identity name', false);
    return;
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    showResult('identity-result', 'Name can only contain letters, numbers, underscores, and hyphens', false);
    return;
  }

  try {
    $('create-identity-btn').disabled = true;
    await apiCall('/data/identities', 'POST', { name, setDefault: false });

    showResult('identity-result', `Identity "${name}" created!`, true);
    $('new-identity-name').value = '';

    await loadIdentities();
  } catch (error) {
    showResult('identity-result', `Error: ${error.message}`, false);
  } finally {
    $('create-identity-btn').disabled = false;
  }
}

/**
 * Export identity key
 */
export async function exportIdentityKey() {
  if (!confirm('WARNING: Your secret key gives full control of your identity!\n\nOnly export this if you need to backup or move your identity to another device.\n\nContinue?')) {
    return;
  }

  try {
    const currentIdentity = await apiCall('/data/identity/current');
    const result = await apiCall(`/data/identities/${currentIdentity.name}/export`);

    const key = result.secretKey;
    prompt('Your secret key (copy this and keep it safe!):', key);
  } catch (error) {
    alert(`Failed to export key: ${error.message}`);
  }
}

/**
 * Import identity from key
 */
export async function importIdentityKey() {
  const name = $('import-identity-name').value.trim();
  const secretKey = $('import-identity-key').value.trim();

  if (!name || !secretKey) {
    showResult('identity-result', 'Please enter both name and secret key', false);
    return;
  }

  try {
    $('import-identity-btn').disabled = true;
    await apiCall('/data/identities/import', 'POST', { name, secretKey, setDefault: false });

    showResult('identity-result', `Identity "${name}" imported!`, true);
    $('import-identity-name').value = '';
    $('import-identity-key').value = '';

    await loadIdentities();
  } catch (error) {
    showResult('identity-result', `Error: ${error.message}`, false);
  } finally {
    $('import-identity-btn').disabled = false;
  }
}

/**
 * Setup settings event listeners
 */
export function setupSettings(requireMembership) {
  $('settings-min-reputation').addEventListener('input', (e) => {
    $('settings-min-reputation-value').textContent = (e.target.value / 100).toFixed(2);
  });

  $('save-settings-btn').addEventListener('click', () => saveSettings(requireMembership));
  $('save-media-filters-btn').addEventListener('click', () => saveMediaFilters(requireMembership));
  $('add-tag-btn').addEventListener('click', addTag);

  $('export-backup-btn').addEventListener('click', exportBackup);
  $('import-backup-btn').addEventListener('click', () => $('import-backup-input').click());
  $('import-backup-input').addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      importBackup(e.target.files[0]);
    }
  });

  $('create-identity-btn').addEventListener('click', createIdentity);
  $('export-identity-btn').addEventListener('click', exportIdentityKey);
  $('import-identity-btn').addEventListener('click', importIdentityKey);
}
