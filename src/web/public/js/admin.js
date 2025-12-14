/**
 * Admin Module - Member invitation management and user lookup
 */

import { apiCall } from './api.js';
import { $, escapeHtml, formatRelativeTime } from './ui.js';

// =========================================================================
// Member Invitation Functions
// =========================================================================

/**
 * Load member's quota status and invitations
 */
export async function loadMyInvitationStatus() {
  try {
    const data = await apiCall('/invitations/quota');

    if (!data) {
      return { hasQuota: false };
    }

    const { quotaRemaining, quotaTotal } = data;

    // Update UI
    $('my-quota-remaining').textContent = quotaRemaining;

    // Show the member section if they have quota
    if (quotaTotal > 0) {
      $('member-invites-section').style.display = 'block';
      await loadMyInvitations();
      return { hasQuota: true, remaining: quotaRemaining };
    }

    return { hasQuota: false };
  } catch (error) {
    console.warn('[Admin] Could not load invitation quota:', error.message);
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

    // Update quota display
    const remaining = data.quotaRemaining;
    $('my-quota-remaining').textContent = remaining === 'unlimited' ? '∞' : remaining;

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
