/**
 * UI Module - DOM helpers and utility functions
 *
 * Provides common UI utilities used across the app.
 */

import * as state from './state.js';

// DOM selectors
export const $ = (id) => document.getElementById(id);
export const $$ = (selector) => document.querySelectorAll(selector);

/**
 * Show loading spinner in a container
 */
export function showLoading(containerId) {
  const container = $(containerId);
  if (container) {
    container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><span>Loading...</span></div>';
  }
}

/**
 * Show result message (success or error)
 */
export function showResult(elementId, message, isSuccess) {
  const el = $(elementId);
  if (!el) return;
  el.textContent = message;
  el.className = `result-message ${isSuccess ? 'success' : 'error'}`;
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 5000);
}

/**
 * Update status indicator
 */
export function updateStatus(text, active = false) {
  $('status-text').textContent = text;
  const dot = $('status-indicator');
  if (active) {
    dot.classList.add('active');
  } else {
    dot.classList.remove('active');
  }
}

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Format relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(timestamp) {
  const now = Date.now();
  const date = new Date(timestamp).getTime();
  const diff = now - date;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (weeks < 4) return `${weeks}w ago`;
  if (months < 12) return `${months}mo ago`;
  return `${years}y ago`;
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Render avatar - handles both URLs and emojis
 */
export function renderAvatar(avatar) {
  if (!avatar) return '&#x1F464;'; // 👤
  // Handle absolute URLs (http/https) and relative URLs (starting with /)
  if (avatar.startsWith('http://') || avatar.startsWith('https://') || avatar.startsWith('/')) {
    return `<img src="${escapeHtml(avatar)}" alt="avatar" class="avatar-img" onerror="this.outerHTML='&#x1F464;'">`;
  }
  return escapeHtml(avatar);
}

/**
 * Get color for reputation score
 */
export function getReputationColor(score) {
  if (score >= 0.8) return '#22c55e'; // green
  if (score >= 0.6) return '#84cc16'; // lime
  if (score >= 0.4) return '#eab308'; // yellow
  if (score >= 0.2) return '#f97316'; // orange
  return '#ef4444'; // red
}

/**
 * Get human-readable label for trust weight
 */
export function getWeightLabel(weight) {
  if (weight >= 0.9) return 'Full Trust';
  if (weight >= 0.7) return 'High Trust';
  if (weight >= 0.5) return 'Medium Trust';
  if (weight >= 0.3) return 'Low Trust';
  return 'Minimal Trust';
}

/**
 * Copy text to clipboard
 */
export function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    alert('Copied to clipboard!');
  });
}

/**
 * Switch to a specific tab
 */
export function switchToTab(tabName) {
  const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (tabBtn) tabBtn.click();
}

/**
 * Day pass countdown timer
 */
export function startDayPassTimer(expiryTimestamp) {
  if (!expiryTimestamp) {
    $('day-pass-timer').style.display = 'none';
    state.clearDayPassInterval();
    return;
  }

  state.setDayPassEndTime(expiryTimestamp);
  $('day-pass-timer').style.display = 'flex';
  updateDayPassCountdown();

  state.clearDayPassInterval();
  state.setDayPassInterval(setInterval(updateDayPassCountdown, 1000));
}

function updateDayPassCountdown() {
  const now = Date.now();
  const remaining = state.dayPassEndTime - now;

  if (remaining <= 0) {
    $('day-pass-countdown').textContent = 'Expired';
    state.clearDayPassInterval();
    return;
  }

  const hours = Math.floor(remaining / (1000 * 60 * 60));
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((remaining % (1000 * 60)) / 1000);

  $('day-pass-countdown').textContent =
    `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Check if user is a member. If not, show invite popup.
 */
export function requireMembership(showInvitePopover) {
  if (!state.initialized || state.isVisitor) {
    showInvitePopover();
    return false;
  }
  return true;
}

/**
 * Check if an error indicates invitation/Day Pass is required
 */
export function isInvitationRequiredError(error) {
  // Check error code first (set by api.js)
  if (error.code === 'NO_DAYPASS' || error.code === 'INVITATION_REQUIRED') {
    return true;
  }
  // Fallback to message content check
  const msg = error.message?.toLowerCase() || '';
  return msg.includes('invitation') ||
         msg.includes('invite') ||
         msg.includes('sybil') ||
         msg.includes('day pass') ||
         msg.includes('daypass') ||
         msg.includes('no valid');
}

/**
 * Render text-only markdown (no images, no raw HTML)
 * Supports: **bold**, *italic*, `code`, ~~strikethrough~~, [links](url), > blockquotes, line breaks
 *
 * @param {string} text - Already HTML-escaped text
 * @returns {string} - HTML with markdown formatting applied
 */
export function renderMarkdown(text) {
  if (!text) return '';

  let html = text;

  // Code blocks (``` ... ```) - must come before inline code
  // Match triple backticks with optional language identifier
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code class="code-block${lang ? ` lang-${lang}` : ''}">${code.trim()}</code></pre>`;
  });

  // Inline code (`code`) - use negative lookbehind/lookahead to avoid matching inside code blocks
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Bold (**text** or __text__)
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

  // Italic (*text* or _text_) - be careful not to match inside words
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  html = html.replace(/(?<![a-zA-Z0-9])_([^_\n]+)_(?![a-zA-Z0-9])/g, '<em>$1</em>');

  // Strikethrough (~~text~~)
  html = html.replace(/~~([^~]+)~~/g, '<s>$1</s>');

  // Links [text](url) - only allow http/https URLs for safety
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Blockquotes (> text) - handle at start of line
  html = html.replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>');
  // Merge consecutive blockquotes
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');

  // Line breaks - convert newlines to <br> (but not inside <pre> blocks)
  // First, protect pre blocks
  const preBlocks = [];
  html = html.replace(/<pre><code[^>]*>[\s\S]*?<\/code><\/pre>/g, (match) => {
    preBlocks.push(match);
    return `__PRE_BLOCK_${preBlocks.length - 1}__`;
  });

  // Convert newlines to <br>
  html = html.replace(/\n/g, '<br>');

  // Restore pre blocks
  preBlocks.forEach((block, i) => {
    html = html.replace(`__PRE_BLOCK_${i}__`, block);
  });

  return html;
}
