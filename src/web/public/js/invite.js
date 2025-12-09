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
    alert('Passwords do not match. Please try again from Profile > Export Identity.');
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
