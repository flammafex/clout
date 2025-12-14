/**
 * State Module - Shared application state
 *
 * Centralizes all mutable state for the Clout web app.
 * Other modules import and modify this state as needed.
 */

// App initialization state
export let initialized = false;
export let isVisitor = true; // true until identity is created via invitation

// Post state
export let replyingTo = null; // Post ID we're replying to
export let pendingMedia = null; // { cid, mimeType, filename, size }
export let pendingLink = null; // { url, title, description, image, siteName, type, fetchedAt }
export let editingPost = null; // { id, content }
export let postsCache = {}; // Cache of loaded posts by ID

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
  postsCache[post.id] = post;
}

export function getCachedPost(id) {
  return postsCache[id];
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
