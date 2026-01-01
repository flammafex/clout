/**
 * Admin Module - Member invitation management and user lookup
 *
 * Security: Admin operations require cryptographic proof of ownership.
 * The browser signs a challenge payload before sending to the server.
 */

import { apiCall } from './api.js';
import { $, escapeHtml, formatRelativeTime } from './ui.js';

/**
 * Sign an admin request with the browser identity
 * Returns signature and timestamp for server verification
 */
async function signAdminRequest(operation) {
  if (!window.CloutIdentity || !window.CloutCrypto) {
    throw new Error('Browser identity module not loaded');
  }

  const identity = await window.CloutIdentity.load();
  if (!identity) {
    throw new Error('No browser identity found. Please create or restore an identity first.');
  }

  const Crypto = window.CloutCrypto;
  const timestamp = Date.now();

  // Create signature payload: "admin:{operation}:{publicKey}:{timestamp}"
  const signaturePayload = `admin:${operation}:${identity.publicKeyHex}:${timestamp}`;
  const payloadBytes = new TextEncoder().encode(signaturePayload);

  // Sign with private key
  const signature = Crypto.sign(payloadBytes, identity.privateKey);
  const signatureHex = Crypto.toHex(signature);

  return {
    userPublicKey: identity.publicKeyHex,
    adminSignature: signatureHex,
    adminTimestamp: timestamp
  };
}

// =========================================================================
// Member Invitation Functions
// =========================================================================

/**
 * Update the settings tab badge based on quota status
 */
export function updateSettingsBadge(hasQuota, remaining = 0) {
  const badge = $('settings-badge');
  if (!badge) return;

  if (hasQuota && remaining > 0) {
    badge.textContent = remaining;
    badge.style.display = 'inline';
  } else {
    badge.style.display = 'none';
  }
}

/**
 * Load member's quota status and invitations
 */
export async function loadMyInvitationStatus() {
  try {
    const data = await apiCall('/invitations/quota');

    if (!data) {
      updateSettingsBadge(false);
      return { hasQuota: false };
    }

    const { quotaRemaining, quotaTotal } = data;

    // Update UI
    $('my-quota-remaining').textContent = quotaRemaining;

    // Show the member section if they have quota
    if (quotaTotal > 0) {
      $('member-invites-section').style.display = 'block';
      updateSettingsBadge(true, quotaRemaining);
      await loadMyInvitations();
      return { hasQuota: true, remaining: quotaRemaining };
    }

    updateSettingsBadge(false);
    return { hasQuota: false };
  } catch (error) {
    console.warn('[Admin] Could not load invitation quota:', error.message);
    updateSettingsBadge(false);
    return { hasQuota: false };
  }
}

/**
 * Load member's own invitations
 */
export async function loadMyInvitations() {
  const listEl = $('my-invitations-list');

  try {
    const data = await apiCall('/invitations/mine');

    if (!data || data.count === 0) {
      listEl.innerHTML = '<p class="empty-state">You haven\'t created any invitations yet.</p>';
      return;
    }

    const invitationsHtml = data.invitations.map(inv => {
      const statusClass = inv.redeemed ? 'redeemed' : (inv.isExpired ? 'expired' : 'active');
      const statusText = inv.redeemed ? 'Redeemed' : (inv.isExpired ? 'Expired' : 'Active');

      return `
        <div class="invitation-item ${statusClass}">
          <div class="invitation-code">
            <code>${escapeHtml(inv.code.slice(0, 8))}...</code>
            <span class="invitation-status ${statusClass}">${statusText}</span>
          </div>
          <div class="invitation-meta">
            <span class="invitation-created">${formatRelativeTime(inv.createdAt)}</span>
            ${inv.redeemed ? `<span class="invitation-redeemer">Used by: ${escapeHtml(inv.redeemerDisplayName || inv.redeemerShort + '...')}</span>` : ''}
          </div>
        </div>
      `;
    }).join('');

    listEl.innerHTML = invitationsHtml;
  } catch (error) {
    listEl.innerHTML = `<p class="empty-state error">Failed to load: ${escapeHtml(error.message)}</p>`;
  }
}

/**
 * Create an invitation using member's quota
 */
export async function createMemberInvitation() {
  const resultEl = $('member-invite-result');
  const codeDisplay = $('member-created-code');
  const codeEl = $('member-invite-code');

  try {
    resultEl.textContent = 'Creating invitation...';
    resultEl.className = 'result-message';
    codeDisplay.style.display = 'none';

    const data = await apiCall('/invitations/create', 'POST', { expiresInDays: 30 });

    resultEl.textContent = '';
    codeEl.textContent = data.code;
    codeDisplay.style.display = 'block';

    // Update quota display and badge
    const remaining = data.quotaRemaining;
    $('my-quota-remaining').textContent = remaining === 'unlimited' ? '∞' : remaining;
    updateSettingsBadge(true, remaining === 'unlimited' ? 99 : remaining);

    // Refresh invitations list
    await loadMyInvitations();
  } catch (error) {
    resultEl.textContent = `Failed: ${error.message}`;
    resultEl.className = 'result-message error';
  }
}

/**
 * Copy member's created invitation code
 */
export function copyMemberCode() {
  const code = $('member-invite-code').textContent;
  navigator.clipboard.writeText(code);
}

// =========================================================================
// Owner Admin Functions - Members & Quota Management
// =========================================================================

/**
 * Load all members with quota (owner only)
 */
export async function loadAdminMembers() {
  const listEl = $('admin-members-list');

  try {
    listEl.innerHTML = '<p class="loading">Loading members...</p>';

    const data = await apiCall('/admin/members');

    if (!data || data.count === 0) {
      listEl.innerHTML = '<p class="empty-state">No members with quota yet.</p>';
      return;
    }

    const membersHtml = data.members.map(member => {
      return `
        <div class="admin-list-item member-item">
          <div class="member-info">
            <span class="member-name">${escapeHtml(member.displayName || 'Anonymous')}</span>
            <code class="member-key">${member.publicKeyShort}...</code>
          </div>
          <div class="member-quota">
            <span class="quota-badge ${member.remaining > 0 ? 'has-quota' : 'no-quota'}">
              ${member.remaining}/${member.quota} remaining
            </span>
            <button class="btn btn-small" onclick="window.cloutApp.prefillGrantQuota('${member.publicKey}')">Grant More</button>
          </div>
        </div>
      `;
    }).join('');

    listEl.innerHTML = membersHtml;
  } catch (error) {
    listEl.innerHTML = `<p class="empty-state error">Failed to load: ${escapeHtml(error.message)}</p>`;
  }
}

/**
 * Pre-fill the grant quota form with a member's public key
 */
export function prefillGrantQuota(publicKey) {
  $('grant-quota-pubkey').value = publicKey;
  $('grant-quota-pubkey').focus();
}

/**
 * Grant quota to a member (owner only)
 * Requires signed admin request for security
 */
export async function grantQuota() {
  const publicKey = $('grant-quota-pubkey').value.trim();
  const amount = parseInt($('grant-quota-amount').value, 10);
  const resultEl = $('grant-quota-result');

  if (!publicKey) {
    resultEl.textContent = 'Please enter a public key';
    resultEl.className = 'result-message error';
    return;
  }

  if (publicKey.length !== 64 || !/^[a-fA-F0-9]+$/.test(publicKey)) {
    resultEl.textContent = 'Invalid public key format (must be 64 hex characters)';
    resultEl.className = 'result-message error';
    return;
  }

  if (isNaN(amount) || amount < 1 || amount > 100) {
    resultEl.textContent = 'Amount must be between 1 and 100';
    resultEl.className = 'result-message error';
    return;
  }

  try {
    resultEl.textContent = 'Signing request...';
    resultEl.className = 'result-message';

    // Sign the admin request
    const authParams = await signAdminRequest('quota/grant');

    resultEl.textContent = 'Granting quota...';

    const data = await apiCall('/admin/quota/grant', 'POST', {
      publicKey,
      amount,
      ...authParams
    });

    const syncStatus = data.freebirdSynced ? '(synced with Freebird)' : '(local only)';
    resultEl.innerHTML = `
      <span class="success">Granted ${amount} invites to ${escapeHtml(data.displayName || data.publicKeyShort + '...')}</span>
      <span class="sync-status">${syncStatus}</span>
      <br>New total: ${data.quota} (${data.remaining} remaining)
    `;
    resultEl.className = 'result-message success';

    // Clear the form
    $('grant-quota-pubkey').value = '';

    // Refresh members list
    await loadAdminMembers();
  } catch (error) {
    resultEl.textContent = `Failed: ${error.message}`;
    resultEl.className = 'result-message error';
  }
}

/**
 * Create invitations as owner
 * Requires signed admin request for security
 */
export async function ownerCreateInvitations() {
  const count = parseInt($('owner-invite-count').value, 10) || 1;
  const days = parseInt($('owner-invite-days').value, 10) || 30;
  const resultEl = $('owner-invite-result');
  const codesDisplay = $('owner-created-codes');
  const codesListEl = $('owner-invite-codes-list');

  if (count < 1 || count > 100) {
    resultEl.textContent = 'Count must be between 1 and 100';
    resultEl.className = 'result-message error';
    return;
  }

  if (days < 1 || days > 365) {
    resultEl.textContent = 'Days must be between 1 and 365';
    resultEl.className = 'result-message error';
    return;
  }

  try {
    resultEl.textContent = 'Signing request...';
    resultEl.className = 'result-message';
    codesDisplay.style.display = 'none';

    // Sign the admin request
    const authParams = await signAdminRequest('invitations/create');

    resultEl.textContent = `Creating ${count} invitation(s)...`;

    const data = await apiCall('/admin/invitations', 'POST', {
      count,
      expiresInDays: days,
      ...authParams
    });

    if (!data.invitations || data.invitations.length === 0) {
      resultEl.textContent = 'No invitations created';
      resultEl.className = 'result-message error';
      return;
    }

    resultEl.textContent = `Created ${data.invitations.length} invitation(s)`;
    resultEl.className = 'result-message success';

    // Display the codes
    const codesHtml = data.invitations.map(inv => `
      <div class="code-item">
        <code>${escapeHtml(inv.code)}</code>
        <button class="btn btn-small" onclick="navigator.clipboard.writeText('${escapeHtml(inv.code)}')">Copy</button>
      </div>
    `).join('');

    codesListEl.innerHTML = codesHtml;
    codesDisplay.style.display = 'block';

    // Refresh invitations list
    await loadAdminInvitations();
  } catch (error) {
    resultEl.textContent = `Failed: ${error.message}`;
    resultEl.className = 'result-message error';
  }
}

/**
 * Load all invitations (owner only)
 */
export async function loadAdminInvitations() {
  const listEl = $('admin-invitations-list');

  try {
    listEl.innerHTML = '<p class="loading">Loading invitations...</p>';

    const data = await apiCall('/admin/invitations');

    if (!data || data.count === 0) {
      listEl.innerHTML = '<p class="empty-state">No invitations created yet.</p>';
      return;
    }

    const invitationsHtml = data.invitations.map(inv => {
      const statusClass = inv.redeemed ? 'redeemed' : (inv.isExpired ? 'expired' : 'active');
      const statusText = inv.redeemed ? 'Redeemed' : (inv.isExpired ? 'Expired' : 'Active');

      return `
        <div class="admin-list-item invitation-item ${statusClass}">
          <div class="invitation-info">
            <code class="invitation-code">${escapeHtml(inv.code.slice(0, 12))}...</code>
            <span class="invitation-status ${statusClass}">${statusText}</span>
          </div>
          <div class="invitation-details">
            <span class="invitation-creator">By: ${escapeHtml(inv.creatorDisplayName || inv.creatorShort + '...')}</span>
            <span class="invitation-date">${formatRelativeTime(inv.createdAt)}</span>
            ${inv.redeemed ? `<span class="invitation-redeemer">→ ${escapeHtml(inv.redeemerDisplayName || inv.redeemerShort + '...')}</span>` : ''}
          </div>
        </div>
      `;
    }).join('');

    listEl.innerHTML = invitationsHtml;
  } catch (error) {
    listEl.innerHTML = `<p class="empty-state error">Failed to load: ${escapeHtml(error.message)}</p>`;
  }
}

// =========================================================================
// User Lookup (for finding invitation codes to revoke in Freebird)
// =========================================================================

/**
 * Lookup user by public key - find which invitation they used
 */
export async function lookupUser() {
  const publicKey = $('lookup-user-pubkey').value.trim();
  const resultEl = $('lookup-user-result');

  if (!publicKey) {
    resultEl.textContent = 'Please enter a public key';
    resultEl.className = 'result-message error';
    return;
  }

  if (publicKey.length !== 64 || !/^[a-fA-F0-9]+$/.test(publicKey)) {
    resultEl.textContent = 'Invalid public key format (must be 64 hex characters)';
    resultEl.className = 'result-message error';
    return;
  }

  try {
    resultEl.textContent = 'Looking up user...';
    resultEl.className = 'result-message';

    const data = await apiCall(`/admin/user-lookup?publicKey=${publicKey}`);

    if (!data) {
      resultEl.textContent = 'Lookup failed';
      resultEl.className = 'result-message error';
      return;
    }

    if (!data.invitationCode) {
      resultEl.innerHTML = `
        <div class="lookup-result">
          <div class="lookup-field"><strong>Public Key:</strong> <code>${data.publicKeyShort}...</code></div>
          <div class="lookup-field"><strong>Display Name:</strong> ${escapeHtml(data.displayName || 'Anonymous')}</div>
          <div class="lookup-field warning">${escapeHtml(data.message || 'No invitation found')}</div>
        </div>
      `;
      resultEl.className = 'result-message warning';
      return;
    }

    const redeemedDate = data.redeemedAt ? new Date(data.redeemedAt).toLocaleString() : 'Unknown';

    resultEl.innerHTML = `
      <div class="lookup-result">
        <div class="lookup-field"><strong>Public Key:</strong> <code>${data.publicKeyShort}...</code></div>
        <div class="lookup-field"><strong>Display Name:</strong> ${escapeHtml(data.displayName || 'Anonymous')}</div>
        <div class="lookup-field"><strong>Invitation Code:</strong> <code>${escapeHtml(data.invitationCode)}</code></div>
        <div class="lookup-field"><strong>Invited By:</strong> ${escapeHtml(data.invitedByName || data.invitedByShort + '...')}</div>
        <div class="lookup-field"><strong>Joined:</strong> ${redeemedDate}</div>
        <div class="lookup-field"><strong>Source:</strong> ${data.source === 'bootstrap_invitation' ? 'Bootstrap Invitation' : 'Member Invitation'}</div>
      </div>
      <p class="lookup-hint">Use this invitation code in Freebird Admin UI to revoke access.</p>
    `;
    resultEl.className = 'result-message success';
  } catch (error) {
    resultEl.textContent = `Failed: ${error.message}`;
    resultEl.className = 'result-message error';
  }
}
