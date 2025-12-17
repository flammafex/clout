/**
 * Invite Module - Invitation handling and onboarding
 *
 * Handles:
 * - Invite popover display
 * - Invitation redemption
 * - Identity backup prompts
 */

import * as state from './state.js';
import { apiCall } from './api.js';
import { $, updateStatus, startDayPassTimer } from './ui.js';
import { loadFeed } from './feed.js';
import { loadIdentity, loadProfile } from './profile.js';
import { loadSlides } from './slides.js';
import { connectLiveUpdates, updateNotificationCounts } from './notifications.js';

/**
 * Show invite popover
 */
export function showInvitePopover() {
  $('invite-popover').style.display = 'flex';
  $('invite-code-input').value = '';
  $('invite-result').textContent = '';
  $('invite-result').className = 'result-message';
}

/**
 * Close invite popover
 */
export function closeInvitePopover() {
  $('invite-popover').style.display = 'none';
}

/**
 * Redeem an invitation code
 */
export async function redeemInvite() {
  const code = $('invite-code-input').value.trim();

  if (!code) {
    $('invite-result').textContent = 'Please enter an invitation code';
    $('invite-result').className = 'result-message error';
    return;
  }

  if (!window.CloutCrypto || !window.CloutIdentity) {
    $('invite-result').textContent = 'Crypto modules not loaded. Please refresh the page.';
    $('invite-result').className = 'result-message error';
    return;
  }

  try {
    $('redeem-invite-btn').disabled = true;
    $('redeem-invite-btn').textContent = 'Checking...';

    // Step 1: Decode invitation
    $('invite-result').textContent = 'Validating invitation...';
    $('invite-result').className = 'result-message';

    const decodeResult = await apiCall('/invitation/decode', 'POST', { code });
    const inviterPubkey = decodeResult.hasInviter ? decodeResult.inviter : null;

    // Step 2: Generate identity in browser
    $('invite-result').textContent = 'Creating your identity...';
    $('redeem-invite-btn').textContent = 'Creating Identity...';

    let identity = await window.CloutIdentity.load();
    if (!identity) {
      identity = window.CloutIdentity.generate();
      await window.CloutIdentity.store(identity);
      console.log('[Clout] New identity created:', identity.publicKeyHex.slice(0, 16) + '...');
    } else {
      console.log('[Clout] Using existing identity:', identity.publicKeyHex.slice(0, 16) + '...');
    }

    window.browserIdentity = identity;
    window.userPublicKey = identity.publicKeyHex;

    // Step 3: Redeem the invitation
    $('invite-result').textContent = 'Redeeming invitation...';
    $('redeem-invite-btn').textContent = 'Redeeming...';

    const redeemResult = await apiCall('/invitation/redeem', 'POST', {
      code,
      publicKey: identity.publicKeyHex
    });

    // Step 4: Initialize server
    $('invite-result').textContent = 'Initializing network connection...';
    $('redeem-invite-btn').textContent = 'Connecting...';

    await apiCall('/init', 'POST');

    // Step 5: Get Day Pass for THIS browser identity
    $('invite-result').textContent = 'Getting your Day Pass...';
    $('redeem-invite-btn').textContent = 'Getting Day Pass...';

    // Request Day Pass using the invitation code
    let ticketExpiry = null;
    if (window.CloutDayPass) {
      try {
        const dayPass = await window.CloutDayPass.requestDayPass(identity.publicKey, {
          invitationCode: code
        });
        ticketExpiry = dayPass.expiry;
        console.log('[Clout] Day Pass obtained, expires:', new Date(ticketExpiry).toLocaleString());
      } catch (dayPassError) {
        console.warn('[Clout] Failed to get Day Pass:', dayPassError.message);
        // Continue anyway - they can get a Day Pass when they try to post
      }
    }

    // Step 6: Create trust signal for inviter
    if (inviterPubkey && inviterPubkey !== identity.publicKeyHex) {
      $('invite-result').textContent = 'Establishing trust with your inviter...';
      $('redeem-invite-btn').textContent = 'Building Trust...';

      try {
        const timestamp = Date.now();
        const weight = 1.0;

        const trustSignal = window.CloutCrypto.createEncryptedTrustSignal(
          identity.privateKey,
          identity.publicKeyHex,
          inviterPubkey,
          weight,
          timestamp
        );

        await apiCall('/trust/submit', 'POST', {
          truster: identity.publicKeyHex,
          trusteeCommitment: trustSignal.trusteeCommitment,
          encryptedTrustee: {
            ephemeralPublicKey: window.CloutCrypto.toHex(trustSignal.encryptedTrustee.ephemeralPublicKey),
            ciphertext: window.CloutCrypto.toHex(trustSignal.encryptedTrustee.ciphertext)
          },
          signature: window.CloutCrypto.toHex(trustSignal.signature),
          weight,
          timestamp
        });

        console.log('[Clout] Created mutual trust with inviter:', inviterPubkey.slice(0, 16) + '...');
      } catch (trustError) {
        console.warn('[Clout] Failed to create trust signal for inviter:', trustError);
      }
    }

    // Step 7: Transition to member
    state.setInitialized(true);
    state.setIsVisitor(false);
    state.setPendingInviteCode(code);

    $('init-section').style.display = 'none';
    $('main-app').style.display = 'block';
    $('visitor-banner').style.display = 'none'; // Hide visitor banner

    // Show all member tabs
    ['post', 'trust', 'slides', 'profile', 'settings'].forEach(tabName => {
      const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
      if (tabBtn) tabBtn.style.display = '';
    });

    updateStatus('Connected', true);

    // Only show Day Pass timer if we obtained one
    if (ticketExpiry) {
      startDayPassTimer(ticketExpiry);
    }

    $('invite-result').textContent = '&#x1F389; Welcome to Clout! Your identity has been created.';
    $('invite-result').className = 'result-message success';

    // Prompt for backup
    setTimeout(() => {
      if (confirm('Would you like to backup your identity now? This is important - your identity lives only in this browser!')) {
        promptIdentityBackup();
      }
    }, 2000);

    // Load member data
    setTimeout(async () => {
      closeInvitePopover();

      await loadFeed();
      await loadIdentity();
      await loadProfile();
      loadSlides().catch(() => {});
      connectLiveUpdates();
      updateNotificationCounts();
      setInterval(updateNotificationCounts, 30000);
    }, 1500);
  } catch (error) {
    $('invite-result').textContent = error.message;
    $('invite-result').className = 'result-message error';
  } finally {
    $('redeem-invite-btn').disabled = false;
    $('redeem-invite-btn').textContent = 'Join Network';
  }
}

/**
 * Prompt user to backup their identity
 */
export async function promptIdentityBackup() {
  const password = prompt('Enter a password to encrypt your identity backup:');
  if (!password) return;

  const confirmPassword = prompt('Confirm your password:');
  if (password !== confirmPassword) {
    alert('Passwords do not match. Please try again from Profile > Backup Identity.');
    return;
  }

  try {
    const identity = await window.CloutIdentity.load();
    if (identity) {
      await window.CloutIdentity.downloadBackup(identity, password);
      alert('Identity backup downloaded! Keep this file safe - you can use it to restore your identity on another device.');
    }
  } catch (error) {
    alert('Failed to create backup: ' + error.message);
  }
}

/**
 * Show restore identity popover
 */
export function showRestorePopover() {
  $('restore-popover').style.display = 'flex';
  $('restore-file-input').value = '';
  $('restore-password-input').value = '';
  $('restore-result').textContent = '';
  $('restore-result').className = 'result-message';
}

/**
 * Close restore identity popover
 */
export function closeRestorePopover() {
  $('restore-popover').style.display = 'none';
}

/**
 * Restore identity from backup file
 */
export async function restoreFromFile() {
  const fileInput = $('restore-file-input');
  const passwordInput = $('restore-password-input');
  const resultEl = $('restore-result');
  const restoreBtn = $('restore-file-btn');

  if (!fileInput.files || fileInput.files.length === 0) {
    resultEl.textContent = 'Please select a backup file';
    resultEl.className = 'result-message error';
    return;
  }

  const file = fileInput.files[0];
  const password = passwordInput.value;

  if (!password) {
    resultEl.textContent = 'Please enter your backup password';
    resultEl.className = 'result-message error';
    return;
  }

  if (!window.CloutIdentity) {
    resultEl.textContent = 'Identity module not loaded. Please refresh the page.';
    resultEl.className = 'result-message error';
    return;
  }

  try {
    restoreBtn.disabled = true;
    restoreBtn.textContent = 'Restoring...';
    resultEl.textContent = 'Decrypting backup...';
    resultEl.className = 'result-message';

    const identity = await window.CloutIdentity.importFromFile(file, password);
    await window.CloutIdentity.store(identity);

    // Restore all user data
    if (identity.userData && window.CloutUserData) {
      resultEl.textContent = 'Restoring user data...';
      await window.CloutUserData.importAll(identity.userData);
    }

    await completeIdentityRestore(identity, resultEl);
  } catch (error) {
    resultEl.textContent = error.message;
    resultEl.className = 'result-message error';
  } finally {
    restoreBtn.disabled = false;
    restoreBtn.textContent = 'Restore from File';
  }
}

/**
 * Complete the identity restore process
 * Check Day Pass status and transition to member or prompt for invite
 */
async function completeIdentityRestore(identity, resultEl) {
  window.browserIdentity = identity;
  window.userPublicKey = identity.publicKeyHex;

  resultEl.textContent = 'Checking Day Pass status...';

  // Check if this identity has a valid Day Pass
  let hasValidDayPass = false;
  let ticketExpiry = null;
  let isRegistered = false;

  try {
    const dayPassStatus = await apiCall(`/daypass/status/${identity.publicKeyHex}`);
    hasValidDayPass = dayPassStatus.hasTicket && !dayPassStatus.isExpired;
    isRegistered = dayPassStatus.isRegistered || false;
    if (hasValidDayPass) {
      ticketExpiry = dayPassStatus.expiry;
    }
  } catch (e) {
    console.warn('[Restore] Failed to check Day Pass status:', e.message);
  }

  if (hasValidDayPass) {
    // Identity restored with valid Day Pass - fully activate
    resultEl.textContent = 'Identity restored! Activating session...';

    state.setInitialized(true);
    state.setIsVisitor(false);

    $('init-section').style.display = 'none';
    $('main-app').style.display = 'block';
    $('visitor-banner').style.display = 'none';

    // Show all member tabs
    ['post', 'trust', 'slides', 'profile', 'settings'].forEach(tabName => {
      const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
      if (tabBtn) tabBtn.style.display = '';
    });

    updateStatus('Connected', true);

    if (ticketExpiry) {
      startDayPassTimer(ticketExpiry);
    }

    resultEl.textContent = 'Identity restored successfully!';
    resultEl.className = 'result-message success';

    // Load member data
    setTimeout(async () => {
      closeRestorePopover();
      await loadFeed();
      await loadIdentity();
      await loadProfile();
      loadSlides().catch(() => {});
      connectLiveUpdates();
      updateNotificationCounts();
      setInterval(updateNotificationCounts, 30000);
    }, 1500);
  } else if (isRegistered) {
    // Identity restored with expired Day Pass but user is registered - auto-renew
    resultEl.textContent = 'Identity restored! Renewing Day Pass...';
    resultEl.className = 'result-message success';

    setTimeout(async () => {
      closeRestorePopover();
      // Try to renew Day Pass without invitation code
      await renewDayPass(identity);
    }, 1500);
  } else {
    // Identity restored but no valid Day Pass - need invitation code
    resultEl.textContent = 'Identity restored! You need an invitation code to activate your Day Pass.';
    resultEl.className = 'result-message success';

    // Close restore popover and show invite popover after a delay
    setTimeout(() => {
      closeRestorePopover();
      showInvitePopover();
    }, 2000);
  }
}

/**
 * Renew Day Pass for a registered user (no invitation code needed)
 */
async function renewDayPass(identity) {
  const statusEl = $('member-status');
  const originalText = statusEl?.textContent || '';

  try {
    if (statusEl) {
      statusEl.textContent = 'Renewing Day Pass...';
      statusEl.className = 'status-badge renewing';
    }

    // Request Day Pass without invitation code - backend will use registered mode
    if (!window.CloutDayPass) {
      throw new Error('Day Pass module not loaded');
    }

    const dayPass = await window.CloutDayPass.requestDayPass(identity.publicKey, {
      // No invitation code needed for registered users
    });

    console.log('[Clout] Day Pass renewed, expires:', new Date(dayPass.expiry).toLocaleString());

    // Activate the session
    state.setInitialized(true);
    state.setIsVisitor(false);

    $('init-section').style.display = 'none';
    $('main-app').style.display = 'block';
    $('visitor-banner').style.display = 'none';

    // Show all member tabs
    ['post', 'trust', 'slides', 'profile', 'settings'].forEach(tabName => {
      const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
      if (tabBtn) tabBtn.style.display = '';
    });

    updateStatus('Connected', true);
    startDayPassTimer(dayPass.expiry);

    // Load member data
    await loadFeed();
    await loadIdentity();
    await loadProfile();
    loadSlides().catch(() => {});
    connectLiveUpdates();
    updateNotificationCounts();
    setInterval(updateNotificationCounts, 30000);

  } catch (error) {
    console.error('[Clout] Day Pass renewal failed:', error);

    if (statusEl) {
      statusEl.textContent = originalText;
      statusEl.className = 'status-badge';
    }

    // Show error and fall back to invitation code prompt
    alert('Day Pass renewal failed: ' + error.message + '\n\nYou may need to enter an invitation code.');
    showInvitePopover();
  }
}
