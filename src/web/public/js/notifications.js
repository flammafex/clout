/**
 * Notifications Module - SSE and notification counts
 *
 * Handles:
 * - Server-Sent Events for live updates
 * - Notification badge updates
 * - Real-time feed prepending (when user is near the top)
 * - New posts banner (when user has scrolled down)
 */

import * as state from './state.js';
import { apiCall } from './api.js';
import { $ } from './ui.js';
import { loadFeed, prependFeedItem, recalculateTrustForPosts } from './feed.js';

let notificationPollInterval = null;
const NOTIFICATION_POLL_INTERVAL_MS = 30000;

// How close to the top (in px) the user must be for instant prepending.
// Beyond this threshold, we show the banner instead so we don't yank
// their scroll position.
const TOP_OF_FEED_THRESHOLD_PX = 100;

// Batch window: collect incoming posts for this long before prepending,
// so a burst of activity doesn't thrash the DOM with one insert per post.
const BATCH_WINDOW_MS = 2000;

// Pending posts awaiting batch-prepend, keyed by post ID to dedupe.
const pendingBatch = new Map();
let batchTimer = null;

/**
 * Is the user currently looking at the top of the feed?
 *
 * Uses window.scrollY since the feed is the main scrollable content. When
 * the user has scrolled down past the threshold (e.g. reading older posts),
 * we show the banner instead of prepending — prepending would shift their
 * scroll position and lose their place.
 */
function isAtTopOfFeed() {
  return window.scrollY <= TOP_OF_FEED_THRESHOLD_PX;
}

/**
 * Is the feed tab currently active? We only want to prepend when the user
 * is actually looking at the feed.
 */
function isFeedTabActive() {
  const feedTab = $('feed-tab');
  return feedTab && feedTab.classList.contains('active');
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
          handleNewPost(data.data);
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
 * Handle a new_post SSE event.
 *
 * The SSE payload includes the full post object (see routes/feed.ts
 * notifyNewPost). If the user is on the feed tab and near the top, we
 * prepend immediately (batched over BATCH_WINDOW_MS to avoid DOM thrash).
 * Otherwise we fall back to the "N new posts" banner so we don't disrupt
 * their reading.
 */
function handleNewPost(post) {
  if (!post || !post.id) return;

  // Only prepend live when the user is viewing the feed tab.
  if (!isFeedTabActive()) {
    state.incrementNewPostsCount();
    showNewPostsBanner();
    return;
  }

  // If the user has scrolled down, don't yank their position — show the
  // banner instead. They can click it to jump to top and see new posts.
  if (!isAtTopOfFeed()) {
    state.incrementNewPostsCount();
    showNewPostsBanner();
    return;
  }

  // User is at the top: queue the post for batch-prepend.
  pendingBatch.set(post.id, post);

  if (!batchTimer) {
    batchTimer = setTimeout(() => {
      flushPendingBatch();
      batchTimer = null;
    }, BATCH_WINDOW_MS);
  }
}

/**
 * Prepend all queued posts to the feed.
 *
 * Trust recalculation is applied first (so hop distance, bookmarks,
 * nicknames, etc. are correct), then each post is prepended via
 * prependFeedItem(). The counter is NOT incremented since we're showing
 * the posts immediately.
 */
async function flushPendingBatch() {
  if (pendingBatch.size === 0) return;

  const posts = Array.from(pendingBatch.values());
  pendingBatch.clear();

  try {
    // Apply browser-side trust recalculation (hop distance, bookmarks,
    // nicknames) so the prepended posts match the rest of the feed.
    const recalculated = await recalculateTrustForPosts(posts);
    for (const post of recalculated) {
      prependFeedItem(post);
    }
  } catch (e) {
    console.error('[Notifications] Failed to prepend batch:', e);
  }
}

/**
 * Start notification polling (idempotent)
 */
export function startNotificationPolling() {
  if (notificationPollInterval) return;
  notificationPollInterval = setInterval(updateNotificationCounts, NOTIFICATION_POLL_INTERVAL_MS);
}

/**
 * Stop notification polling
 */
export function stopNotificationPolling() {
  if (!notificationPollInterval) return;
  clearInterval(notificationPollInterval);
  notificationPollInterval = null;
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
 * Load new posts — called when the user clicks the "N new posts" banner.
 *
 * Scrolls to the top first (so the user sees the new posts), then flushes
 * any pending batch. If the banner was counting posts that weren't captured
 * in the batch queue (they arrived while the user was scrolled down, before
 * the batch timer fired), falls back to a full feed reload to catch them.
 */
export async function loadNewPosts() {
  // Scroll to top so the user sees the newest posts.
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Capture how many posts the banner was counting. These arrived while
  // the user was scrolled down, so they weren't batch-prepended.
  const missedCount = state.newPostsCount;

  // Flush anything still pending in the batch queue.
  await flushPendingBatch();

  state.setNewPostsCount(0);
  $('new-posts-banner').style.display = 'none';

  // If the banner was counting posts we didn't capture in the batch (they
  // arrived while scrolled down, before the batch timer fired), reload the
  // feed to be safe. This is the conservative path — it matches the
  // previous behavior and ensures no posts are missed.
  if (missedCount > 0) {
    await loadFeed();
  }
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
