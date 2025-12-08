/**
 * Reactions Module - Reactions, bookmarks, and content warnings
 *
 * Handles:
 * - Customizable reaction palette (stored in IndexedDB)
 * - Emoji picker with full emoji selection
 * - Reaction buttons and toggling
 * - Bookmark management
 * - Content warning toggles
 */

import * as state from './state.js';
import { apiCall } from './api.js';
import { $, showResult } from './ui.js';

// Default reaction palette (used until user customizes)
const DEFAULT_PALETTE = ['👍', '❤️', '🔥', '😂', '😮', '🙏'];

// Common emoji categories for the picker
const EMOJI_CATEGORIES = {
  'Smileys': ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐'],
  'Gestures': ['👍', '👎', '👊', '✊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👋', '🤚', '🖐️', '✋', '🖖', '💪', '🦾', '🙋', '🙆', '🙅', '🤷', '🙇'],
  'Hearts': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '♥️', '🫶'],
  'Symbols': ['⭐', '🌟', '✨', '💫', '🔥', '💥', '💢', '💯', '✅', '❌', '❓', '❗', '💬', '💭', '🗯️', '💤', '🎉', '🎊', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️'],
  'Objects': ['📝', '📌', '📎', '🔗', '📚', '💡', '🔔', '🎵', '🎶', '🎤', '🎧', '📷', '🎬', '🎮', '🎲', '🧩', '🎁', '🛒', '💰', '💎', '⏰', '📅', '🔑', '🔒', '🔓'],
  'Nature': ['🌈', '☀️', '🌤️', '⛅', '🌥️', '☁️', '🌧️', '⛈️', '🌩️', '❄️', '🌊', '🌸', '🌺', '🌻', '🌹', '🌷', '🌱', '🌲', '🌳', '🍀', '🍁', '🍂', '🐶', '🐱', '🐰', '🦊', '🐻', '🐼', '🐨', '🦁', '🐯', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🦅', '🦋', '🐝', '🐞']
};

// Cached palette for synchronous access
let cachedPalette = null;

/**
 * Load reaction palette from IndexedDB
 */
export async function loadReactionPalette() {
  if (window.CloutUserData) {
    try {
      cachedPalette = await window.CloutUserData.getReactionPalette();
    } catch (e) {
      console.warn('[Reactions] Could not load palette:', e);
      cachedPalette = DEFAULT_PALETTE;
    }
  } else {
    cachedPalette = DEFAULT_PALETTE;
  }
  return cachedPalette;
}

/**
 * Get current reaction palette (sync)
 */
export function getReactionPalette() {
  return cachedPalette || DEFAULT_PALETTE;
}

/**
 * Save reaction palette to IndexedDB
 */
export async function saveReactionPalette(emojis) {
  if (window.CloutUserData) {
    await window.CloutUserData.setReactionPalette(emojis);
    cachedPalette = emojis;
  }
}

/**
 * Render reactions bar for a post
 * Shows: user's palette emojis + any other emojis that have reactions
 */
export function renderReactionsBar(postId, reactions, myReaction, userPalette) {
  const palette = userPalette || getReactionPalette();

  // Collect all emojis that have reactions
  const reactedEmojis = Object.keys(reactions).filter(e => reactions[e] > 0);

  // Build display set: palette emojis first, then any additional reacted emojis
  const displayEmojis = [...palette];
  for (const emoji of reactedEmojis) {
    if (!displayEmojis.includes(emoji)) {
      displayEmojis.push(emoji);
    }
  }

  // Count unique emojis with reactions
  const uniqueReactedCount = reactedEmojis.length;
  const shouldCollapse = uniqueReactedCount > 8;

  // Render palette buttons
  const paletteButtons = palette.map(emoji => {
    const count = reactions[emoji] || 0;
    const isMyReaction = myReaction === emoji;
    const btnClass = isMyReaction ? 'reaction-btn active' : 'reaction-btn';
    const countHtml = count > 0 ? `<span class="reaction-count">${count}</span>` : '';

    return `<button class="${btnClass}" onclick="event.stopPropagation(); window.cloutApp.toggleReaction('${postId}', '${emoji}')" title="React with ${emoji}">
      ${emoji}${countHtml}
    </button>`;
  }).join('');

  // Render additional reactions (not in palette but have counts)
  const additionalEmojis = reactedEmojis.filter(e => !palette.includes(e));
  let additionalHtml = '';

  if (additionalEmojis.length > 0) {
    if (shouldCollapse) {
      // Show collapsed view with expand button
      const visibleExtra = additionalEmojis.slice(0, 3);
      const hiddenCount = additionalEmojis.length - 3;

      additionalHtml = visibleExtra.map(emoji => {
        const count = reactions[emoji] || 0;
        const isMyReaction = myReaction === emoji;
        const btnClass = isMyReaction ? 'reaction-btn active' : 'reaction-btn';
        return `<button class="${btnClass}" onclick="event.stopPropagation(); window.cloutApp.toggleReaction('${postId}', '${emoji}')" title="React with ${emoji}">
          ${emoji}<span class="reaction-count">${count}</span>
        </button>`;
      }).join('');

      if (hiddenCount > 0) {
        additionalHtml += `<button class="reaction-btn reaction-more" onclick="event.stopPropagation(); window.cloutApp.expandReactions('${postId}')" title="Show ${hiddenCount} more reactions">
          +${hiddenCount}
        </button>`;
      }
    } else {
      // Show all additional reactions
      additionalHtml = additionalEmojis.map(emoji => {
        const count = reactions[emoji] || 0;
        const isMyReaction = myReaction === emoji;
        const btnClass = isMyReaction ? 'reaction-btn active' : 'reaction-btn';
        return `<button class="${btnClass}" onclick="event.stopPropagation(); window.cloutApp.toggleReaction('${postId}', '${emoji}')" title="React with ${emoji}">
          ${emoji}<span class="reaction-count">${count}</span>
        </button>`;
      }).join('');
    }
  }

  // React button to open emoji picker
  const reactButton = `<button class="reaction-btn reaction-picker-btn" onclick="event.stopPropagation(); window.cloutApp.openEmojiPicker('${postId}')" title="Choose emoji reaction">
    React
  </button>`;

  return `<div class="reactions-bar" data-post-id="${postId}">
    ${paletteButtons}${additionalHtml}${reactButton}
  </div>`;
}

/**
 * Expand collapsed reactions
 */
export function expandReactions(postId) {
  const bar = document.querySelector(`.reactions-bar[data-post-id="${postId}"]`);
  if (!bar) return;

  // Re-render with all reactions visible
  bar.classList.add('expanded');
  // The actual re-render happens via feed refresh
}

/**
 * Open emoji picker for a post
 */
export function openEmojiPicker(postId, targetElement) {
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

  // Find any button with this emoji for this post
  const bar = document.querySelector(`.reactions-bar[data-post-id="${postId}"]`);
  if (!bar) return;

  const btn = Array.from(bar.querySelectorAll('.reaction-btn')).find(b =>
    b.textContent.trim().startsWith(emoji) && !b.classList.contains('reaction-picker-btn')
  );

  const wasActive = btn?.classList.contains('active');
  const countSpan = btn?.querySelector('.reaction-count');
  const currentCount = countSpan ? parseInt(countSpan.textContent) || 0 : 0;

  // Optimistic UI update
  if (btn) {
    if (wasActive) {
      btn.classList.remove('active');
      if (countSpan) {
        const newCount = Math.max(0, currentCount - 1);
        countSpan.textContent = newCount > 0 ? newCount : '';
        if (newCount === 0) countSpan.remove();
      }
    } else {
      // Remove active from other buttons
      bar.querySelectorAll('.reaction-btn.active').forEach(b => {
        if (!b.classList.contains('reaction-picker-btn')) {
          b.classList.remove('active');
          const otherCount = b.querySelector('.reaction-count');
          if (otherCount) {
            const c = Math.max(0, (parseInt(otherCount.textContent) || 0) - 1);
            otherCount.textContent = c > 0 ? c : '';
            if (c === 0) otherCount.remove();
          }
        }
      });
      btn.classList.add('active');
      if (countSpan) {
        countSpan.textContent = currentCount + 1;
      } else {
        btn.insertAdjacentHTML('beforeend', `<span class="reaction-count">${currentCount + 1}</span>`);
      }
    }
  }

  // Make API call in background
  try {
    if (wasActive) {
      apiCall('/unreact', 'POST', { postId, emoji }).catch(e => {
        console.error('Failed to unreact:', e);
        if (btn) btn.classList.add('active');
      });
    } else {
      apiCall('/react', 'POST', { postId, emoji }).catch(e => {
        console.error('Failed to react:', e);
        if (btn) btn.classList.remove('active');
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

/**
 * Render emoji palette editor for settings
 */
export function renderPaletteEditor(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const palette = getReactionPalette();

  let html = `
    <div class="palette-editor">
      <p class="help-text">Your quick-react emojis (click to change)</p>
      <div class="palette-slots">
        ${palette.map((emoji, i) => `
          <button class="palette-slot" onclick="window.cloutApp.editPaletteSlot(${i})" title="Click to change">
            ${emoji}
          </button>
        `).join('')}
      </div>
      <button class="btn btn-small" onclick="window.cloutApp.resetPalette()" style="margin-top: 0.75rem;">Reset to Default</button>
    </div>
  `;

  container.innerHTML = html;
}

/**
 * Edit a palette slot
 */
export function editPaletteSlot(slotIndex) {
  const currentPalette = getReactionPalette();

  // Create mini emoji picker for this slot
  const picker = document.createElement('div');
  picker.className = 'emoji-picker palette-picker';
  picker.id = 'palette-picker';

  let pickerHtml = `<div class="emoji-picker-header">
    <span class="emoji-picker-title">Choose Emoji</span>
    <button class="emoji-picker-close" onclick="window.cloutApp.closePalettePicker()">&times;</button>
  </div>
  <div class="emoji-picker-content">`;

  for (const [category, emojis] of Object.entries(EMOJI_CATEGORIES)) {
    pickerHtml += `<div class="emoji-category">
      <div class="emoji-category-label">${category}</div>
      <div class="emoji-grid">
        ${emojis.map(e => `<button class="emoji-option${currentPalette.includes(e) ? ' in-palette' : ''}" onclick="window.cloutApp.setPaletteEmoji(${slotIndex}, '${e}')">${e}</button>`).join('')}
      </div>
    </div>`;
  }

  pickerHtml += '</div>';
  picker.innerHTML = pickerHtml;

  // Position picker
  document.body.appendChild(picker);
  const slot = document.querySelectorAll('.palette-slot')[slotIndex];
  if (slot) {
    const rect = slot.getBoundingClientRect();
    picker.style.top = `${rect.bottom + 8}px`;
    picker.style.left = `${Math.max(8, rect.left - 100)}px`;
  }

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', handlePalettePickerClickOutside);
  }, 100);
}

/**
 * Handle click outside palette picker
 */
function handlePalettePickerClickOutside(e) {
  const picker = document.getElementById('palette-picker');
  if (picker && !picker.contains(e.target) && !e.target.classList.contains('palette-slot')) {
    closePalettePicker();
  }
}

/**
 * Close palette picker
 */
export function closePalettePicker() {
  const picker = document.getElementById('palette-picker');
  if (picker) {
    picker.remove();
    document.removeEventListener('click', handlePalettePickerClickOutside);
  }
}

/**
 * Set emoji in palette slot
 */
export async function setPaletteEmoji(slotIndex, emoji) {
  closePalettePicker();

  const currentPalette = [...getReactionPalette()];
  currentPalette[slotIndex] = emoji;

  await saveReactionPalette(currentPalette);

  // Re-render palette editor
  renderPaletteEditor('reaction-palette-container');
}

/**
 * Reset palette to default
 */
export async function resetPalette() {
  await saveReactionPalette(DEFAULT_PALETTE);
  renderPaletteEditor('reaction-palette-container');
}
