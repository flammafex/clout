/**
 * State Module - Shared application state
 *
 * Centralizes all mutable state for the Clout web app.
 * Other modules import and modify this state as needed.
 */

/**
 * LRU Cache - Bounded cache with least-recently-used eviction
 */
class LRUCache {
  constructor(maxSize = 500) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key) {
    if (!this.cache.has(key)) return null;
    const value = this.cache.get(key);
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.cache.has(key)) this.cache.delete(key);
    this.cache.set(key, value);
    // Evict oldest if over capacity
    if (this.cache.size > this.maxSize) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
  }

  has(key) {
    return this.cache.has(key);
  }

  clear() {
    this.cache.clear();
  }
}

// App initialization state
export let initialized = false;
export let isVisitor = true; // true until identity is created via invitation

// Post state
export let replyingTo = null; // Post ID we're replying to
export let pendingMedia = null; // { cid, mimeType, filename, size }
export let pendingLink = null; // { url, title, description, image, siteName, type, fetchedAt }
export let editingPost = null; // { id, content }
export const postsCache = new LRUCache(500); // Bounded LRU cache of posts

// Trust data cache (reduces IndexedDB queries)
export let trustDataCache = null; // { trustGraph, nicknames, bookmarks, identity, myProfile }
export let trustCacheTime = 0;
const TRUST_CACHE_TTL = 30000; // 30 seconds

// Day pass timer
export let dayPassEndTime = null;
export let dayPassInterval = null;

// Invitation flow
export let pendingInviteCode = null;

// Feed state
export let currentSearchQuery = '';
export let currentFilter = 'all';
export let currentTagFilter = null;
export let feedSort = 'newest'; // newest, reactions, replies, hot
export let feedOffset = 0;
export let feedHasMore = false;

// Virtual scroll state
export let virtualScrollPosts = []; // All loaded posts for virtual rendering
export let virtualScrollEnabled = true; // Toggle for virtual scrolling
const VIRTUAL_SCROLL_ITEM_HEIGHT = 180; // Estimated average post height in px
const VIRTUAL_SCROLL_BUFFER = 5; // Extra items to render above/below viewport

// Live updates
export let eventSource = null;
export let newPostsCount = 0;

// QR code
export let qrCodeGenerated = false;

// Instance info
export let witnessDomain = null;

// State setters (for controlled mutations)
export function setInitialized(value) {
  initialized = value;
}

export function setIsVisitor(value) {
  isVisitor = value;
}

export function setReplyingTo(value) {
  replyingTo = value;
}

export function setPendingMedia(value) {
  pendingMedia = value;
}

export function setPendingLink(value) {
  pendingLink = value;
}

export function setEditingPost(value) {
  editingPost = value;
}

export function cachePost(post) {
  postsCache.set(post.id, post);
}

export function getCachedPost(id) {
  return postsCache.get(id);
}

// Trust cache functions
export function getTrustDataCache() {
  const now = Date.now();
  if (trustDataCache && (now - trustCacheTime) < TRUST_CACHE_TTL) {
    return trustDataCache;
  }
  return null;
}

export function setTrustDataCache(data) {
  trustDataCache = data;
  trustCacheTime = Date.now();
}

export function invalidateTrustCache() {
  trustDataCache = null;
  trustCacheTime = 0;
}

export function setDayPassEndTime(value) {
  dayPassEndTime = value;
}

export function setDayPassInterval(value) {
  dayPassInterval = value;
}

export function clearDayPassInterval() {
  if (dayPassInterval) {
    clearInterval(dayPassInterval);
    dayPassInterval = null;
  }
}

export function setPendingInviteCode(value) {
  pendingInviteCode = value;
}

export function setCurrentSearchQuery(value) {
  currentSearchQuery = value;
}

export function setCurrentFilter(value) {
  currentFilter = value;
}

export function setCurrentTagFilter(value) {
  currentTagFilter = value;
}

export function setFeedSort(value) {
  feedSort = value;
}

export function setFeedOffset(value) {
  feedOffset = value;
}

export function setFeedHasMore(value) {
  feedHasMore = value;
}

export function setEventSource(value) {
  eventSource = value;
}

export function setNewPostsCount(value) {
  newPostsCount = value;
}

export function incrementNewPostsCount() {
  newPostsCount++;
}

export function setQrCodeGenerated(value) {
  qrCodeGenerated = value;
}

export function setWitnessDomain(value) {
  witnessDomain = value;
}

// Virtual scroll functions
export function setVirtualScrollPosts(posts) {
  virtualScrollPosts = posts;
}

export function appendVirtualScrollPosts(posts) {
  virtualScrollPosts = [...virtualScrollPosts, ...posts];
}

export function clearVirtualScrollPosts() {
  virtualScrollPosts = [];
}

export function getVirtualScrollConfig() {
  return {
    itemHeight: VIRTUAL_SCROLL_ITEM_HEIGHT,
    buffer: VIRTUAL_SCROLL_BUFFER,
    enabled: virtualScrollEnabled
  };
}

export function setVirtualScrollEnabled(value) {
  virtualScrollEnabled = value;
}
