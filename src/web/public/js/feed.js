/**
 * Feed Module - Feed loading, filtering, and rendering
 *
 * Handles:
 * - Loading and rendering the main feed
 * - Search functionality
 * - Feed filters (bookmarks, replies, mentions, tags)
 * - Trust-based filtering
 */

import * as state from './state.js';
import { apiCall, API_BASE } from './api.js';
import {
  $, $$, showLoading, showResult, escapeHtml, formatRelativeTime,
  renderAvatar, getReputationColor, switchToTab, renderMarkdown
} from './ui.js';
import { renderReactionsBar } from './reactions.js';

/**
 * VirtualScroller - Renders only visible posts for performance
 *
 * Uses a spacer element to maintain scroll position and only renders
 * posts within the viewport + buffer zone.
 */
class VirtualScroller {
  constructor(container, renderItem) {
    this.container = container;
    this.renderItem = renderItem;
    this.posts = [];
    this.renderedRange = { start: 0, end: 0 };
    this.itemHeight = 180; // Estimated average height
    this.buffer = 5; // Extra items above/below viewport
    this.scrollHandler = null;
    this.resizeObserver = null;
  }

  /**
   * Initialize with posts and start observing scroll
   */
  init(posts) {
    this.posts = posts;
    this.cleanup();

    if (posts.length === 0) return;

    // Create virtual scroll structure
    const totalHeight = posts.length * this.itemHeight;
    this.container.innerHTML = `
      <div class="virtual-scroll-container" style="position: relative; min-height: ${totalHeight}px;">
        <div class="virtual-scroll-content"></div>
      </div>
    `;

    // Initial render
    this.updateVisibleRange();

    // Throttled scroll handler
    let ticking = false;
    this.scrollHandler = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          this.updateVisibleRange();
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', this.scrollHandler, { passive: true });
  }

  /**
   * Calculate which posts should be visible based on scroll position
   */
  updateVisibleRange() {
    const scrollTop = window.scrollY;
    const viewportHeight = window.innerHeight;
    const containerRect = this.container.getBoundingClientRect();
    const containerTop = containerRect.top + scrollTop;

    // Calculate visible range
    const relativeScrollTop = Math.max(0, scrollTop - containerTop);
    const startIndex = Math.max(0, Math.floor(relativeScrollTop / this.itemHeight) - this.buffer);
    const visibleCount = Math.ceil(viewportHeight / this.itemHeight) + (this.buffer * 2);
    const endIndex = Math.min(this.posts.length, startIndex + visibleCount);

    // Only re-render if range changed significantly
    if (startIndex === this.renderedRange.start && endIndex === this.renderedRange.end) {
      return;
    }

    this.renderedRange = { start: startIndex, end: endIndex };
    this.renderVisible();
  }

  /**
   * Render only the visible posts
   */
  renderVisible() {
    const content = this.container.querySelector('.virtual-scroll-content');
    if (!content) return;

    const { start, end } = this.renderedRange;
    const visiblePosts = this.posts.slice(start, end);

    // Position the content at the correct scroll offset
    const offsetTop = start * this.itemHeight;
    content.style.transform = `translateY(${offsetTop}px)`;

    // Render visible posts
    content.innerHTML = visiblePosts.map(post => this.renderItem(post, true)).join('');
  }

  /**
   * Append more posts (for Load More)
   */
  append(newPosts) {
    this.posts = [...this.posts, ...newPosts];

    // Update container height
    const container = this.container.querySelector('.virtual-scroll-container');
    if (container) {
      const totalHeight = this.posts.length * this.itemHeight;
      container.style.minHeight = `${totalHeight}px`;
    }

    this.updateVisibleRange();
  }

  /**
   * Clean up event listeners
   */
  cleanup() {
    if (this.scrollHandler) {
      window.removeEventListener('scroll', this.scrollHandler);
      this.scrollHandler = null;
    }
    this.renderedRange = { start: 0, end: 0 };
  }
}

// Singleton virtual scroller instance
let virtualScroller = null;

/**
 * Get or create the virtual scroller instance
 */
function getVirtualScroller(container) {
  if (!virtualScroller || virtualScroller.container !== container) {
    virtualScroller = new VirtualScroller(container, renderFeedItem);
  }
  return virtualScroller;
}

/**
 * Check if current user is a visitor (no browser identity)
 */
function isVisitorMode() {
  return state.isVisitor;
}

/**
 * Load trust data from cache or IndexedDB (with caching)
 * Uses Promise.all for parallel fetches when cache is cold
 */
async function getTrustData() {
  // Check cache first
  const cached = state.getTrustDataCache();
  if (cached) {
    return cached;
  }

  // Cache miss - fetch all data in parallel
  const identity = await window.CloutIdentity.load();
  if (!identity) {
    return null;
  }

  const browserPublicKey = identity.publicKeyHex;
  const [trustGraph, nicknames, bookmarkIds, myProfile] = await Promise.all([
    window.CloutUserData.getTrustGraph(),
    window.CloutUserData.getAllNicknames(),
    window.CloutUserData.getBookmarks(),
    window.CloutUserData.getProfile(browserPublicKey)
  ]);

  const data = {
    identity,
    browserPublicKey,
    trustGraph,
    trustedKeys: new Set([...trustGraph.map(t => t.trustedKey), browserPublicKey]),
    nicknames,
    bookmarkSet: new Set(bookmarkIds),
    myProfile
  };

  // Cache for subsequent calls
  state.setTrustDataCache(data);
  return data;
}

/**
 * Recalculate trust-related fields for posts using browser's trust graph
 * This overrides server-provided trust data with browser-local Dark Social Graph
 */
export async function recalculateTrustForPosts(posts) {
  if (!window.CloutIdentity || !window.CloutUserData) {
    return posts;
  }

  const trustData = await getTrustData();
  if (!trustData) {
    return posts;
  }

  const { browserPublicKey, trustedKeys, nicknames, bookmarkSet, myProfile } = trustData;
  const normalizeKey = (key) => (typeof key === 'string' ? key.toLowerCase() : key);
  const normalizedBrowserKey = normalizeKey(browserPublicKey);
  const normalizedTrustedKeys = new Set(Array.from(trustedKeys).map(key => normalizeKey(key)));

  posts.forEach(post => {
    const normalizedAuthor = normalizeKey(post.author);
    // Recalculate isAuthor based on browser identity
    post.isAuthor = normalizedAuthor === normalizedBrowserKey;

    // Recalculate isDirectlyTrusted based on browser's trust graph
    post.isDirectlyTrusted = normalizedTrustedKeys.has(normalizedAuthor) && normalizedAuthor !== normalizedBrowserKey;

    // Recalculate trust distance (reputation.distance)
    if (normalizedAuthor === normalizedBrowserKey) {
      post.reputation = { ...post.reputation, distance: 0, score: 1.0 };
      // Override avatar and display name with browser user's profile
      if (myProfile?.avatar) {
        post.authorAvatar = myProfile.avatar;
      }
      if (myProfile?.displayName) {
        post.authorDisplayName = myProfile.displayName;
      }
    } else if (normalizedTrustedKeys.has(normalizedAuthor)) {
      post.reputation = { ...post.reputation, distance: 1, score: 0.8 };
    } else {
      post.reputation = { ...post.reputation, distance: 3, score: 0.2 };
    }

    // Overlay bookmark state from IndexedDB
    post.isBookmarked = bookmarkSet.has(post.id);

    // Handle nickname override for display name (but preserve avatar)
    // Nicknames are local overrides that take precedence over the author's chosen name
    const browserNickname = nicknames.get(post.author);
    if (browserNickname) {
      // Store the original author-chosen display name before overriding
      if (post.authorDisplayName && !post.authorOriginalDisplayName) {
        post.authorOriginalDisplayName = post.authorDisplayName;
      }
      post.authorDisplayName = browserNickname;
      post.authorNickname = browserNickname;
    }
    // Note: authorAvatar is NOT overridden by nickname - it's always the author's chosen avatar

    // Clear server's trust path - we don't have multi-hop info in browser yet
    post.trustPath = [];
  });

  return posts;
}

/**
 * Load and render the main feed
 * @param {boolean} append - If true, append to existing feed (for Load More)
 */
export async function loadFeed(append = false) {
  if (!append) {
    showLoading('feed-list');
    state.setFeedOffset(0);
  }

  try {
    // Build query params with sort and pagination
    const params = new URLSearchParams({
      sort: state.feedSort,
      offset: append ? state.feedOffset.toString() : '0',
      limit: '30'
    });

    const data = await apiCall(`/feed?${params}`);
    const feedList = $('feed-list');

    // Get browser identity for trust-based filtering
    let browserPublicKey = null;
    const normalizeKey = (key) => (typeof key === 'string' ? key.toLowerCase() : key);
    let trustedKeys = new Set();

    if (window.CloutIdentity) {
      const identity = await window.CloutIdentity.load();
      if (identity) {
        browserPublicKey = identity.publicKeyHex;
      }
    }

    // Dark Social Graph: Filter posts client-side using browser's local trust graph
    let filteredPosts = data.posts || [];
    if (window.CloutUserData && browserPublicKey) {
      try {
        const trustGraph = await window.CloutUserData.getTrustGraph();
        console.log('[Feed] Trust graph from IndexedDB:', trustGraph);
        const normalizedBrowserKey = normalizeKey(browserPublicKey);
        trustedKeys = new Set(trustGraph.map(t => normalizeKey(t.trustedKey)));
        if (normalizedBrowserKey) {
          trustedKeys.add(normalizedBrowserKey);
        }

        filteredPosts = filteredPosts.filter(post =>
          trustedKeys.has(normalizeKey(post.author)) || normalizeKey(post.author) === normalizeKey(browserPublicKey)
        );
        console.log(`[Feed] Filtered ${data.posts?.length || 0} posts to ${filteredPosts.length} from ${trustedKeys.size} trusted users`);

        // Filter out muted users
        const mutedUsers = await window.CloutUserData.getMutedUsers();
        if (mutedUsers.length > 0) {
          const mutedSet = new Set(mutedUsers);
          const beforeMute = filteredPosts.length;
          filteredPosts = filteredPosts.filter(post => !mutedSet.has(post.author));
          console.log(`[Feed] Filtered out ${beforeMute - filteredPosts.length} posts from ${mutedUsers.length} muted users`);
        }
      } catch (e) {
        console.warn('[Feed] Could not filter by trust graph:', e);
      }
    } else {
      console.log('[Feed] No trust filtering:', { CloutUserData: !!window.CloutUserData, browserPublicKey });
    }

    // Recalculate trust data using browser's Dark Social Graph
    filteredPosts = await recalculateTrustForPosts(filteredPosts);

    // Cache posts for edit lookups
    filteredPosts.forEach(post => state.cachePost(post));

    // Update pagination state
    state.setFeedHasMore(data.hasMore || false);
    state.setFeedOffset((data.offset || 0) + filteredPosts.length);

    if (filteredPosts.length === 0 && !append) {
      feedList.innerHTML = `
        <div class="empty-state-helpful">
          <div class="empty-icon">🏠</div>
          <h4>Your feed is quiet</h4>
          <p>Posts from people in your trust circle will appear here.</p>
          <div class="empty-actions">
            <button class="btn btn-primary" onclick="window.cloutApp.switchToTab('trust')">Add Someone to Trust</button>
            <button class="btn btn-secondary" onclick="window.cloutApp.switchToTab('post')">Write Your First Post</button>
          </div>
        </div>
      `;
      return;
    }

    // Render posts - use virtual scrolling for large feeds
    const config = state.getVirtualScrollConfig();
    const useVirtualScroll = config.enabled && filteredPosts.length > 20;

    if (useVirtualScroll) {
      const scroller = getVirtualScroller(feedList);
      if (append) {
        // Append to existing virtual scroller
        scroller.append(filteredPosts);
        state.appendVirtualScrollPosts(filteredPosts);
      } else {
        // Initialize virtual scroller with all posts
        state.setVirtualScrollPosts(filteredPosts);
        scroller.init(filteredPosts);
      }

      // Add Load More button after virtual container if needed
      if (state.feedHasMore) {
        const container = feedList.querySelector('.virtual-scroll-container');
        if (container) {
          // Remove existing load more first
          const existingLoadMore = feedList.querySelector('.load-more-container');
          if (existingLoadMore) existingLoadMore.remove();

          feedList.insertAdjacentHTML('beforeend', `
            <div class="load-more-container">
              <button class="btn btn-secondary load-more-btn" onclick="window.cloutApp.loadMorePosts()">
                Load More
              </button>
            </div>
          `);
        }
      }
    } else {
      // Standard rendering for small feeds (no virtual scroll overhead)
      const postsHtml = filteredPosts.map(post => renderFeedItem(post, true)).join('');

      if (append) {
        // Remove existing Load More button before appending
        const existingLoadMore = feedList.querySelector('.load-more-container');
        if (existingLoadMore) {
          existingLoadMore.remove();
        }
        feedList.insertAdjacentHTML('beforeend', postsHtml);
      } else {
        // Clean up any existing virtual scroller
        if (virtualScroller) {
          virtualScroller.cleanup();
        }
        feedList.innerHTML = postsHtml;
      }

      // Add Load More button if there are more posts
      if (state.feedHasMore) {
        feedList.insertAdjacentHTML('beforeend', `
          <div class="load-more-container">
            <button class="btn btn-secondary load-more-btn" onclick="window.cloutApp.loadMorePosts()">
              Load More
            </button>
          </div>
        `);
      }
    }

    // Load tag filter pills after feed loads (only on initial load)
    if (!append) {
      loadTagFilterPills();
    }
  } catch (error) {
    if (!append) {
      $('feed-list').innerHTML = `<p class="empty-state">Error loading feed: ${error.message}</p>`;
    } else {
      console.error('Error loading more posts:', error);
    }
  }
}

/**
 * Load more posts (pagination)
 */
export async function loadMorePosts() {
  const loadMoreBtn = document.querySelector('.load-more-btn');
  if (loadMoreBtn) {
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = 'Loading...';
  }

  await loadFeed(true);
}

/**
 * Change feed sort order
 */
export function setFeedSort(sortOption) {
  if (state.feedSort === sortOption) return;

  state.setFeedSort(sortOption);
  state.setFeedOffset(0);

  // Update active state on sort buttons
  document.querySelectorAll('.feed-sort-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sort === sortOption);
  });

  // Reload feed with new sort
  loadFeed();
}

/**
 * Load feed in visitor mode
 */
export async function loadVisitorFeed() {
  showLoading('feed-list');
  try {
    const data = await apiCall('/feed');
    const feedList = $('feed-list');

    if (data.isVisitor) {
      feedList.innerHTML = `
        <div class="empty-state-helpful visitor-welcome">
          <div class="empty-icon">&#x1F44B;</div>
          <h4>Welcome to Clout</h4>
          <p>${data.message || 'Clout is an invitation-only network. Get an invitation from someone you know to join the conversation.'}</p>
          <div class="empty-actions">
            <button class="btn btn-primary" onclick="window.cloutApp.showInvitePopover()">&#x1F39F; I Have an Invitation</button>
          </div>
          <p class="help-text" style="margin-top: 1rem;">
            Don't have an invitation? Ask someone in the network to invite you.
          </p>
        </div>
      `;
    } else if (!data.posts || data.posts.length === 0) {
      feedList.innerHTML = `
        <div class="empty-state-helpful">
          <div class="empty-icon">&#x1F3E0;</div>
          <h4>Your feed is quiet</h4>
          <p>Posts from people in your trust circle will appear here.</p>
          <div class="empty-actions">
            <button class="btn btn-primary" onclick="window.cloutApp.switchToTab('trust')">Add Someone to Trust</button>
            <button class="btn btn-secondary" onclick="window.cloutApp.switchToTab('post')">Write Your First Post</button>
          </div>
        </div>
      `;
    } else {
      feedList.innerHTML = data.posts.map(post => renderFeedItem(post, true)).join('');
    }
  } catch (error) {
    const feedList = $('feed-list');
    if (error.message?.includes('private') || error.message?.includes('Identity required')) {
      $('main-app').style.display = 'none';
      $('init-section').style.display = 'block';
      feedList.innerHTML = '';
    } else {
      feedList.innerHTML = `
        <div class="empty-state-helpful">
          <div class="empty-icon">&#x274C;</div>
          <h4>Unable to load feed</h4>
          <p>${escapeHtml(error.message)}</p>
        </div>
      `;
    }
  }
}

/**
 * Load feed with current filter
 */
export async function loadFeedWithCurrentFilter() {
  if (state.currentTagFilter) {
    await loadFeedByTag(state.currentTagFilter);
    return;
  }

  switch (state.currentFilter) {
    case 'bookmarks':
      await loadBookmarks();
      break;
    case 'replies':
      await loadReplies();
      break;
    case 'mentions':
      await loadMentionsView();
      break;
    default:
      await loadFeed();
  }
}

/**
 * Set feed filter
 */
export function setFeedFilter(filter) {
  state.setCurrentFilter(filter);
  state.setCurrentTagFilter(null);

  $$('.filter-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelector(`.filter-btn[data-filter="${filter}"]`)?.classList.add('active');
  $$('.tag-pill').forEach(pill => pill.classList.remove('active'));

  loadFeedWithCurrentFilter();
}

/**
 * Filter by tag
 */
export async function filterByTag(tag) {
  if (state.currentTagFilter === tag) {
    state.setCurrentTagFilter(null);
  } else {
    state.setCurrentTagFilter(tag);
  }

  $$('.tag-pill').forEach(pill => {
    pill.classList.toggle('active', pill.textContent.trim() === state.currentTagFilter);
  });

  if (state.currentTagFilter) {
    $$('.filter-btn').forEach(btn => btn.classList.remove('active'));
  } else {
    state.setCurrentFilter('all');
    document.querySelector('.filter-btn[data-filter="all"]')?.classList.add('active');
  }

  await loadFeedWithCurrentFilter();
}

/**
 * Load feed filtered by tag
 */
async function loadFeedByTag(tag) {
  showLoading('feed-list');
  try {
    const data = await apiCall(`/feed/tag/${encodeURIComponent(tag)}`);

    if (!data.posts || data.posts.length === 0) {
      $('feed-list').innerHTML = `
        <div class="empty-state-helpful">
          <div class="empty-icon">🏷️</div>
          <h4>No posts from "${escapeHtml(tag)}"</h4>
          <p>Posts from users tagged "${escapeHtml(tag)}" will appear here.</p>
          <button class="btn btn-secondary" onclick="window.cloutApp.filterByTag('${escapeHtml(tag)}')">Clear Filter</button>
        </div>
      `;
      return;
    }

    // Recalculate trust data using browser's Dark Social Graph
    const posts = await recalculateTrustForPosts(data.posts);
    $('feed-list').innerHTML = posts.map(post => renderFeedItem(post, false)).join('');
  } catch (error) {
    $('feed-list').innerHTML = `<p class="empty-state">Error loading tagged posts: ${error.message}</p>`;
  }
}

/**
 * Load tag filter pills
 */
async function loadTagFilterPills() {
  try {
    const data = await apiCall('/tags');
    const container = $('tag-filter-pills');
    const wrapper = $('tag-filters');

    if (!data.tags || data.tags.length === 0) {
      wrapper.style.display = 'none';
      return;
    }

    wrapper.style.display = 'flex';
    container.innerHTML = data.tags.map(tag => `
      <button class="tag-pill${state.currentTagFilter === tag.tag ? ' active' : ''}"
              onclick="window.cloutApp.filterByTag('${escapeHtml(tag.tag)}')"
              title="${tag.count} users">
        ${escapeHtml(tag.tag)}
      </button>
    `).join('');
  } catch (error) {
    console.error('Error loading tag pills:', error);
    $('tag-filters').style.display = 'none';
  }
}

/**
 * Load bookmarks
 */
async function loadBookmarks() {
  showLoading('feed-list');
  try {
    if (!window.CloutUserData) {
      $('feed-list').innerHTML = `<p class="empty-state">User data not available</p>`;
      return;
    }

    const bookmarkIds = await window.CloutUserData.getBookmarks();
    if (!bookmarkIds || bookmarkIds.length === 0) {
      $('feed-list').innerHTML = `
        <div class="empty-state-helpful">
          <div class="empty-icon">🔖</div>
          <h4>No bookmarks yet</h4>
          <p>Bookmark posts to save them for later.</p>
        </div>
      `;
      return;
    }

    const data = await apiCall('/feed');
    const bookmarkSet = new Set(bookmarkIds);
    let bookmarkedPosts = (data.posts || []).filter(p => bookmarkSet.has(p.id));

    if (bookmarkedPosts.length === 0) {
      $('feed-list').innerHTML = `
        <div class="empty-state-helpful">
          <div class="empty-icon">🔖</div>
          <h4>No bookmarks found</h4>
          <p>Your bookmarked posts may no longer be available.</p>
        </div>
      `;
      return;
    }

    // Recalculate trust data using browser's Dark Social Graph
    bookmarkedPosts = await recalculateTrustForPosts(bookmarkedPosts);
    $('feed-list').innerHTML = bookmarkedPosts.map(post => renderFeedItem(post, false)).join('');
  } catch (error) {
    $('feed-list').innerHTML = `<p class="empty-state">Error loading bookmarks: ${error.message}</p>`;
  }
}

/**
 * Load replies to your posts
 */
async function loadReplies() {
  showLoading('feed-list');
  try {
    const data = await apiCall('/notifications/replies');
    if (window.CloutUserData) {
      await window.CloutUserData.markSeen('replies');
    }

    if (!data.posts || data.posts.length === 0) {
      $('feed-list').innerHTML = `
        <div class="empty-state-helpful">
          <div class="empty-icon">💬</div>
          <h4>No replies yet</h4>
          <p>When someone replies to your posts, they'll appear here.</p>
        </div>
      `;
      return;
    }

    // Recalculate trust data using browser's Dark Social Graph
    const posts = await recalculateTrustForPosts(data.posts);
    $('feed-list').innerHTML = posts.map(post => renderFeedItem(post, false)).join('');
  } catch (error) {
    $('feed-list').innerHTML = `<p class="empty-state">Error loading replies: ${error.message}</p>`;
  }
}

/**
 * Load mentions
 */
async function loadMentionsView() {
  showLoading('feed-list');
  try {
    const data = await apiCall('/mentions');
    if (window.CloutUserData) {
      await window.CloutUserData.markSeen('mentions');
    }

    if (!data.posts || data.posts.length === 0) {
      $('feed-list').innerHTML = `
        <div class="empty-state-helpful">
          <div class="empty-icon">@</div>
          <h4>No mentions yet</h4>
          <p>When someone mentions you (@yourKey), it'll appear here.</p>
        </div>
      `;
      return;
    }

    // Recalculate trust data using browser's Dark Social Graph
    const posts = await recalculateTrustForPosts(data.posts);
    $('feed-list').innerHTML = posts.map(post => renderFeedItem(post, false)).join('');
  } catch (error) {
    $('feed-list').innerHTML = `<p class="empty-state">Error loading mentions: ${error.message}</p>`;
  }
}

/**
 * Search posts
 */
export async function searchPosts() {
  const query = $('feed-search').value.trim();
  if (!query) {
    clearSearch();
    return;
  }

  state.setCurrentSearchQuery(query);
  showLoading('feed-list');

  try {
    const data = await apiCall(`/search?q=${encodeURIComponent(query)}`);
    $('clear-search-btn').style.display = 'inline-block';

    if (!data.posts || data.posts.length === 0) {
      $('feed-list').innerHTML = `
        <div class="empty-state">
          <p>No posts found for "${escapeHtml(query)}"</p>
          <button class="btn btn-small" onclick="window.cloutApp.clearSearch()">Clear Search</button>
        </div>
      `;
      return;
    }

    $('feed-list').innerHTML = `
      <div class="search-results-header">
        <span>Found ${data.posts.length} result${data.posts.length !== 1 ? 's' : ''} for "${escapeHtml(query)}"</span>
      </div>
    ` + data.posts.map(post => renderFeedItem(post, false)).join('');
  } catch (error) {
    $('feed-list').innerHTML = `<p class="empty-state">Search error: ${error.message}</p>`;
  }
}

/**
 * Clear search
 */
export function clearSearch() {
  state.setCurrentSearchQuery('');
  $('feed-search').value = '';
  $('clear-search-btn').style.display = 'none';
  loadFeed();
}

/**
 * Render a single feed item
 */
export function renderFeedItem(post, fullFeatures = true) {
  // Debug: Log witness domain state on first render
  if (!renderFeedItem._debugLogged) {
    console.log('[Feed] renderFeedItem - state.witnessDomain:', state.witnessDomain);
    renderFeedItem._debugLogged = true;
  }

  const hasMedia = post.media && post.media.cid;
  const hasLink = post.link && post.link.url;
  const rep = post.reputation || { score: 0, distance: 0 };
  const repColor = getReputationColor(rep.score);
  const tags = post.authorTags || [];
  const tagsHtml = tags.length > 0
    ? `<span class="author-tags">${tags.map(t => `<span class="tag-badge">${escapeHtml(t)}</span>`).join('')}</span>`
    : '';

  const trustPath = post.trustPath || [];
  const isYou = post.isAuthor || rep.distance === 0;
  const isDirectTrust = post.isDirectlyTrusted || rep.distance === 1;
  const visitor = isVisitorMode();

  // Trust context - hide for visitors
  let trustContext = '';
  if (!visitor) {
    if (isYou) {
      trustContext = '<span class="trust-context trust-self">Self</span>';
    } else if (isDirectTrust) {
      trustContext = '<span class="trust-context trust-direct">In Your Circle</span>';
    } else if (trustPath.length > 0) {
      const pathDisplay = trustPath.slice(0, -1).join(' &#x2192; ');
      trustContext = `<span class="trust-context trust-indirect">Via ${pathDisplay}</span>`;
    }
  }

  // Distance class for left border - hide for visitors
  const distanceClass = visitor ? '' : `distance-${Math.min(rep.distance, 3)}`;

  // Quick trust button (+ next to author) - hide for visitors
  const quickTrustBtn = (!visitor && !isYou && !isDirectTrust && fullFeatures)
    ? `<button class="btn-trust-quick" onclick="event.stopPropagation(); window.cloutApp.quickTrust('${post.author}')" title="Add to your circle">+</button>`
    : '';

  // Reputation badge (hop distance) - hide for visitors
  const reputationBadge = (!visitor && !isYou)
    ? `<span class="reputation-badge" style="background-color: ${repColor}" title="Reputation: ${rep.score.toFixed(2)}, Distance: ${rep.distance}">
        ${rep.distance === 1 ? '1st' : rep.distance === 2 ? '2nd' : '3rd+'}
      </span>`
    : '';

  // Mute/Redact button - hide for visitors
  const muteBtn = (!visitor && !isYou && fullFeatures)
    ? `<button class="btn-action btn-mute" onclick="event.stopPropagation(); window.cloutApp.muteUser('${post.author}', '${escapeHtml(post.authorDisplayName || '')}')" title="Redact this user">Redact</button>`
    : '';

  // Author actions (Revise/Retract) - hide for visitors
  const authorActions = (!visitor && post.isAuthor && fullFeatures)
    ? `<button class="btn-action" onclick="event.stopPropagation(); window.cloutApp.startEditPost('${post.id}')" title="Revise post">Revise</button>
       <button class="btn-action btn-retract" onclick="event.stopPropagation(); window.cloutApp.retractPost('${post.id}')" title="Retract post">Retract</button>`
    : '';

  const editedIndicator = post.isEdited ? '<span class="edited-badge" title="This post has been edited">edited</span>' : '';
  const authorName = post.authorDisplayName || post.author.slice(0, 16) + '...';
  const hasNickname = !!post.authorNickname;
  const hasCW = !!post.contentWarning;
  const cwId = `cw-${post.id}`;

  // Reactions - show for everyone, but read-only for visitors
  const reactions = post.reactions || {};
  const myReaction = post.myReaction;
  const reactionsHtml = renderReactionsBar(post.id, reactions, myReaction, visitor);

  // Save button - hide for visitors
  const saveBtn = visitor ? '' : `
    <button class="btn-action ${post.isBookmarked ? 'active' : ''}" onclick="event.stopPropagation(); window.cloutApp.toggleBookmark('${post.id}')" title="${post.isBookmarked ? 'Remove bookmark' : 'Bookmark'}">
      ${post.isBookmarked ? 'Saved' : 'Save'}
    </button>`;

  // Reply button - hide for visitors
  const replyBtn = visitor ? '' : `
    <button class="btn-action" onclick="event.stopPropagation(); window.cloutApp.startReply('${post.id}', '${escapeHtml(authorName)}')">Reply</button>`;

  const authorAvatar = post.authorAvatar || '&#x1F464;';

  return `
    <div class="feed-item ${hasMedia ? 'has-media' : ''} ${hasLink ? 'has-link' : ''} ${post.nsfw ? 'nsfw-post' : ''} ${hasCW ? 'has-cw' : ''} ${distanceClass}" onclick="window.cloutApp.viewThread('${post.id}')" style="cursor: pointer;">
      <div class="feed-item-wrapper">
        <div class="feed-avatar">${renderAvatar(authorAvatar)}</div>
        <div class="feed-post-content">
          <div class="feed-header">
            <div class="feed-author">
              <span class="${hasNickname ? 'has-nickname' : ''}" title="${post.author}">${escapeHtml(authorName)}</span>
              ${reputationBadge}
              ${tagsHtml}
              ${quickTrustBtn}
            </div>
            <div class="feed-meta">
              ${trustContext}
              ${post.nsfw ? '<span class="nsfw-badge">NSFW</span>' : ''}
              ${hasCW ? `<span class="cw-badge">CW: ${escapeHtml(post.contentWarning)}</span>` : ''}
            </div>
          </div>
          ${post.replyTo ? `<div class="feed-reply-indicator">&#x21B3; Reply to ${post.replyTo.slice(0, 8)}... <a href="#" onclick="event.preventDefault(); event.stopPropagation(); window.cloutApp.viewThread('${post.resolvedReplyTo || post.replyTo}')">View parent</a></div>` : ''}
          ${hasCW ? `
            <div class="cw-wrapper" id="${cwId}">
              <button class="cw-reveal-btn" onclick="event.stopPropagation(); window.cloutApp.toggleCW('${cwId}')">
                &#x26A0;&#xFE0F; ${escapeHtml(post.contentWarning)} - Click to reveal
              </button>
              <div class="cw-content" style="display: none;">
                <div class="feed-content">${renderPostContent(post)}</div>
              </div>
            </div>
          ` : `
            <div class="feed-content">${renderPostContent(post)}</div>
          `}
          <div class="feed-footer">
            <div class="feed-timestamp"><span class="witness-emoji">&#x1F64C;</span> Witnessed${state.witnessDomain ? ` by ${escapeHtml(state.witnessDomain)}` : ''} ${formatRelativeTime(post.proof?.timestamp || post.timestamp)} ${editedIndicator}</div>
            <div class="feed-actions">
              ${reactionsHtml}
              ${saveBtn}
              ${replyBtn}
              ${muteBtn}
              ${authorActions}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// Link preview decay time: 24 hours
const LINK_PREVIEW_DECAY_MS = 24 * 60 * 60 * 1000;

/**
 * Check if a link preview has expired
 */
function isLinkPreviewExpired(link) {
  if (!link || !link.fetchedAt) return true;
  return Date.now() - link.fetchedAt > LINK_PREVIEW_DECAY_MS;
}

/**
 * Render a link preview card
 */
function renderLinkPreviewCard(link, expired = false) {
  if (expired) {
    return `<div class="post-link-expired"><span class="post-link-expired-icon">&#x1F517;</span><span class="post-link-expired-text">Link preview expired</span><a href="${escapeHtml(link.url)}" target="_blank" rel="noopener" class="post-link-expired-url" onclick="event.stopPropagation();">${escapeHtml(link.url)}</a></div>`;
  }

  const hostname = (() => {
    try {
      return new URL(link.url).hostname;
    } catch {
      return link.url;
    }
  })();

  return `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener" class="post-link-preview" onclick="event.stopPropagation();"><div class="post-link-preview-content"><div class="post-link-preview-site">${escapeHtml(link.siteName || hostname)}</div><div class="post-link-preview-title">${escapeHtml(link.title || 'Untitled')}</div>${link.description ? `<div class="post-link-preview-description">${escapeHtml(link.description)}</div>` : ''}<div class="post-link-preview-url">${escapeHtml(hostname)}</div></div></a>`;
}

/**
 * Render post content with media
 */
export function renderPostContent(post) {
  if (post.decayedAt || post.content === null) {
    const decayDate = post.decayedAt ? new Date(post.decayedAt).toLocaleDateString() : 'unknown';
    return `<span class="post-decayed">This post's content has expired (${decayDate})</span>`;
  }

  let content = renderMarkdown(escapeHtml(post.content));
  const visitor = isVisitorMode();

  // Debug: Log media state for troubleshooting
  if (post.media) {
    console.log(`[Feed] Post ${post.id} media:`, { cid: post.media.cid, mimeType: post.media.mimeType, visitor });
  }

  // Hide media for visitors - only show text content
  if (post.media && post.media.cid) {
    content = content.replace(/\[clout-media:\s*[^\]]+\]/g, '');

    if (visitor) {
      // Show placeholder for visitors
      return content.trim() + `<div class="post-media-placeholder"><span class="media-placeholder-icon">&#x1F512;</span><span class="media-placeholder-text">Media available to members</span></div>`;
    }

    const mediaUrl = `${API_BASE}/media/post/${post.id}`;
    const mimeType = post.media.mimeType || '';

    let mediaHtml = '';
    const hopDistance = post.reputation?.distance ?? 999;
    // Use data attributes instead of inline handlers to prevent XSS
    const mediaDataAttrs = `data-media-post-id="${post.id}" data-media-hop-distance="${hopDistance}"`;

    if (mimeType.startsWith('image/')) {
      mediaHtml = `<div class="post-media" data-post-id="${post.id}"><img src="${mediaUrl}" alt="Post media" loading="lazy" ${mediaDataAttrs}></div>`;
    } else if (mimeType.startsWith('video/')) {
      mediaHtml = `<div class="post-media" data-post-id="${post.id}"><video src="${mediaUrl}" controls preload="metadata" ${mediaDataAttrs}></video></div>`;
    } else if (mimeType.startsWith('audio/')) {
      mediaHtml = `<div class="post-media" data-post-id="${post.id}"><audio src="${mediaUrl}" controls ${mediaDataAttrs}></audio></div>`;
    } else if (mimeType === 'application/pdf') {
      mediaHtml = `<div class="post-media post-media-file" data-post-id="${post.id}"><a href="${mediaUrl}" target="_blank" class="media-link">&#x1F4C4; View PDF</a></div>`;
    } else {
      // Fallback for unknown types - try as image
      console.warn(`[Feed] Unknown media type: ${mimeType} for post ${post.id}, trying as image`);
      mediaHtml = `<div class="post-media" data-post-id="${post.id}"><img src="${mediaUrl}" alt="Post media" loading="lazy" ${mediaDataAttrs}></div>`;
    }

    return content.trim() + mediaHtml;
  }

  const mediaMatch = post.content.match(/\[clout-media:\s*([^\]]+)\]/);
  if (mediaMatch) {
    const cid = mediaMatch[1].trim();
    content = content.replace(/\[clout-media:\s*[^\]]+\]/g, '');

    if (visitor) {
      return content.trim() + `<div class="post-media-placeholder"><span class="media-placeholder-icon">&#x1F512;</span><span class="media-placeholder-text">Media available to members</span></div>`;
    }

    const mediaUrl = `${API_BASE}/media/${cid}`;
    return content.trim() + `<div class="post-media"><img src="${mediaUrl}" alt="Post media" loading="lazy" data-legacy-media="true"></div>`;
  }

  // Handle link previews
  if (post.link && post.link.url) {
    const expired = isLinkPreviewExpired(post.link);
    return content.trim() + renderLinkPreviewCard(post.link, expired);
  }

  return content;
}

/**
 * Handle media load errors
 */
export function handleMediaError(element, postId, hopDistance) {
  const container = element.parentElement;
  if (!container) return;

  let message = 'Media unavailable';
  let suggestion = '';

  if (hopDistance > 1) {
    message = `Media from ${hopDistance}-hop author`;
    suggestion = 'Adjust Media Trust Settings to view';
  } else {
    message = 'Media unavailable';
    suggestion = 'Author may be offline';
  }

  container.innerHTML = `
    <div class="media-unavailable">
      <span class="media-unavailable-icon">&#x1F512;</span>
      <span class="media-unavailable-text">${message}</span>
      <span class="media-unavailable-hint">${suggestion}</span>
    </div>
  `;
}

/**
 * Setup event delegation for media error/load handling
 * This replaces inline onerror/onload handlers to prevent XSS
 */
export function setupMediaErrorHandling() {
  // Handle media load events (add 'loaded' class)
  document.addEventListener('load', (e) => {
    const target = e.target;
    if (target.dataset && target.dataset.mediaPostId) {
      target.classList.add('loaded');
    }
  }, true);

  // Handle media error events
  document.addEventListener('error', (e) => {
    const target = e.target;

    // Handle new media format with data attributes
    if (target.dataset && target.dataset.mediaPostId) {
      const postId = target.dataset.mediaPostId;
      const hopDistance = parseInt(target.dataset.mediaHopDistance, 10) || 999;
      handleMediaError(target, postId, hopDistance);
      return;
    }

    // Handle legacy media format
    if (target.dataset && target.dataset.legacyMedia === 'true') {
      const container = target.parentElement;
      if (container) {
        container.innerHTML = '<span class="media-error">Media unavailable</span>';
      }
      return;
    }
  }, true);
}
