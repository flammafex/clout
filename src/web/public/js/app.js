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
  copyToClipboard, switchToTab, startDayPassTimer
} from './ui.js';
import {
  loadFeed, loadVisitorFeed, loadFeedWithCurrentFilter, setFeedFilter,
  filterByTag, searchPosts, clearSearch, renderFeedItem, handleMediaError
} from './feed.js';
import {
  createPost, startReply, cancelReply, startEditPost, cancelEdit,
  retractPost, setupMediaUpload, setupCharCounter, clearMediaPreview
} from './posts.js';
import {
  toggleReaction, toggleBookmark, toggleCW, loadReactionPalette,
  openEmojiPicker, closeEmojiPicker, filterEmojis, selectEmoji,
  expandReactions, renderPaletteEditor, editPaletteSlot, closePalettePicker,
  setPaletteEmoji, resetPalette
} from './reactions.js';
import { viewThread } from './thread.js';
import {
  loadTrustedUsers, trustUser, quickTrust, muteUser, unmuteUser,
  editNickname, updateTrustWeightDisplay
} from './trust.js';
import { sendSlide, loadSlides, startSlideReply } from './slides.js';
import {
  loadIdentity, loadProfile, showProfileEdit, cancelProfileEdit,
  saveProfile, toggleQRCode, loadStats, loadSettings, saveSettings,
  saveMediaFilters, loadTags, viewTagUsers, addTag, exportBackup,
  importBackup, loadIdentities, switchIdentity, createIdentity,
  exportIdentityKey, importIdentityKey, setupSettings
} from './profile.js';
import {
  connectLiveUpdates, loadNewPosts, updateNotificationCounts
} from './notifications.js';
import {
  showInvitePopover, closeInvitePopover, redeemInvite, promptIdentityBackup
} from './invite.js';

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
      if (tab === 'settings') loadSettings();
      if (tab === 'trust') { loadTrustedUsers(); loadStats(); loadSettings(); }
      if (tab === 'profile') { loadProfile(); loadIdentity(); loadIdentities(); }
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

    // Load user's reaction palette from IndexedDB
    await loadReactionPalette();

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
 * Show/hide tabs based on visitor status
 * Visitors can only see the Feed tab
 */
function updateTabVisibility(isVisitor) {
  const memberOnlyTabs = ['post', 'trust', 'slides', 'profile', 'settings'];

  memberOnlyTabs.forEach(tabName => {
    const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (tabBtn) {
      tabBtn.style.display = isVisitor ? 'none' : '';
    }
  });
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

    // Check for existing browser identity
    if (window.CloutIdentity) {
      try {
        const identity = await window.CloutIdentity.load();
        if (identity) {
          console.log('[Clout] Found existing browser identity:', identity.publicKeyHex.slice(0, 16) + '...');
          window.browserIdentity = identity;
          window.userPublicKey = identity.publicKeyHex;

          try {
            await initializeClout();
            state.setIsVisitor(false);
            hideVisitorBanner();
            updateTabVisibility(false);
            return;
          } catch (initError) {
            console.warn('[Clout] Server init failed with browser identity:', initError.message);
          }
        }
      } catch (loadError) {
        console.warn('[Clout] Failed to load browser identity:', loadError);
      }
    }

    // Try legacy server identity
    try {
      await initializeClout();
      state.setIsVisitor(false);
      hideVisitorBanner();
      updateTabVisibility(false);
    } catch (initError) {
      // Enter visitor mode
      console.log('No existing identity, entering visitor mode');
      state.setIsVisitor(true);
      state.setInitialized(false);

      $('init-section').style.display = 'none';
      $('main-app').style.display = 'block';
      updateStatus('Visitor Mode', false);
      showVisitorBanner();
      updateTabVisibility(true);

      await loadVisitorFeed();
    }
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

  // Reaction Palette Settings
  renderPaletteEditor,
  editPaletteSlot,
  closePalettePicker,
  setPaletteEmoji,
  resetPalette,

  // Thread
  viewThread,

  // Trust
  trustUser: () => trustUser(requireMembership),
  quickTrust: (publicKey) => quickTrust(publicKey, requireMembership),
  muteUser: (publicKey, displayName) => muteUser(publicKey, displayName, requireMembership),
  unmuteUser,
  editNickname,

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

  // Identity
  switchIdentity,

  // Invite
  showInvitePopover,
  closeInvitePopover,
  redeemInvite,

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

  setupTabs();
  setupCharCounter();
  setupMediaUpload();
  setupSettings(requireMembership);

  // Event listeners
  $('init-btn').addEventListener('click', initializeClout);
  $('create-post-btn').addEventListener('click', () => createPost(requireMembership, showInvitePopover));
  $('trust-btn').addEventListener('click', () => trustUser(requireMembership));
  $('refresh-feed-btn').addEventListener('click', loadFeed);
  $('send-slide-btn').addEventListener('click', () => sendSlide(requireMembership));
  $('refresh-slides-btn').addEventListener('click', loadSlides);

  // Visitor banner - show invite popover
  $('visitor-join-btn').addEventListener('click', showInvitePopover);

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
