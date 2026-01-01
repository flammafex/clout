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
 * Load browser identity information
 * This loads the identity stored in the browser's IndexedDB, not the server's identity
 */
export async function loadIdentity() {
  try {
    // Load browser identity from IndexedDB
    if (!window.CloutIdentity) {
      console.warn('[Identity] Browser identity module not loaded');
      $('identity-public-key').textContent = 'Browser identity not available';
      return;
    }

    const identity = await window.CloutIdentity.load();
    if (!identity) {
      console.warn('[Identity] No browser identity found');
      $('identity-public-key').textContent = 'No identity - create one to post';
      $('identity-created').textContent = 'N/A';
      return;
    }

    $('identity-public-key').textContent = identity.publicKeyHex;
    $('identity-created').textContent = identity.created ? formatRelativeTime(identity.created) : 'Unknown';

    window.userPublicKey = identity.publicKeyHex;
    window.browserIdentity = identity;

    // Ensure self is trusted in IndexedDB
    if (window.CloutUserData && identity.publicKeyHex) {
      const isSelfTrusted = await window.CloutUserData.isTrusted(identity.publicKeyHex);
      if (!isSelfTrusted) {
        console.log('[Identity] Adding self to IndexedDB trust graph');
        await window.CloutUserData.trust(identity.publicKeyHex, 1.0);
      }
    }
  } catch (error) {
    console.error('Error loading browser identity:', error);
    $('identity-public-key').textContent = 'Error loading identity';
  }
}

/**
 * Load profile from browser storage
 */
export async function loadProfile() {
  try {
    // Load browser identity first
    if (!window.CloutIdentity) {
      console.warn('[Profile] Browser identity module not loaded');
      return;
    }

    const identity = await window.CloutIdentity.load();
    if (!identity) {
      $('profile-name-display').textContent = '(No identity)';
      $('profile-bio-display').textContent = '';
      $('profile-bio-display').style.display = 'none';
      return;
    }

    // Load profile from IndexedDB
    let profile = null;
    if (window.CloutUserData) {
      profile = await window.CloutUserData.getProfile(identity.publicKeyHex);
    }

    $('profile-name-display').textContent = profile?.displayName || '(No name set)';
    $('profile-bio-display').textContent = profile?.bio || '';
    $('profile-avatar-display').innerHTML = renderAvatar(profile?.avatar);

    if (profile?.bio) {
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
export async function showProfileEdit() {
  try {
    // Load from browser storage
    if (window.CloutIdentity && window.CloutUserData) {
      const identity = await window.CloutIdentity.load();
      if (identity) {
        const profile = await window.CloutUserData.getProfile(identity.publicKeyHex);
        $('profile-name').value = profile?.displayName || '';
        $('profile-bio').value = profile?.bio || '';
        $('profile-avatar').value = profile?.avatar || '';
        $('bio-char-count').textContent = ($('profile-bio').value || '').length;
      }
    }
  } catch (error) {
    console.error('[Profile] Error loading for edit:', error);
  }

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
 * Save profile to browser storage
 */
export async function saveProfile(requireMembership) {
  if (!requireMembership()) return;

  const displayName = $('profile-name').value.trim();
  const bio = $('profile-bio').value.trim();
  const avatar = $('profile-avatar').value.trim();

  try {
    $('save-profile-btn').disabled = true;
    $('save-profile-btn').textContent = 'Saving...';

    // Save to browser storage
    if (!window.CloutIdentity || !window.CloutUserData) {
      throw new Error('Browser storage not available');
    }

    const identity = await window.CloutIdentity.load();
    if (!identity) {
      throw new Error('No browser identity found');
    }

    // Get existing profile and update
    const existingProfile = await window.CloutUserData.getProfile(identity.publicKeyHex) || {};
    await window.CloutUserData.saveProfile({
      ...existingProfile,
      publicKey: identity.publicKeyHex,
      displayName,
      bio,
      avatar
    });

    showResult('profile-result', 'Profile saved to browser!', true);

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
      minReputation: parseInt($('settings-min-reputation').value) / 100
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
// Day Pass Delegation
// =========================================================================

/**
 * Load delegation status and show appropriate UI
 */
export async function loadDelegationStatus() {
  try {
    const statusDiv = $('delegation-status');
    const delegateForm = $('delegate-form');
    const acceptSection = $('accept-delegation-section');

    if (!statusDiv) return;

    const data = await apiCall('/settings/daypass/delegation');

    if (data.hasPendingDelegation) {
      // User has a pending delegation to accept
      statusDiv.innerHTML = '';
      delegateForm.style.display = 'none';
      acceptSection.style.display = 'block';
    } else if (data.canDelegate) {
      // User can delegate passes
      statusDiv.innerHTML = `
        <p class="help-text-success">Your reputation (${data.reputation.toFixed(2)}) allows you to delegate Day Passes.</p>
      `;
      delegateForm.style.display = 'block';
      acceptSection.style.display = 'none';
    } else {
      // User cannot delegate
      statusDiv.innerHTML = `
        <p class="help-text">Your reputation (${data.reputation.toFixed(2)}) is below the required ${data.requiredReputation.toFixed(2)}. Build trust to unlock delegation.</p>
      `;
      delegateForm.style.display = 'none';
      acceptSection.style.display = 'none';
    }
  } catch (error) {
    console.error('Error loading delegation status:', error);
  }
}

/**
 * Delegate a Day Pass to another user
 */
export async function delegatePass() {
  const recipientKey = $('delegate-recipient').value.trim();
  const durationHours = parseInt($('delegate-duration').value);

  if (!recipientKey) {
    showResult('delegate-result', 'Please enter a recipient public key', false);
    return;
  }

  if (recipientKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(recipientKey)) {
    showResult('delegate-result', 'Invalid key: must be 64 hex characters', false);
    return;
  }

  try {
    $('delegate-btn').disabled = true;
    $('delegate-btn').textContent = 'Delegating...';

    await apiCall('/settings/daypass/delegate', 'POST', {
      recipientKey,
      durationHours
    });

    showResult('delegate-result', `Delegated ${durationHours}h pass to ${recipientKey.slice(0, 8)}...`, true);
    $('delegate-recipient').value = '';
  } catch (error) {
    showResult('delegate-result', `Error: ${error.message}`, false);
  } finally {
    $('delegate-btn').disabled = false;
    $('delegate-btn').textContent = 'Delegate Day Pass';
  }
}

/**
 * Accept a pending Day Pass delegation
 */
export async function acceptDelegation() {
  try {
    $('accept-delegation-btn').disabled = true;
    $('accept-delegation-btn').textContent = 'Accepting...';

    await apiCall('/settings/daypass/accept', 'POST');

    showResult('accept-result', 'Day Pass accepted! You can now post.', true);
    await loadDelegationStatus();
  } catch (error) {
    showResult('accept-result', `Error: ${error.message}`, false);
  } finally {
    $('accept-delegation-btn').disabled = false;
    $('accept-delegation-btn').textContent = 'Accept Delegation';
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
 * Import identity from key (server-side - legacy)
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

// =========================================================================
// Browser Identity Export/Import (for Profile tab)
// =========================================================================

/**
 * Export browser identity as encrypted backup
 */
export async function exportBrowserIdentity() {
  try {
    if (!window.CloutIdentity) {
      throw new Error('Browser identity module not available');
    }

    const identity = await window.CloutIdentity.load();
    if (!identity) {
      throw new Error('No browser identity found');
    }

    const password = prompt('Enter a password to encrypt your identity backup:');
    if (!password) return;

    const confirmPassword = prompt('Confirm your password:');
    if (password !== confirmPassword) {
      alert('Passwords do not match.');
      return;
    }

    await window.CloutIdentity.downloadBackup(identity, password);
    alert('Identity backup downloaded! Keep this file safe.');
  } catch (error) {
    alert(`Failed to export identity: ${error.message}`);
  }
}

/**
 * Create a fresh browser identity - OVERWRITES existing identity
 */
export async function createBrowserIdentity() {
  if (!confirm('WARNING: This will create a NEW identity and DELETE your current one!\n\nYour current identity will be permanently lost unless you have backed it up.\n\nAre you sure you want to create a new identity?')) {
    return;
  }

  // Double confirmation for safety
  if (!confirm('FINAL WARNING: This action CANNOT be undone!\n\nYou will lose access to all posts made with your current identity.\n\nProceed with creating a new identity?')) {
    return;
  }

  try {
    $('create-browser-identity-btn').disabled = true;
    $('create-browser-identity-btn').textContent = 'Creating...';

    if (!window.CloutIdentity) {
      throw new Error('Browser identity module not available');
    }

    // Generate new identity
    const newIdentity = window.CloutIdentity.generate();

    // Store it (overwrites existing)
    await window.CloutIdentity.store(newIdentity);

    showResult('browser-identity-result', 'New identity created! Reloading...', true);

    // Reload identity display
    await loadIdentity();
    await loadProfile();

    // Reload the page to ensure all state is fresh
    setTimeout(() => {
      window.location.reload();
    }, 1500);
  } catch (error) {
    showResult('browser-identity-result', `Error: ${error.message}`, false);
  } finally {
    $('create-browser-identity-btn').disabled = false;
    $('create-browser-identity-btn').textContent = 'Create New Identity';
  }
}

/**
 * Import browser identity from backup file - OVERWRITES existing identity
 */
export async function importBrowserIdentity() {
  const fileInput = $('import-browser-identity-file');
  const password = $('import-browser-identity-password').value;

  if (!fileInput.files || fileInput.files.length === 0) {
    showResult('browser-identity-result', 'Please select a backup file', false);
    return;
  }

  if (!password) {
    showResult('browser-identity-result', 'Please enter the backup password', false);
    return;
  }

  if (!confirm('WARNING: This will REPLACE your current browser identity!\n\nYour current identity will be deleted and replaced with the imported one.\n\nMake sure you have backed up your current identity if you need it.\n\nContinue?')) {
    return;
  }

  try {
    $('import-browser-identity-btn').disabled = true;
    $('import-browser-identity-btn').textContent = 'Restoring...';

    if (!window.CloutIdentity) {
      throw new Error('Browser identity module not available');
    }

    // Import the identity from backup file
    const file = fileInput.files[0];
    const identity = await window.CloutIdentity.importFromFile(file, password);
    await window.CloutIdentity.store(identity);

    // Restore all user data
    if (identity.userData && window.CloutUserData) {
      await window.CloutUserData.importAll(identity.userData);
    }

    showResult('browser-identity-result', 'Identity restored! Reloading...', true);
    fileInput.value = '';
    $('import-browser-identity-password').value = '';

    // Reload identity display
    await loadIdentity();
    await loadProfile();

    // Reload the page to ensure all state is fresh
    setTimeout(() => {
      window.location.reload();
    }, 1500);
  } catch (error) {
    showResult('browser-identity-result', `Error: ${error.message}`, false);
  } finally {
    $('import-browser-identity-btn').disabled = false;
    $('import-browser-identity-btn').textContent = 'Restore from Backup';
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

  // Browser identity export/import (in Profile tab)
  const exportBrowserBtn = $('export-browser-identity-btn');
  if (exportBrowserBtn) {
    exportBrowserBtn.addEventListener('click', exportBrowserIdentity);
  }

  const importBrowserBtn = $('import-browser-identity-btn');
  if (importBrowserBtn) {
    importBrowserBtn.addEventListener('click', importBrowserIdentity);
  }

  const createBrowserBtn = $('create-browser-identity-btn');
  if (createBrowserBtn) {
    createBrowserBtn.addEventListener('click', createBrowserIdentity);
  }
}
