/**
 * Reactions Module - Reactions, bookmarks, and content warnings
 *
 * Handles:
 * - Emoji picker with full emoji selection
 * - Reaction buttons and toggling
 * - Bookmark management
 * - Content warning toggles
 */

import * as state from './state.js';
import { apiCall } from './api.js';
import { $, showResult } from './ui.js';

// Common emoji categories for the picker
const EMOJI_CATEGORIES = {
  'Smileys': ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐'],
  'Gestures': ['👍', '👎', '👊', '✊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👋', '🤚', '🖐️', '✋', '🖖', '💪', '🦾', '🙋', '🙆', '🙅', '🤷', '🙇'],
  'Hearts': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '♥️', '🫶'],
  'Symbols': ['⭐', '🌟', '✨', '💫', '🔥', '💥', '💢', '💯', '✅', '❌', '❓', '❗', '💬', '💭', '🗯️', '💤', '🎉', '🎊', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️'],
  'Objects': ['📝', '📌', '📎', '🔗', '📚', '💡', '🔔', '🎵', '🎶', '🎤', '🎧', '📷', '🎬', '🎮', '🎲', '🧩', '🎁', '🛒', '💰', '💎', '⏰', '📅', '🔑', '🔒', '🔓'],
  'Nature': ['🌈', '☀️', '🌤️', '⛅', '🌥️', '☁️', '🌧️', '⛈️', '🌩️', '❄️', '🌊', '🌸', '🌺', '🌻', '🌹', '🌷', '🌱', '🌲', '🌳', '🍀', '🍁', '🍂', '🐶', '🐱', '🐰', '🦊', '🐻', '🐼', '🐨', '🦁', '🐯', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🦅', '🦋', '🐝', '🐞']
};

/**
 * Render reactions bar for a post (Discord-style)
 * Shows only reactions that exist on the post, plus a React button (for members)
 * @param {string} postId - The post ID
 * @param {Object} reactions - Map of emoji to count
 * @param {string|null} myReaction - The current user's reaction (if any)
 * @param {boolean} readOnly - If true, don't show add button or make buttons clickable (for visitors)
 */
export function renderReactionsBar(postId, reactions, myReaction, readOnly = false) {
  // Get reactions with counts > 0, sorted by count (highest first)
  const activeReactions = Object.entries(reactions)
    .filter(([emoji, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  if (activeReactions.length === 0) {
    // No reactions yet
    if (readOnly) {
      // Visitors see nothing if no reactions
      return '';
    }
    // Members see React button
    return `<div class="reactions-bar" data-post-id="${postId}">
      <button class="reaction-btn reaction-picker-btn" onclick="event.stopPropagation(); window.cloutApp.openEmojiPicker('${postId}')" title="Add reaction">+</button>
    </div>`;
  }

  // Show up to 3 reactions on mobile, all on desktop (CSS handles visibility)
  const visibleReactions = activeReactions.slice(0, 3);
  const hiddenReactions = activeReactions.slice(3);

  // Render visible reaction buttons
  const visibleButtons = visibleReactions.map(([emoji, count]) => {
    const isMyReaction = myReaction === emoji;
    if (readOnly) {
      // Read-only: no click handler, just display
      return `<span class="reaction-btn${isMyReaction ? ' active' : ''}" title="${count} reaction${count !== 1 ? 's' : ''}">
        ${emoji}<span class="reaction-count">${count}</span>
      </span>`;
    }
    const btnClass = isMyReaction ? 'reaction-btn active' : 'reaction-btn';
    return `<button class="${btnClass}" onclick="event.stopPropagation(); window.cloutApp.toggleReaction('${postId}', '${emoji}')" title="${count} reaction${count !== 1 ? 's' : ''}">
      ${emoji}<span class="reaction-count">${count}</span>
    </button>`;
  }).join('');

  // Render hidden reactions (visible on desktop, collapsed on mobile)
  let hiddenButtons = '';
  if (hiddenReactions.length > 0) {
    hiddenButtons = hiddenReactions.map(([emoji, count]) => {
      const isMyReaction = myReaction === emoji;
      if (readOnly) {
        // Read-only: no click handler
        return `<span class="reaction-btn reaction-overflow${isMyReaction ? ' active' : ''}" title="${count} reaction${count !== 1 ? 's' : ''}">
          ${emoji}<span class="reaction-count">${count}</span>
        </span>`;
      }
      const btnClass = isMyReaction ? 'reaction-btn active reaction-overflow' : 'reaction-btn reaction-overflow';
      return `<button class="${btnClass}" onclick="event.stopPropagation(); window.cloutApp.toggleReaction('${postId}', '${emoji}')" title="${count} reaction${count !== 1 ? 's' : ''}">
        ${emoji}<span class="reaction-count">${count}</span>
      </button>`;
    }).join('');

    // Mobile ellipsis button to expand (only for non-readonly)
    if (!readOnly) {
      hiddenButtons += `<button class="reaction-btn reaction-expand-btn" onclick="event.stopPropagation(); window.cloutApp.expandReactions('${postId}')" title="Show ${hiddenReactions.length} more reactions">
        <span class="reaction-ellipsis">...</span>
      </button>`;
    }
  }

  // React button to add new reaction (only for non-readonly)
  const reactButton = readOnly ? '' : `<button class="reaction-btn reaction-picker-btn" onclick="event.stopPropagation(); window.cloutApp.openEmojiPicker('${postId}')" title="Add reaction">+</button>`;

  return `<div class="reactions-bar" data-post-id="${postId}">
    ${visibleButtons}${hiddenButtons}${reactButton}
  </div>`;
}

/**
 * Expand collapsed reactions on mobile
 */
export function expandReactions(postId) {
  const bar = document.querySelector(`.reactions-bar[data-post-id="${postId}"]`);
  if (!bar) return;

  // Toggle expanded state
  bar.classList.toggle('expanded');
}

/**
 * Open emoji picker for a post
 */
export function openEmojiPicker(postId) {
  // Close any existing picker
  closeEmojiPicker();

  // Find the reactions bar
  const bar = document.querySelector(`.reactions-bar[data-post-id="${postId}"]`);
  if (!bar) return;

  // Create picker element
  const picker = document.createElement('div');
  picker.className = 'emoji-picker';
  picker.id = 'emoji-picker';
  picker.setAttribute('data-post-id', postId);

  // Build picker content
  let pickerHtml = `<div class="emoji-picker-header">
    <span class="emoji-picker-title">React</span>
    <button class="emoji-picker-close" onclick="window.cloutApp.closeEmojiPicker()">&times;</button>
  </div>
  <div class="emoji-picker-search">
    <input type="text" placeholder="Search emojis..." oninput="window.cloutApp.filterEmojis(this.value)" />
  </div>
  <div class="emoji-picker-content">`;

  for (const [category, emojis] of Object.entries(EMOJI_CATEGORIES)) {
    pickerHtml += `<div class="emoji-category" data-category="${category}">
      <div class="emoji-category-label">${category}</div>
      <div class="emoji-grid">
        ${emojis.map(e => `<button class="emoji-option" onclick="window.cloutApp.selectEmoji('${postId}', '${e}')">${e}</button>`).join('')}
      </div>
    </div>`;
  }

  pickerHtml += '</div>';
  picker.innerHTML = pickerHtml;

  // Position picker near the reactions bar
  document.body.appendChild(picker);

  const barRect = bar.getBoundingClientRect();
  const pickerRect = picker.getBoundingClientRect();

  // Position above or below depending on space
  let top = barRect.bottom + 8;
  if (top + pickerRect.height > window.innerHeight) {
    top = barRect.top - pickerRect.height - 8;
  }

  let left = barRect.left;
  if (left + pickerRect.width > window.innerWidth) {
    left = window.innerWidth - pickerRect.width - 16;
  }

  picker.style.top = `${Math.max(8, top)}px`;
  picker.style.left = `${Math.max(8, left)}px`;

  // Close on click outside
  setTimeout(() => {
    document.addEventListener('click', handlePickerClickOutside);
  }, 100);
}

/**
 * Close emoji picker
 */
export function closeEmojiPicker() {
  const picker = document.getElementById('emoji-picker');
  if (picker) {
    picker.remove();
    document.removeEventListener('click', handlePickerClickOutside);
  }
}

/**
 * Handle click outside emoji picker
 */
function handlePickerClickOutside(e) {
  const picker = document.getElementById('emoji-picker');
  if (picker && !picker.contains(e.target) && !e.target.classList.contains('reaction-picker-btn')) {
    closeEmojiPicker();
  }
}

/**
 * Filter emojis in picker by search
 */
export function filterEmojis(query) {
  const picker = document.getElementById('emoji-picker');
  if (!picker) return;

  const normalizedQuery = query.toLowerCase().trim();
  const categories = picker.querySelectorAll('.emoji-category');

  categories.forEach(cat => {
    const emojis = cat.querySelectorAll('.emoji-option');
    let hasVisible = false;

    emojis.forEach(btn => {
      const emoji = btn.textContent;
      // Simple matching - show if query is empty or emoji matches somehow
      const visible = !normalizedQuery || emoji.includes(normalizedQuery);
      btn.style.display = visible ? '' : 'none';
      if (visible) hasVisible = true;
    });

    // Hide empty categories
    cat.style.display = hasVisible ? '' : 'none';
  });
}

/**
 * Select an emoji from the picker
 */
export function selectEmoji(postId, emoji) {
  closeEmojiPicker();
  // Trigger the reaction
  window.cloutApp.toggleReaction(postId, emoji);
}

/**
 * Toggle a reaction on a post (optimistic UI update)
 */
export async function toggleReaction(postId, emoji, requireMembership) {
  if (!requireMembership()) return;

  // Find the reactions bar for this post
  const bar = document.querySelector(`.reactions-bar[data-post-id="${postId}"]`);
  if (!bar) return;

  // Find existing button for this emoji (if any)
  const existingBtn = Array.from(bar.querySelectorAll('.reaction-btn')).find(b =>
    b.textContent.trim().startsWith(emoji) &&
    !b.classList.contains('reaction-picker-btn') &&
    !b.classList.contains('reaction-expand-btn')
  );

  const wasActive = existingBtn?.classList.contains('active');
  const countSpan = existingBtn?.querySelector('.reaction-count');
  const currentCount = countSpan ? parseInt(countSpan.textContent) || 0 : 0;

  // Find the picker button (we'll insert new reactions before it)
  const pickerBtn = bar.querySelector('.reaction-picker-btn');

  // Optimistic UI update
  if (wasActive && existingBtn) {
    // REMOVING a reaction - decrement count or remove button
    const newCount = currentCount - 1;
    if (newCount <= 0) {
      // Remove the button entirely
      existingBtn.remove();
    } else {
      existingBtn.classList.remove('active');
      if (countSpan) countSpan.textContent = newCount;
    }
  } else {
    // ADDING a reaction

    // First, remove active state from any other reaction (user can only have one)
    const previousActive = bar.querySelector('.reaction-btn.active:not(.reaction-picker-btn)');
    if (previousActive && previousActive !== existingBtn) {
      const prevCountSpan = previousActive.querySelector('.reaction-count');
      const prevCount = prevCountSpan ? parseInt(prevCountSpan.textContent) || 0 : 0;
      const newPrevCount = prevCount - 1;
      if (newPrevCount <= 0) {
        previousActive.remove();
      } else {
        previousActive.classList.remove('active');
        if (prevCountSpan) prevCountSpan.textContent = newPrevCount;
      }
    }

    if (existingBtn) {
      // Button exists - just activate it and increment count
      existingBtn.classList.add('active');
      if (countSpan) {
        countSpan.textContent = currentCount + 1;
      } else {
        existingBtn.insertAdjacentHTML('beforeend', `<span class="reaction-count">${currentCount + 1}</span>`);
      }
    } else {
      // Create new button for this reaction
      const newBtn = document.createElement('button');
      newBtn.className = 'reaction-btn active';
      newBtn.setAttribute('onclick', `event.stopPropagation(); window.cloutApp.toggleReaction('${postId}', '${emoji}')`);
      newBtn.setAttribute('title', '1 reaction');
      newBtn.innerHTML = `${emoji}<span class="reaction-count">1</span>`;

      // Insert before the picker button
      if (pickerBtn) {
        bar.insertBefore(newBtn, pickerBtn);
      } else {
        bar.appendChild(newBtn);
      }
    }
  }

  // Make API call in background
  try {
    if (wasActive) {
      apiCall('/unreact', 'POST', { postId, emoji }).catch(e => {
        console.error('Failed to unreact:', e);
        // Revert: re-add the button or restore active state
        // For simplicity, we'll just log the error - a page refresh will fix it
      });
    } else {
      apiCall('/react', 'POST', { postId, emoji }).catch(e => {
        console.error('Failed to react:', e);
        // Revert: remove newly added button or remove active state
        // For simplicity, we'll just log the error - a page refresh will fix it
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
    // Invalidate trust cache since bookmarks are part of cached data
    state.invalidateTrustCache();
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
