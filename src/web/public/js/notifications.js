/**
 * Notifications Module - SSE and notification counts
 *
 * Handles:
 * - Server-Sent Events for live updates
 * - Notification badge updates
 * - New posts banner
 */

import * as state from './state.js';
import { apiCall } from './api.js';
import { $ } from './ui.js';
import { loadFeed } from './feed.js';

// Debounce timer for banner updates (prevents DOM thrashing during rapid events)
let bannerUpdateTimeout = null;

/**
 * Debounced banner update - batches rapid SSE events
 */
function debouncedShowBanner() {
  if (bannerUpdateTimeout) return; // Already scheduled
  bannerUpdateTimeout = setTimeout(() => {
    showNewPostsBanner();
    bannerUpdateTimeout = null;
  }, 100);
}

/**
 * Connect to live updates via SSE
 */
export function connectLiveUpdates() {
  if (state.eventSource) {
    state.eventSource.close();
  }

  const eventSource = new EventSource('/api/live');
  state.setEventSource(eventSource);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'new_post':
          state.incrementNewPostsCount();
          debouncedShowBanner();
          break;
        case 'notifications':
          updateNotificationBadges(data.data);
          break;
        case 'connected':
          console.log('[SSE] Connected to live updates');
          break;
        case 'heartbeat':
          // Connection is alive
          break;
      }
    } catch (e) {
      console.error('[SSE] Parse error:', e);
    }
  };

  eventSource.onerror = () => {
    console.log('[SSE] Connection lost, reconnecting in 5s...');
    setTimeout(connectLiveUpdates, 5000);
  };
}

/**
 * Show new posts banner
 */
function showNewPostsBanner() {
  const banner = $('new-posts-banner');
  const countSpan = $('new-posts-count');
  countSpan.textContent = state.newPostsCount;
  banner.style.display = 'block';
}

/**
 * Load new posts
 */
export async function loadNewPosts() {
  state.setNewPostsCount(0);
  $('new-posts-banner').style.display = 'none';
  await loadFeed();
}

/**
 * Update notification counts
 */
export async function updateNotificationCounts() {
  try {
    const data = await apiCall('/notifications/counts');
    updateNotificationBadges(data);
  } catch (error) {
    console.error('Error fetching notifications:', error);
  }
}

/**
 * Update notification badges
 */
export function updateNotificationBadges(counts) {
  const feedBadge = $('feed-badge');
  const feedCount = (counts.replies || 0) + (counts.mentions || 0);
  if (feedCount > 0) {
    feedBadge.textContent = feedCount;
    feedBadge.style.display = 'inline';
  } else {
    feedBadge.style.display = 'none';
  }

  const slidesBadge = $('slides-badge');
  if (counts.slides > 0) {
    slidesBadge.textContent = counts.slides;
    slidesBadge.style.display = 'inline';
  } else {
    slidesBadge.style.display = 'none';
  }
}
