/**
 * Clout Web UI - Main Entry Point
 *
 * This module initializes the application and wires together all the modules.
 * It exports a global window.cloutApp object for onclick handlers in HTML.
 */

// Import all modules
import * as state from './state.js';
import { apiCall } from './api.js';
import {
  $, $$, showLoading, showResult, updateStatus, escapeHtml,
  formatRelativeTime, renderAvatar, getReputationColor, getWeightLabel,
  copyToClipboard, switchToTab, startDayPassTimer, setupAvatarErrorHandling
} from './ui.js';
import {
  loadFeed, loadVisitorFeed, loadFeedWithCurrentFilter, setFeedFilter,
  filterByTag, searchPosts, clearSearch, renderFeedItem, handleMediaError,
  loadMorePosts, setFeedSort, setupMediaErrorHandling
} from './feed.js';
import {
  createPost, startReply, cancelReply, startEditPost, cancelEdit,
  retractPost, setupMediaUpload, setupCharCounter, clearMediaPreview,
  setupAttachmentSelector, setupLinkPreview, clearLinkPreview
} from './posts.js';
import {
  toggleReaction, toggleBookmark, toggleCW,
  openEmojiPicker, closeEmojiPicker, filterEmojis, selectEmoji,
  expandReactions
} from './reactions.js';
import { viewThread } from './thread.js';
import {
  loadTrustedUsers, trustUser, quickTrust, muteUser, unmuteUser, untrustUser,
  editNickname, updateTrustWeightDisplay, loadTrustRequests, sendTrustRequest,
  acceptTrustRequest, rejectTrustRequest, withdrawTrustRequest, retryTrustRequest
} from './trust.js';
import { sendSlide, loadSlides, startSlideReply } from './slides.js';
import {
  loadIdentity, loadProfile, showProfileEdit, cancelProfileEdit,
  saveProfile, toggleQRCode, loadStats, loadSettings, saveSettings,
  saveMediaFilters, loadTags, viewTagUsers, addTag,
  loadIdentities, switchIdentity, createIdentity,
  exportIdentityKey, importIdentityKey, setupSettings, createBrowserIdentity,
  loadDelegationStatus, delegatePass, acceptDelegation
} from './profile.js';
import {
  connectLiveUpdates, loadNewPosts, updateNotificationCounts
} from './notifications.js';
import {
  showInvitePopover, closeInvitePopover, redeemInvite, promptIdentityBackup,
  showRestorePopover, closeRestorePopover, restoreFromFile
} from './invite.js';
import {
  loadMyInvitationStatus, loadMyInvitations, createMemberInvitation, copyMemberCode,
  lookupUser,
  loadAdminMembers, prefillGrantQuota, grantQuota,
  ownerCreateInvitations, loadAdminInvitations
} from './admin.js';

// =========================================================================
// Create requireMembership wrapper
// =========================================================================

function requireMembership() {
  if (!state.initialized || state.isVisitor) {
    showInvitePopover();
    return false;
  }
  return true;
}

// =========================================================================
// Tab Management
// =========================================================================

function setupTabs() {
  $$('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;

      $$('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      $$('.tab-content').forEach(content => content.classList.remove('active'));
      $(`${tab}-tab`).classList.add('active');

      if (tab === 'feed') loadFeed();
      if (tab === 'slides') loadSlides();
      if (tab === 'settings') { loadSettings(); loadDelegationStatus(); }
      if (tab === 'trust') { loadTrustedUsers(); loadTrustRequests(); loadStats(); loadSettings(); }
      if (tab === 'profile') { loadProfile(); loadIdentity(); }
      if (tab === 'owner') { loadOwnerInfo(); }
    });
  });
}

// =========================================================================
// Initialization
// =========================================================================

async function initializeClout() {
  try {
    $('init-btn').disabled = true;
    $('init-btn').textContent = 'Initializing...';
    updateStatus('Initializing...', false);

    // Initialize server connection (but ignore server's ticketInfo)
    await apiCall('/init', 'POST');

    state.setInitialized(true);
    state.setIsVisitor(false);
    $('init-section').style.display = 'none';
    $('main-app').style.display = 'block';
    updateStatus('Connected', true);

    // Check BROWSER identity's Day Pass (not server's)
    await updateBrowserDayPassTimer();

    // Fetch instance info for witness domain (needed for feed display)
    try {
      const instanceResult = await apiCall('/instance');
      if (instanceResult.witnessDomain) {
        state.setWitnessDomain(instanceResult.witnessDomain);
        console.log('[App] Witness domain loaded:', instanceResult.witnessDomain);
      }
    } catch (e) {
      console.warn('[App] Failed to load instance info:', e.message);
    }

    await loadFeed();
    await loadIdentity();
    await loadProfile();
    loadSlides().catch(() => {});

    connectLiveUpdates();
    updateNotificationCounts();
    setInterval(updateNotificationCounts, 30000);
  } catch (error) {
    updateStatus(`Error: ${error.message}`, false);
    $('init-btn').disabled = false;
    $('init-btn').textContent = 'Initialize Clout';
  }
}

/**
 * Update Day Pass timer based on BROWSER identity (not server's)
 */
async function updateBrowserDayPassTimer() {
  try {
    // Only check if we have browser identity modules
    if (!window.CloutIdentity || !window.CloutDayPass) {
      console.log('[App] Browser identity modules not loaded, skipping Day Pass check');
      return;
    }

    // Load browser identity
    const identity = await window.CloutIdentity.load();
    if (!identity) {
      console.log('[App] No browser identity, no Day Pass timer');
      return;
    }

    // Check Day Pass status for THIS user's identity
    const status = await window.CloutDayPass.getDayPassStatus(identity.publicKeyHex);

    if (status.hasTicket && !status.isExpired) {
      console.log('[App] Browser identity has valid Day Pass, expires:', new Date(status.expiry).toLocaleString());
      startDayPassTimer(status.expiry);
    } else {
      console.log('[App] Browser identity has no valid Day Pass');
      // Don't show timer - user needs to obtain a Day Pass when they try to post
    }
  } catch (error) {
    console.warn('[App] Failed to check browser Day Pass status:', error.message);
  }
}

/**
 * Load and display instance info
 */
async function loadInstanceInfo() {
  try {
    const result = await apiCall('/instance');
    if (result.operator) {
      $('instance-operator-text').textContent = `This instance is run by ${result.operator}`;
      $('instance-info').style.display = 'block';
    }
  } catch (error) {
    console.warn('[App] Could not load instance info:', error.message);
  }
}

/**
 * Load and display instance clout stats (public - works for visitors too)
 */
async function loadInstanceStats() {
  try {
    const result = await apiCall('/instance/stats');
    const cloutPosts = $('clout-posts');
    const cloutAuthors = $('clout-authors');
    const cloutReactions = $('clout-reactions');
    const cloutPeers = $('clout-peers');

    if (cloutPosts) cloutPosts.textContent = formatNumber(result.posts || 0);
    if (cloutAuthors) cloutAuthors.textContent = formatNumber(result.authors || 0);
    if (cloutReactions) cloutReactions.textContent = formatNumber(result.reactions || 0);
    if (cloutPeers) cloutPeers.textContent = formatNumber(result.peers || 0);
  } catch (error) {
    console.warn('[App] Could not load instance stats:', error.message);
  }
}

/**
 * Format large numbers with K/M suffixes
 */
function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return num.toString();
}

/**
 * Load Owner tab info
 */
async function loadOwnerInfo() {
  try {
    // Get instance info
    const instanceResult = await apiCall('/instance');
    console.log('[App] Instance info received:', instanceResult);
    console.log('[App] witnessDomain from server:', instanceResult.witnessDomain);

    $('owner-instance-name').textContent = instanceResult.name || 'Clout Instance';
    $('owner-operator-name').textContent = instanceResult.operator || 'Not specified';
    $('owner-description').textContent = instanceResult.description || 'An uncensorable social network instance';

    // Store witness domain for display in feed
    if (instanceResult.witnessDomain) {
      state.setWitnessDomain(instanceResult.witnessDomain);
      console.log('[App] Set witnessDomain in state:', instanceResult.witnessDomain);
    } else {
      console.log('[App] No witnessDomain in response, state.witnessDomain will remain:', state.witnessDomain);
    }

    // Get server's public key (this is the instance identity)
    const identityResult = await apiCall('/identity');
    $('owner-public-key').textContent = identityResult.publicKey || 'Not available';

    // Load PGP key and contact info if configured
    if (instanceResult.pgpKey) {
      $('owner-pgp-key').textContent = instanceResult.pgpKey;
      $('copy-pgp-key-btn').style.display = 'inline-block';
    } else {
      $('owner-pgp-key').textContent = 'No PGP key configured';
      $('copy-pgp-key-btn').style.display = 'none';
    }

    if (instanceResult.contact) {
      $('owner-contact-info').textContent = instanceResult.contact;
    } else {
      $('owner-contact-info').textContent = 'Contact information not configured';
    }

    // Check if admin features are available (only for instance owner)
    try {
      const settingsResult = await apiCall('/settings');
      if (settingsResult.admin && settingsResult.admin.enabled) {
        // Check if browser identity matches owner pubkey
        let isOwner = false;
        const ownerPubkey = settingsResult.admin.ownerPubkey;

        if (!ownerPubkey) {
          // No owner pubkey configured - don't show admin (require explicit config)
          console.log('[App] Admin enabled but INSTANCE_OWNER_PUBKEY not set');
        } else if (window.CloutIdentity) {
          const browserIdentity = await window.CloutIdentity.load();
          if (browserIdentity && browserIdentity.publicKeyHex === ownerPubkey) {
            isOwner = true;
            console.log('[App] Browser identity matches owner pubkey - showing admin');
          }
        }

        if (isOwner) {
          // Show admin section
          $('owner-admin-section').style.display = 'block';

          // Set Freebird admin link
          $('freebird-admin-link').href = settingsResult.admin.freebirdUrl;

          // Load server-stored identities for restore dropdown
          await loadServerIdentities();

          // Load admin data (members with quota, all invitations)
          loadMembersWithQuota().catch(e => console.warn('[App] Failed to load members:', e.message));
          loadAllInvitations().catch(e => console.warn('[App] Failed to load invitations:', e.message));
        }

        // Check if current user has invitation quota (show member invite section)
        loadMyInvitationStatus().catch(e => console.warn('[App] Failed to load invitation status:', e.message));
      }
    } catch (settingsError) {
      console.warn('[App] Could not load admin settings:', settingsError.message);
    }

    // Even if admin settings fail, check if user has quota (non-admin path)
    loadMyInvitationStatus().catch(e => console.warn('[App] Failed to load invitation status:', e.message));
  } catch (error) {
    console.error('[App] Failed to load owner info:', error.message);
    $('owner-instance-name').textContent = 'Error loading';
    $('owner-operator-name').textContent = 'Error loading';
  }
}

/**
 * Load server-stored identities for restore dropdown
 */
async function loadServerIdentities() {
  try {
    const result = await apiCall('/data/identities');
    const select = $('restore-identity-select');

    // Clear existing options except the placeholder
    select.innerHTML = '<option value="">Select a saved identity...</option>';

    if (result.identities && result.identities.length > 0) {
      result.identities.forEach(identity => {
        const option = document.createElement('option');
        option.value = identity.name;
        option.textContent = `${identity.name} (${identity.publicKeyShort}...)`;
        select.appendChild(option);
      });
    }
  } catch (error) {
    console.warn('[App] Could not load server identities:', error.message);
  }
}

/**
 * Backup browser identity to server storage
 */
async function backupBrowserIdentity() {
  const resultEl = $('backup-result');
  const btn = $('backup-identity-btn');

  try {
    // Check for browser identity
    if (!window.CloutIdentity) {
      resultEl.textContent = 'Browser identity module not loaded';
      resultEl.className = 'result-message error';
      return;
    }

    const identity = await window.CloutIdentity.load();
    if (!identity) {
      resultEl.textContent = 'No browser identity found. Create or import one first.';
      resultEl.className = 'result-message error';
      return;
    }

    // Get the private key hex
    const Crypto = window.CloutCrypto;
    const secretKeyHex = Crypto.toHex(identity.privateKey);

    // Prompt for backup name
    const defaultName = `browser-${identity.publicKeyHex.slice(0, 8)}`;
    const name = prompt('Name for this backup:', defaultName);
    if (!name) {
      resultEl.textContent = 'Backup cancelled';
      resultEl.className = 'result-message';
      return;
    }

    // Validate name
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      resultEl.textContent = 'Name can only contain letters, numbers, underscores, and hyphens';
      resultEl.className = 'result-message error';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Backing up...';
    resultEl.textContent = '';

    // Import to server (this saves it server-side)
    await apiCall('/data/identities/import', 'POST', {
      name,
      secretKey: secretKeyHex,
      setDefault: false
    });

    resultEl.textContent = `Backed up as "${name}"!`;
    resultEl.className = 'result-message success';

    // Refresh the restore dropdown
    await loadServerIdentities();
  } catch (error) {
    resultEl.textContent = `Backup failed: ${error.message}`;
    resultEl.className = 'result-message error';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Backup Identity to Server';
  }
}

/**
 * Restore browser identity from server storage
 */
async function restoreFromServer() {
  const resultEl = $('restore-result');
  const select = $('restore-identity-select');
  const btn = $('restore-identity-btn');

  const selectedName = select.value;
  if (!selectedName) {
    resultEl.textContent = 'Please select an identity to restore';
    resultEl.className = 'result-message error';
    return;
  }

  if (!confirm(`This will replace your current browser identity with "${selectedName}". Continue?`)) {
    return;
  }

  try {
    btn.disabled = true;
    btn.textContent = 'Restoring...';
    resultEl.textContent = '';

    // Get the secret key from server
    const exportResult = await apiCall(`/data/identities/${selectedName}/export`);
    const secretKey = exportResult.secretKey;

    // Import to browser
    if (!window.CloutIdentity) {
      throw new Error('Browser identity module not loaded');
    }

    await window.CloutIdentity.importFromSecretKey(secretKey);

    resultEl.textContent = 'Identity restored! Reloading...';
    resultEl.className = 'result-message success';

    // Reload the page to use the new identity
    setTimeout(() => {
      window.location.reload();
    }, 1500);
  } catch (error) {
    resultEl.textContent = `Restore failed: ${error.message}`;
    resultEl.className = 'result-message error';
    btn.disabled = false;
    btn.textContent = 'Restore';
  }
}

/**
 * Show visitor banner
 */
function showVisitorBanner() {
  $('visitor-banner').style.display = 'block';
}

/**
 * Hide visitor banner
 */
function hideVisitorBanner() {
  $('visitor-banner').style.display = 'none';
}

/**
 * Show/hide tabs and UI elements based on visitor status
 * Visitors can see Feed and Owner tabs only, without filters/search
 */
function updateTabVisibility(isVisitor) {
  const memberOnlyTabs = ['post', 'trust', 'slides', 'profile', 'settings'];

  memberOnlyTabs.forEach(tabName => {
    const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (tabBtn) {
      tabBtn.style.display = isVisitor ? 'none' : '';
    }
  });

  // Owner tab is always visible
  const ownerBtn = document.querySelector('.tab-btn[data-tab="owner"]');
  if (ownerBtn) {
    ownerBtn.style.display = '';
  }

  // Hide feed filters and search bar for visitors
  const feedFilters = $('feed-filters-container');
  const searchBar = $('search-bar-container');

  if (feedFilters) {
    feedFilters.style.display = isVisitor ? 'none' : '';
  }
  if (searchBar) {
    searchBar.style.display = isVisitor ? 'none' : '';
  }
}

/**
 * Auto-initialize Clout connection
 */
async function autoInitialize() {
  try {
    const health = await apiCall('/health');
    updateStatus('Connecting...', false);

    // Load instance info (always show, even for visitors)
    await loadInstanceInfo();

    // Load instance clout stats (visible to everyone)
    await loadInstanceStats();

    // Check for existing browser identity
    let hasBrowserIdentity = false;
    if (window.CloutIdentity) {
      try {
        const identity = await window.CloutIdentity.load();
        if (identity) {
          console.log('[Clout] Found existing browser identity:', identity.publicKeyHex.slice(0, 16) + '...');
          window.browserIdentity = identity;
          window.userPublicKey = identity.publicKeyHex;
          hasBrowserIdentity = true;

          // Check if this identity has a valid Day Pass on the server
          // After an instance reset, old identities won't have valid Day Passes
          try {
            const dayPassStatus = await apiCall(`/daypass/status/${identity.publicKeyHex}`);
            const hasValidDayPass = dayPassStatus.hasTicket && !dayPassStatus.isExpired;

            if (!hasValidDayPass) {
              console.log('[Clout] Browser identity found but no valid Day Pass - entering visitor mode');
              console.log('[Clout] Day Pass status:', dayPassStatus);
              // Identity exists but no Day Pass - show visitor mode with invitation prompt
              // Keep the identity loaded so they can redeem an invitation code
              state.setIsVisitor(true);
              state.setInitialized(false);
              $('init-section').style.display = 'none';
              $('main-app').style.display = 'block';
              updateStatus('No Day Pass - Please redeem an invitation code', false);
              showVisitorBanner();
              updateTabVisibility(true);

              // Load visitor feed
              try {
                const instanceResult = await apiCall('/instance');
                if (instanceResult.witnessDomain) {
                  state.setWitnessDomain(instanceResult.witnessDomain);
                }
              } catch (e) {
                console.warn('[App] Failed to load instance info:', e.message);
              }
              await loadVisitorFeed();
              return;
            }

            // Day Pass is valid - proceed with full initialization
            console.log('[Clout] Valid Day Pass found, expires:', new Date(dayPassStatus.expiry).toISOString());
          } catch (dayPassError) {
            console.warn('[Clout] Failed to check Day Pass status:', dayPassError.message);
            // If we can't check, assume invalid and enter visitor mode
            state.setIsVisitor(true);
            state.setInitialized(false);
            $('init-section').style.display = 'none';
            $('main-app').style.display = 'block';
            updateStatus('Could not verify Day Pass', false);
            showVisitorBanner();
            updateTabVisibility(true);
            await loadVisitorFeed();
            return;
          }

          try {
            await initializeClout();
            state.setIsVisitor(false);
            hideVisitorBanner();
            updateTabVisibility(false);
            return;
          } catch (initError) {
            console.warn('[Clout] Server init failed with browser identity:', initError.message);
            // Fall through to visitor mode
          }
        }
      } catch (loadError) {
        console.warn('[Clout] Failed to load browser identity:', loadError);
      }
    }

    // No browser identity = visitor mode
    // (The server has its own identity, but that doesn't authenticate the browser user)
    console.log('[Clout] No browser identity found, entering visitor mode');
    state.setIsVisitor(true);
    state.setInitialized(false);

    $('init-section').style.display = 'none';
    $('main-app').style.display = 'block';
    updateStatus('Visitor Mode', false);
    showVisitorBanner();
    updateTabVisibility(true);

    // Fetch instance info for witness domain (needed for feed display)
    try {
      const instanceResult = await apiCall('/instance');
      if (instanceResult.witnessDomain) {
        state.setWitnessDomain(instanceResult.witnessDomain);
        console.log('[App] Witness domain loaded (visitor):', instanceResult.witnessDomain);
      }
    } catch (e) {
      console.warn('[App] Failed to load instance info:', e.message);
    }

    await loadVisitorFeed();
  } catch (error) {
    updateStatus('Server not responding. Click Initialize to retry.', false);
    console.error('Auto-init failed:', error);
  }
}

/**
 * Wait for Clout modules to be ready
 */
function waitForModules() {
  return new Promise((resolve) => {
    if (window.cloutModulesReady) {
      resolve();
    } else {
      window.addEventListener('clout-modules-ready', () => resolve(), { once: true });
    }
  });
}

// =========================================================================
// Export global API for onclick handlers
// =========================================================================

window.cloutApp = {
  // State (for debugging)
  getState: () => state,

  // UI helpers
  switchToTab,
  copyToClipboard,

  // Feed
  loadFeed,
  loadFeedWithCurrentFilter,
  setFeedFilter,
  filterByTag,
  searchPosts,
  clearSearch,
  handleMediaError,
  loadMorePosts,
  setFeedSort,

  // Posts
  createPost: () => createPost(requireMembership, showInvitePopover),
  startReply: (postId, author) => startReply(postId, author, requireMembership),
  cancelReply,
  startEditPost: (postId) => startEditPost(postId, requireMembership),
  cancelEdit,
  retractPost: (postId) => retractPost(postId, requireMembership),

  // Reactions
  toggleReaction: (postId, emoji) => toggleReaction(postId, emoji, requireMembership),
  toggleBookmark: (postId) => toggleBookmark(postId, requireMembership),
  toggleCW,
  openEmojiPicker,
  closeEmojiPicker,
  filterEmojis,
  selectEmoji,
  expandReactions,

  // Thread
  viewThread,

  // Trust
  trustUser: () => trustUser(requireMembership),
  quickTrust: (publicKey) => quickTrust(publicKey, requireMembership),
  muteUser: (publicKey, displayName) => muteUser(publicKey, displayName, requireMembership),
  unmuteUser,
  untrustUser,
  editNickname,

  // Trust Requests (consent-based trust)
  sendTrustRequest: () => sendTrustRequest(requireMembership),
  acceptTrustRequest,
  rejectTrustRequest,
  withdrawTrustRequest,
  retryTrustRequest,
  loadTrustRequests,

  // Slides
  sendSlide: () => sendSlide(requireMembership),
  loadSlides,
  startSlideReply,

  // Profile
  showProfileEdit,
  cancelProfileEdit,
  saveProfile: () => saveProfile(requireMembership),
  toggleQRCode,
  loadStats,

  // Settings
  loadSettings,
  viewTagUsers,

  // Day Pass Delegation
  delegatePass,
  acceptDelegation,

  // Identity
  switchIdentity,

  // Invite
  showInvitePopover,
  closeInvitePopover,
  redeemInvite,

  // Restore Identity
  showRestorePopover,
  closeRestorePopover,
  restoreFromFile,

  // Owner Admin
  backupBrowserIdentity,
  restoreFromServer,

  // Member Invitations
  loadMyInvitationStatus,
  loadMyInvitations,
  createMemberInvitation,
  copyMemberCode,

  // User Lookup
  lookupUser,

  // Owner Admin - Members & Invitations
  loadAdminMembers,
  prefillGrantQuota,
  grantQuota,
  ownerCreateInvitations,
  loadAdminInvitations,

  // Notifications
  loadNewPosts
};

// Also export for legacy window.function() calls
window.toggleQRCode = toggleQRCode;
window.copyToClipboard = (elementId) => {
  const text = $(elementId).textContent;
  copyToClipboard(text);
};

// =========================================================================
// App Bootstrap
// =========================================================================

document.addEventListener('DOMContentLoaded', async () => {
  // Wait for modules before setup
  await waitForModules();
  console.log('[App] Clout modules ready, initializing app...');

  // Setup event delegation for error handling (XSS-safe, no inline handlers)
  setupAvatarErrorHandling();
  setupMediaErrorHandling();

  setupTabs();
  setupCharCounter();
  setupMediaUpload();
  setupAttachmentSelector();
  setupLinkPreview();
  setupSettings(requireMembership);

  // Event listeners
  $('init-btn').addEventListener('click', initializeClout);
  $('create-post-btn').addEventListener('click', () => createPost(requireMembership, showInvitePopover));
  $('trust-btn').addEventListener('click', () => sendTrustRequest(requireMembership));
  $('refresh-feed-btn').addEventListener('click', loadFeed);
  $('send-slide-btn').addEventListener('click', () => sendSlide(requireMembership));
  $('refresh-slides-btn').addEventListener('click', loadSlides);

  // Visitor banner - show invite popover
  $('visitor-join-btn').addEventListener('click', showInvitePopover);
  $('visitor-restore-btn').addEventListener('click', showRestorePopover);

  $('back-to-feed-btn').addEventListener('click', () => {
    $$('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.tab-btn[data-tab="feed"]').classList.add('active');
    $$('.tab-content').forEach(content => content.classList.remove('active'));
    $('feed-tab').classList.add('active');

    document.querySelector('.tab-btn[data-tab="thread"]').style.display = 'none';
    loadFeed();
  });

  // Slide message character counter
  $('slide-message').addEventListener('input', () => {
    $('slide-char-count').textContent = $('slide-message').value.length;
  });

  // Content warning toggle
  $('post-cw-enabled').addEventListener('change', (e) => {
    $('cw-input-wrapper').style.display = e.target.checked ? 'block' : 'none';
    if (e.target.checked) {
      $('post-cw-text').focus();
    }
  });

  // Trust weight slider
  const trustWeightSlider = $('trust-weight');
  if (trustWeightSlider) {
    trustWeightSlider.addEventListener('input', updateTrustWeightDisplay);
  }

  // Profile event listeners
  $('edit-profile-btn').addEventListener('click', showProfileEdit);
  $('save-profile-btn').addEventListener('click', () => saveProfile(requireMembership));
  $('cancel-edit-btn').addEventListener('click', cancelProfileEdit);

  // Search
  $('search-btn').addEventListener('click', searchPosts);
  $('clear-search-btn').addEventListener('click', clearSearch);
  $('feed-search').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchPosts();
  });

  // Feed filters
  $$('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => setFeedFilter(btn.dataset.filter));
  });

  // Auto-initialize
  autoInitialize();
});
