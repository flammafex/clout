/**
 * Admin Module - Instance owner administration and member invitation management
 */

import { apiCall } from './api.js';
import { $, escapeHtml, formatRelativeTime } from './ui.js';

// =========================================================================
// Owner Admin Functions
// =========================================================================

/**
 * Grant invitation quota to a member
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
    const result = await apiCall('/admin/quota/grant', 'POST', { publicKey, amount });

    resultEl.innerHTML = `Granted ${amount} invitations to <code>${result.data.publicKeyShort}...</code><br>` +
      `Total quota: ${result.data.quota}, Used: ${result.data.used}, Remaining: ${result.data.remaining}`;
    resultEl.className = 'result-message success';

    // Clear the input and refresh member list
    $('grant-quota-pubkey').value = '';
    await loadMembersWithQuota();
  } catch (error) {
    resultEl.textContent = `Failed: ${error.message}`;
    resultEl.className = 'result-message error';
  }
}

/**
 * Load all members with quota
 */
export async function loadMembersWithQuota() {
  const listEl = $('members-quota-list');

  try {
    const result = await apiCall('/admin/members');

    if (!result.data || result.data.count === 0) {
      listEl.innerHTML = '<p class="empty-state">No members with quota yet. Grant quota to members above.</p>';
      return;
    }

    const membersHtml = result.data.members.map(member => `
      <div class="member-item">
        <div class="member-info">
          <span class="member-name">${escapeHtml(member.displayName || 'Anonymous')}</span>
          <code class="member-key">${member.publicKeyShort}...</code>
        </div>
        <div class="member-quota">
          <span class="quota-used">${member.used}/${member.quota} used</span>
          <span class="quota-remaining">(${member.remaining} remaining)</span>
        </div>
      </div>
    `).join('');

    listEl.innerHTML = membersHtml;
  } catch (error) {
    listEl.innerHTML = `<p class="empty-state error">Failed to load: ${escapeHtml(error.message)}</p>`;
  }
}

/**
 * Create admin invitations (bypasses quota)
 */
export async function createAdminInvitations() {
  const count = parseInt($('create-invites-count').value, 10);
  const expiresInDays = parseInt($('create-invites-days').value, 10);
  const resultEl = $('create-invites-result');
  const codesDisplay = $('created-codes-display');
  const codesList = $('created-codes-list');

  if (isNaN(count) || count < 1 || count > 100) {
    resultEl.textContent = 'Count must be between 1 and 100';
    resultEl.className = 'result-message error';
    return;
  }

  if (isNaN(expiresInDays) || expiresInDays < 1 || expiresInDays > 365) {
    resultEl.textContent = 'Days must be between 1 and 365';
    resultEl.className = 'result-message error';
    return;
  }

  try {
    resultEl.textContent = 'Creating invitations...';
    resultEl.className = 'result-message';

    const result = await apiCall('/admin/invitations', 'POST', { count, expiresInDays });

    resultEl.textContent = `Created ${result.data.count} invitation(s)`;
    resultEl.className = 'result-message success';

    // Display the codes
    codesList.innerHTML = result.data.codes.map(code => `
      <div class="code-item">
        <code>${escapeHtml(code)}</code>
        <button class="btn btn-tiny" onclick="window.cloutApp.copySingleCode('${code}')">Copy</button>
      </div>
    `).join('');
    codesDisplay.style.display = 'block';

    // Store codes for copy all
    window._createdCodes = result.data.codes;

    // Refresh invitations list
    await loadAllInvitations();
  } catch (error) {
    resultEl.textContent = `Failed: ${error.message}`;
    resultEl.className = 'result-message error';
  }
}

/**
 * Copy a single invitation code
 */
export function copySingleCode(code) {
  navigator.clipboard.writeText(code);
}

/**
 * Copy all created invitation codes
 */
export function copyAllCodes() {
  if (window._createdCodes) {
    navigator.clipboard.writeText(window._createdCodes.join('\n'));
  }
}

/**
 * Load all invitations (admin view)
 */
export async function loadAllInvitations() {
  const listEl = $('all-invitations-list');

  try {
    const result = await apiCall('/admin/invitations');

    if (!result.data || result.data.count === 0) {
      listEl.innerHTML = '<p class="empty-state">No invitations created yet.</p>';
      return;
    }

    const invitationsHtml = result.data.invitations.map(inv => {
      const statusClass = inv.redeemed ? 'redeemed' : (inv.isExpired ? 'expired' : 'active');
      const statusText = inv.redeemed ? 'Redeemed' : (inv.isExpired ? 'Expired' : 'Active');

      return `
        <div class="invitation-item ${statusClass}">
          <div class="invitation-code">
            <code>${escapeHtml(inv.code.slice(0, 8))}...</code>
            <span class="invitation-status ${statusClass}">${statusText}</span>
          </div>
          <div class="invitation-meta">
            <span class="invitation-creator">By: ${escapeHtml(inv.creatorDisplayName || inv.creatorShort + '...')}</span>
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

// =========================================================================
// Member Invitation Functions
// =========================================================================

/**
 * Load member's quota status and invitations
 */
export async function loadMyInvitationStatus() {
  try {
    const result = await apiCall('/invitations/quota');

    if (!result.data) {
      return { hasQuota: false };
    }

    const { quotaRemaining, quotaTotal } = result.data;

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
    const result = await apiCall('/invitations/mine');

    if (!result.data || result.data.count === 0) {
      listEl.innerHTML = '<p class="empty-state">You haven\'t created any invitations yet.</p>';
      return;
    }

    const invitationsHtml = result.data.invitations.map(inv => {
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

    const result = await apiCall('/invitations/create', 'POST', { expiresInDays: 30 });

    resultEl.textContent = '';
    codeEl.textContent = result.data.code;
    codeDisplay.style.display = 'block';

    // Update quota display
    const remaining = result.data.quotaRemaining;
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
