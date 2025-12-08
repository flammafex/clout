/**
 * Reactions Module - Reactions, bookmarks, and content warnings
 *
 * Handles:
 * - Reaction buttons and toggling
 * - Bookmark management
 * - Content warning toggles
 */

import * as state from './state.js';
import { apiCall } from './api.js';
import { $, showResult } from './ui.js';

/**
 * Render reactions bar for a post
 */
export function renderReactionsBar(postId, reactions, myReaction, availableEmojis) {
  const reactionButtons = availableEmojis.map(emoji => {
    const count = reactions[emoji] || 0;
    const isMyReaction = myReaction === emoji;
    const btnClass = isMyReaction ? 'reaction-btn active' : 'reaction-btn';

    return `<button class="${btnClass}" onclick="event.stopPropagation(); window.cloutApp.toggleReaction('${postId}', '${emoji}')" title="${emoji}">
      ${emoji}${count > 0 ? `<span class="reaction-count">${count}</span>` : ''}
    </button>`;
  }).join('');

  return `<div class="reactions-bar">${reactionButtons}</div>`;
}

/**
 * Toggle a reaction on a post (optimistic UI update)
 */
export async function toggleReaction(postId, emoji, requireMembership) {
  if (!requireMembership()) return;

  const btn = document.querySelector(`.feed-item [onclick*="toggleReaction('${postId}', '${emoji}')"]`);
  if (!btn) return;

  const wasActive = btn.classList.contains('active');
  const countSpan = btn.querySelector('.reaction-count');
  const currentCount = countSpan ? parseInt(countSpan.textContent) || 0 : 0;

  // Optimistic UI update
  if (wasActive) {
    btn.classList.remove('active');
    if (countSpan) {
      const newCount = Math.max(0, currentCount - 1);
      countSpan.textContent = newCount > 0 ? newCount : '';
      if (newCount === 0) countSpan.remove();
    }
  } else {
    const postElement = btn.closest('.feed-item');
    if (postElement) {
      postElement.querySelectorAll('.reaction-btn.active').forEach(b => {
        b.classList.remove('active');
        const otherCount = b.querySelector('.reaction-count');
        if (otherCount) {
          const c = Math.max(0, (parseInt(otherCount.textContent) || 0) - 1);
          otherCount.textContent = c > 0 ? c : '';
          if (c === 0) otherCount.remove();
        }
      });
    }
    btn.classList.add('active');
    if (countSpan) {
      countSpan.textContent = currentCount + 1;
    } else {
      btn.insertAdjacentHTML('beforeend', `<span class="reaction-count">${currentCount + 1}</span>`);
    }
  }

  // Make API call in background
  try {
    if (wasActive) {
      apiCall('/unreact', 'POST', { postId, emoji }).catch(e => {
        console.error('Failed to unreact:', e);
        btn.classList.add('active');
      });
    } else {
      apiCall('/react', 'POST', { postId, emoji }).catch(e => {
        console.error('Failed to react:', e);
        btn.classList.remove('active');
      });
    }
  } catch (error) {
    console.error('Error toggling reaction:', error);
  }
}

/**
 * Toggle bookmark on a post
 */
export async function toggleBookmark(postId, requireMembership) {
  if (!requireMembership()) return;

  if (!window.CloutUserData) {
    console.error('User data not available');
    return;
  }

  const btn = document.querySelector(`.feed-item [onclick*="toggleBookmark('${postId}')"]`);
  if (!btn) return;

  const wasBookmarked = btn.classList.contains('active');

  // Optimistic UI update
  if (wasBookmarked) {
    btn.classList.remove('active');
    btn.textContent = 'Save';
  } else {
    btn.classList.add('active');
    btn.textContent = 'Saved';
  }

  // Update IndexedDB in background
  try {
    if (wasBookmarked) {
      await window.CloutUserData.unbookmark(postId);
    } else {
      await window.CloutUserData.bookmark(postId);
    }
  } catch (error) {
    console.error('Error toggling bookmark:', error);
    // Revert on failure
    if (wasBookmarked) {
      btn.classList.add('active');
      btn.textContent = 'Saved';
    } else {
      btn.classList.remove('active');
      btn.textContent = 'Save';
    }
  }
}

/**
 * Toggle content warning visibility
 */
export function toggleCW(cwId) {
  const wrapper = document.getElementById(cwId);
  if (!wrapper) return;

  const revealBtn = wrapper.querySelector('.cw-reveal-btn');
  const content = wrapper.querySelector('.cw-content');

  if (content.style.display === 'none') {
    content.style.display = 'block';
    revealBtn.style.display = 'none';
  } else {
    content.style.display = 'none';
    revealBtn.style.display = 'block';
  }
}
