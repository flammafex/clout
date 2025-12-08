/**
 * Slides Module - Encrypted DMs
 *
 * Handles:
 * - Sending encrypted slides
 * - Loading and displaying slides
 * - Slide replies
 */

import * as state from './state.js';
import { apiCall } from './api.js';
import { $, showLoading, showResult, escapeHtml, formatRelativeTime } from './ui.js';

/**
 * Send an encrypted slide
 */
export async function sendSlide(requireMembership) {
  if (!requireMembership()) return;

  const recipientKey = $('slide-recipient').value.trim();
  const message = $('slide-message').value.trim();

  if (!recipientKey || !message) {
    showResult('slide-result', 'Please enter recipient key and message', false);
    return;
  }

  try {
    $('send-slide-btn').disabled = true;
    $('send-slide-btn').textContent = 'Sending...';

    await apiCall('/slide', 'POST', { recipientKey, message });

    showResult('slide-result', 'Slide sent successfully! (end-to-end encrypted)', true);
    $('slide-recipient').value = '';
    $('slide-message').value = '';
    $('slide-char-count').textContent = '0';

    await loadSlides();
  } catch (error) {
    showResult('slide-result', `Error: ${error.message}`, false);
  } finally {
    $('send-slide-btn').disabled = false;
    $('send-slide-btn').textContent = 'Send Encrypted Slide';
  }
}

/**
 * Load slides
 */
export async function loadSlides() {
  showLoading('slides-list');
  try {
    const data = await apiCall('/slides');
    const slidesList = $('slides-list');

    if (window.CloutUserData) {
      await window.CloutUserData.markSeen('slides');
    }

    updateSlidesBadge(data.slides?.length || 0);

    if (!data.slides || data.slides.length === 0) {
      slidesList.innerHTML = `
        <div class="empty-state-helpful">
          <div class="empty-icon">&#x1F4EC;</div>
          <h4>No messages yet</h4>
          <p>Send an encrypted slide to someone in your trust circle</p>
        </div>
      `;
      return;
    }

    slidesList.innerHTML = data.slides.map(slide => {
      const senderName = slide.senderDisplayName || slide.sender.slice(0, 16) + '...';
      const hasNickname = !!slide.senderNickname;
      return `
        <div class="slide-item">
          <div class="slide-header">
            <div class="slide-sender">From: <span class="${hasNickname ? 'has-nickname' : ''}" title="${slide.sender}">${escapeHtml(senderName)}</span></div>
            <div class="slide-timestamp">${formatRelativeTime(slide.timestamp)}</div>
          </div>
          <div class="slide-message">${escapeHtml(slide.decryptedContent || slide.message)}</div>
          <button class="btn btn-small" onclick="window.cloutApp.startSlideReply('${slide.sender}')">Reply</button>
        </div>
      `;
    }).join('');
  } catch (error) {
    $('slides-list').innerHTML = `<p class="empty-state">Error loading slides: ${error.message}</p>`;
  }
}

/**
 * Update slides notification badge
 */
export function updateSlidesBadge(count) {
  const badge = $('slides-badge');
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

/**
 * Start slide reply
 */
export function startSlideReply(recipientKey) {
  $('slide-recipient').value = recipientKey;
  $('slide-message').focus();
}
