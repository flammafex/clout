// Clout Web UI - Frontend Application
//
// Organized into sections:
// 1. GLOBALS & UTILITIES
// 2. API LAYER
// 3. UI HELPERS
// 4. TAB MANAGEMENT
// 5. INITIALIZATION
// 6. FEED
// 7. TRUST & REPUTATION
// 8. THREAD VIEW
// 9. POST CREATION
// 10. SLIDES (DMs)
// 11. IDENTITY & PROFILE
// 12. MEDIA UPLOAD
// 13. SETTINGS
// 14. APP BOOTSTRAP

// =========================================================================
// 1. GLOBALS & UTILITIES
// =========================================================================

const API_BASE = '/api';
let initialized = false;
let isVisitor = true; // Track visitor state - true until identity is created via invitation
let replyingTo = null; // Track which post we're replying to
let pendingMedia = null; // Track uploaded media for post { cid, mimeType, filename, size }
let editingPost = null; // Track which post we're editing { id, content }
let postsCache = {}; // Cache of loaded posts by ID for edit lookups
let dayPassEndTime = null; // Track day pass expiration
let dayPassInterval = null; // Interval for updating countdown
let pendingInviteCode = null; // Track pending invitation code for redemption

/**
 * Check if user is a member (has identity). If not, show invite popup.
 * Use this to guard all interactive actions.
 * @returns {boolean} true if user is a member, false if visitor (popup shown)
 */
function requireMembership() {
  if (!initialized || isVisitor) {
    showInvitePopover();
    return false;
  }
  return true;
}

const $ = (id) => document.getElementById(id);
const $$ = (selector) => document.querySelectorAll(selector);

// Show loading spinner in a container
function showLoading(containerId) {
  const container = $(containerId);
  if (container) {
    container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><span>Loading...</span></div>';
  }
}

// Hide loading (called automatically when content is set)
function hideLoading(containerId) {
  // Content replacement handles this automatically
}

// =========================================================================
// 2. API LAYER
// =========================================================================

async function apiCall(endpoint, method = 'GET', body = null) {
  try {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${API_BASE}${endpoint}`, options);
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Request failed');
    }

    return data.data;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

// =========================================================================
// 3. UI HELPERS
// =========================================================================

function showResult(elementId, message, isSuccess) {
  const el = $(elementId);
  el.textContent = message;
  el.className = `result-message ${isSuccess ? 'success' : 'error'}`;
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 5000);
}

function updateStatus(text, active = false) {
  $('status-text').textContent = text;
  const dot = $('status-indicator');
  if (active) {
    dot.classList.add('active');
  } else {
    dot.classList.remove('active');
  }
}

// Day pass countdown timer
function startDayPassTimer(expiryTimestamp) {
  // Only show timer if a ticket exists (has an expiry)
  if (!expiryTimestamp) {
    // No ticket yet - hide timer
    $('day-pass-timer').style.display = 'none';
    if (dayPassInterval) {
      clearInterval(dayPassInterval);
      dayPassInterval = null;
    }
    return;
  }

  dayPassEndTime = expiryTimestamp;

  // Show the timer
  $('day-pass-timer').style.display = 'flex';

  // Update immediately
  updateDayPassCountdown();

  // Update every second
  if (dayPassInterval) clearInterval(dayPassInterval);
  dayPassInterval = setInterval(updateDayPassCountdown, 1000);
}

function updateDayPassCountdown() {
  const now = Date.now();
  const remaining = dayPassEndTime - now;

  if (remaining <= 0) {
    $('day-pass-countdown').textContent = 'Expired';
    if (dayPassInterval) {
      clearInterval(dayPassInterval);
      dayPassInterval = null;
    }
    return;
  }

  const hours = Math.floor(remaining / (1000 * 60 * 60));
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((remaining % (1000 * 60)) / 1000);

  $('day-pass-countdown').textContent =
    `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// =========================================================================
// 3.5. INVITE POPOVER
// =========================================================================

function showInvitePopover() {
  $('invite-popover').style.display = 'flex';
  $('invite-code-input').value = '';
  $('invite-result').textContent = '';
  $('invite-result').className = 'result-message';
}

function closeInvitePopover() {
  $('invite-popover').style.display = 'none';
}

async function redeemInvite() {
  const code = $('invite-code-input').value.trim();

  if (!code) {
    $('invite-result').textContent = 'Please enter an invitation code';
    $('invite-result').className = 'result-message error';
    return;
  }

  try {
    $('redeem-invite-btn').disabled = true;
    $('redeem-invite-btn').textContent = 'Redeeming...';

    // Step 1: Redeem the invitation code
    await apiCall('/invitation/redeem', 'POST', { code });

    $('invite-result').textContent = 'Invitation accepted! Creating your identity...';
    $('invite-result').className = 'result-message success';
    $('redeem-invite-btn').textContent = 'Creating Identity...';

    // Step 2: Initialize Clout (creates identity)
    const initResponse = await apiCall('/init', 'POST');

    // Step 3: Transition from visitor to member
    initialized = true;
    isVisitor = false;
    pendingInviteCode = code;

    // Update UI for member mode
    $('init-section').style.display = 'none';
    $('main-app').style.display = 'block';
    updateStatus('Connected', true);

    // Start day pass countdown timer with actual ticket expiry
    const ticketExpiry = initResponse?.ticketInfo?.expiry;
    startDayPassTimer(ticketExpiry);

    $('invite-result').textContent = '🎉 Welcome to Clout! Your identity has been created.';
    $('invite-result').className = 'result-message success';

    // Close popover and load feed after a short delay
    setTimeout(async () => {
      closeInvitePopover();

      // Load member data
      await loadFeed();
      await loadIdentity();
      await loadProfile();
      loadSlides().catch(() => {});
      connectLiveUpdates();
      updateNotificationCounts();
      setInterval(updateNotificationCounts, 30000);
    }, 1500);
  } catch (error) {
    $('invite-result').textContent = error.message;
    $('invite-result').className = 'result-message error';
  } finally {
    $('redeem-invite-btn').disabled = false;
    $('redeem-invite-btn').textContent = 'Redeem';
  }
}

// Check if an error indicates invitation is required
function isInvitationRequiredError(error) {
  const msg = error.message?.toLowerCase() || '';
  return msg.includes('invitation') ||
         msg.includes('invite') ||
         msg.includes('sybil') ||
         msg.includes('token');
}

// =========================================================================
// 4. TAB MANAGEMENT
// =========================================================================

function setupTabs() {
  $$('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;

      // Update tab buttons
      $$('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Update tab content
      $$('.tab-content').forEach(content => content.classList.remove('active'));
      $(`${tab}-tab`).classList.add('active');

      // Load data when switching to certain tabs
      if (tab === 'feed') loadFeed();
      if (tab === 'slides') loadSlides();
      if (tab === 'settings') loadSettings();
      if (tab === 'trust') { loadTrustedUsers(); loadStats(); loadSettings(); }
      if (tab === 'profile') { loadProfile(); loadIdentity(); loadIdentities(); }
    });
  });
}

// =========================================================================
// 5. INITIALIZATION
// =========================================================================

async function initializeClout() {
  try {
    $('init-btn').disabled = true;
    $('init-btn').textContent = 'Initializing...';
    updateStatus('Initializing...', false);

    const initResponse = await apiCall('/init', 'POST');

    initialized = true;
    isVisitor = false; // Successfully initialized = member, not visitor
    $('init-section').style.display = 'none';
    $('main-app').style.display = 'block';
    updateStatus('Connected', true);

    // Start day pass countdown timer with actual ticket expiry
    const ticketExpiry = initResponse?.ticketInfo?.expiry;
    startDayPassTimer(ticketExpiry);

    // Load initial data
    await loadFeed();
    await loadIdentity();
    await loadProfile();
    // Load slides count for badge (don't await to not block)
    loadSlides().catch(() => {});

    // Start live updates
    connectLiveUpdates();

    // Initial notification count
    updateNotificationCounts();

    // Poll notifications every 30 seconds
    setInterval(updateNotificationCounts, 30000);
  } catch (error) {
    updateStatus(`Error: ${error.message}`, false);
    $('init-btn').disabled = false;
    $('init-btn').textContent = 'Initialize Clout';
  }
}

// =========================================================================
// 6. FEED
// =========================================================================

async function loadFeed() {
  showLoading('feed-list');
  try {
    const data = await apiCall('/feed');
    const feedList = $('feed-list');

    // Cache posts for edit lookups (avoid inline content in onclick)
    if (data.posts) {
      data.posts.forEach(post => {
        postsCache[post.id] = post;
      });
    }

    if (!data.posts || data.posts.length === 0) {
      feedList.innerHTML = `
        <div class="empty-state-helpful">
          <div class="empty-icon">🏠</div>
          <h4>Your feed is quiet</h4>
          <p>Posts from people in your trust circle will appear here.</p>
          <div class="empty-actions">
            <button class="btn btn-primary" onclick="switchToTab('trust')">Add Someone to Trust</button>
            <button class="btn btn-secondary" onclick="switchToTab('post')">Write Your First Post</button>
          </div>
        </div>
      `;
      return;
    }

    feedList.innerHTML = data.posts.map(post => {
      const hasMedia = post.media && post.media.cid;
      const rep = post.reputation || { score: 0, distance: 0 };
      const repColor = getReputationColor(rep.score);
      const tags = post.authorTags || [];
      const tagsHtml = tags.length > 0
        ? `<span class="author-tags">${tags.map(t => `<span class="tag-badge">${escapeHtml(t)}</span>`).join('')}</span>`
        : '';

      // Build trust path display ("Via Alice → Bob")
      const trustPath = post.trustPath || [];
      // Use server-side isAuthor flag (reliable) instead of window.userPublicKey (may not be set yet)
      const isYou = post.isAuthor || rep.distance === 0;
      const isDirectTrust = post.isDirectlyTrusted || rep.distance === 1;
      let trustContext = '';

      if (isYou) {
        trustContext = '<span class="trust-context trust-self">Self</span>';
      } else if (isDirectTrust) {
        trustContext = '<span class="trust-context trust-direct">In Your Circle</span>';
      } else if (trustPath.length > 0) {
        const pathDisplay = trustPath.slice(0, -1).join(' → '); // Show intermediaries
        trustContext = `<span class="trust-context trust-indirect">Via ${pathDisplay}</span>`;
      }

      // Visual hierarchy class based on distance
      const distanceClass = `distance-${Math.min(rep.distance, 3)}`;

      // Quick trust button for non-directly-trusted users
      const quickTrustBtn = (!isYou && !isDirectTrust)
        ? `<button class="btn-trust-quick" onclick="event.stopPropagation(); quickTrust('${post.author}')" title="Add to your circle">+</button>`
        : '';

      // Mute button (not for your own posts)
      const muteBtn = !isYou
        ? `<button class="btn-action btn-mute" onclick="event.stopPropagation(); muteUser('${post.author}', '${escapeHtml(post.authorDisplayName || '')}')" title="Mute this user">Mute</button>`
        : '';

      // Edit/Delete buttons (only for your own posts)
      const authorActions = post.isAuthor
        ? `<button class="btn-action" onclick="event.stopPropagation(); startEditPost('${post.id}')" title="Edit post">Edit</button>
           <button class="btn-action btn-delete" onclick="event.stopPropagation(); deletePost('${post.id}')" title="Delete post">Delete</button>`
        : '';

      // Show "edited" indicator if post is an edit
      const editedIndicator = post.isEdited ? '<span class="edited-badge" title="This post has been edited">edited</span>' : '';

      // Use display name (nickname if set, otherwise truncated key)
      const authorName = post.authorDisplayName || post.author.slice(0, 16) + '...';
      const hasNickname = !!post.authorNickname;

      // Content warning - collapses content by default
      const hasCW = !!post.contentWarning;
      const cwId = `cw-${post.id}`;

      // Reactions display
      const reactions = post.reactions || {};
      const myReaction = post.myReaction;
      const reactionEmojis = ['👍', '❤️', '🔥', '😂', '😮', '🙏'];
      const reactionsHtml = renderReactionsBar(post.id, reactions, myReaction, reactionEmojis);

      // Mentions highlight
      const hasMentions = post.mentions && post.mentions.length > 0;

      // Author avatar (default to 👤 if not set)
      const authorAvatar = post.authorAvatar || '👤';

      return `
        <div class="feed-item ${hasMedia ? 'has-media' : ''} ${post.nsfw ? 'nsfw-post' : ''} ${hasCW ? 'has-cw' : ''} ${distanceClass}" onclick="viewThread('${post.id}')" style="cursor: pointer;">
          <div class="feed-item-wrapper">
            <div class="feed-avatar">${renderAvatar(authorAvatar)}</div>
            <div class="feed-post-content">
              <div class="feed-header">
                <div class="feed-author">
                  <span class="${hasNickname ? 'has-nickname' : ''}" title="${post.author}">${escapeHtml(authorName)}</span>
                  ${!isYou ? `<span class="reputation-badge" style="background-color: ${repColor}" title="Reputation: ${rep.score.toFixed(2)}, Distance: ${rep.distance}">
                    ${rep.distance === 1 ? '1st' : rep.distance === 2 ? '2nd' : '3rd+'}
                  </span>` : ''}
                  ${tagsHtml}
                  ${quickTrustBtn}
                </div>
                <div class="feed-meta">
                  ${trustContext}
                  ${post.nsfw ? '<span class="nsfw-badge">NSFW</span>' : ''}
                  ${hasCW ? `<span class="cw-badge">CW: ${escapeHtml(post.contentWarning)}</span>` : ''}
                </div>
              </div>
              ${post.replyTo ? `<div class="feed-reply-indicator">↳ Reply to ${post.replyTo.slice(0, 8)}...</div>` : ''}
              ${hasCW ? `
                <div class="cw-wrapper" id="${cwId}">
                  <button class="cw-reveal-btn" onclick="event.stopPropagation(); toggleCW('${cwId}')">
                    ⚠️ ${escapeHtml(post.contentWarning)} - Click to reveal
                  </button>
                  <div class="cw-content" style="display: none;">
                    <div class="feed-content">${renderPostContent(post)}</div>
                  </div>
                </div>
              ` : `
                <div class="feed-content">${renderPostContent(post)}</div>
              `}
              <div class="feed-footer">
                <div class="feed-timestamp">🙌 Witnessed ${formatRelativeTime(post.proof?.timestamp || post.timestamp)} ${editedIndicator}</div>
                <div class="feed-actions">
                  ${reactionsHtml}
                  <button class="btn-action ${post.isBookmarked ? 'active' : ''}" onclick="event.stopPropagation(); toggleBookmark('${post.id}')" title="${post.isBookmarked ? 'Remove bookmark' : 'Bookmark'}">
                    ${post.isBookmarked ? 'Saved' : 'Save'}
                  </button>
                  <button class="btn-action" onclick="event.stopPropagation(); startReply('${post.id}', '${escapeHtml(authorName)}')">Reply</button>
                  ${muteBtn}
                  ${authorActions}
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Load tag filter pills after feed loads
    loadTagFilterPills();
  } catch (error) {
    $('feed-list').innerHTML = `<p class="empty-state">Error loading feed: ${error.message}</p>`;
  }
}

// Switch to a specific tab
function switchToTab(tabName) {
  const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (tabBtn) tabBtn.click();
}

// Quick trust a user from feed
async function quickTrust(publicKey) {
  // Visitors cannot trust - show invite popup
  if (!requireMembership()) return;

  try {
    await apiCall('/trust', 'POST', { publicKey });
    showResult('feed-list', `Added ${publicKey.slice(0, 8)}... to your trust circle!`, true);
    // Reload feed to update trust indicators
    setTimeout(() => loadFeed(), 1000);
  } catch (error) {
    alert(`Could not trust user: ${error.message}`);
  }
}

// Mute a user (hide their posts from your feed)
async function muteUser(publicKey, displayName) {
  // Visitors cannot mute - show invite popup
  if (!requireMembership()) return;

  if (!confirm(`Mute ${displayName || publicKey.slice(0, 8)}...?\n\nTheir posts will be hidden from your feed. You can unmute them anytime from the Trust tab.`)) {
    return;
  }
  try {
    await apiCall('/mute', 'POST', { publicKey });
    showResult('feed-list', `Muted ${displayName || publicKey.slice(0, 8)}...`, true);
    // Reload feed to remove their posts
    setTimeout(() => loadFeed(), 500);
  } catch (error) {
    alert(`Could not mute user: ${error.message}`);
  }
}

// Unmute a user
async function unmuteUser(publicKey) {
  try {
    await apiCall('/unmute', 'POST', { publicKey });
    // Reload trusted users list
    await loadTrustedUsers();
    showResult('trust-result', `Unmuted ${publicKey.slice(0, 8)}...`, true);
  } catch (error) {
    alert(`Could not unmute user: ${error.message}`);
  }
}

// =========================================================================
// 6i. POST EDIT & DELETE
// =========================================================================

// Delete a post
async function deletePost(postId) {
  // Visitors cannot delete - show invite popup
  if (!requireMembership()) return;

  if (!confirm('Are you sure you want to delete this post?\n\nThis action creates a deletion request that will be gossiped to the network. The original post still exists cryptographically but will be hidden from feeds.')) {
    return;
  }

  try {
    await apiCall(`/post/${postId}`, 'DELETE', { reason: 'retracted' });
    // Reload feed directly to remove the deleted post
    await loadFeedWithCurrentFilter();
  } catch (error) {
    alert(`Could not delete post: ${error.message}`);
  }
}

// Start editing a post
function startEditPost(postId) {
  // Visitors cannot edit - show invite popup
  if (!requireMembership()) return;

  // Look up content from cache instead of passing inline (avoids escaping issues)
  const cachedPost = postsCache[postId];
  if (!cachedPost) {
    alert('Could not find post to edit. Please refresh the feed.');
    return;
  }
  const currentContent = cachedPost.content || '';

  editingPost = { id: postId, content: currentContent };

  // Switch to post tab
  $$('.tab-btn').forEach(b => b.classList.remove('active'));
  $$('.tab-btn')[1].classList.add('active'); // Post tab is second
  $$('.tab-content').forEach(content => content.classList.remove('active'));
  $('post-tab').classList.add('active');

  // Update UI to show we're editing
  $('post-content').value = currentContent;
  $('post-content').placeholder = 'Edit your post...';
  $('char-count').textContent = currentContent.length;
  $('post-content').focus();

  // Show edit mode indicator
  const helpText = document.querySelector('.help-text');
  helpText.innerHTML = `Editing post ${postId.slice(0, 8)}... <button onclick="cancelEdit()" class="btn btn-small">Cancel</button>`;

  // Change button text
  $('create-post-btn').textContent = 'Save Edit';
}

// Cancel edit
function cancelEdit() {
  editingPost = null;
  $('post-content').value = '';
  $('post-content').placeholder = "What's on your mind?";
  $('char-count').textContent = '0';
  const helpText = document.querySelector('.help-text');
  helpText.textContent = 'Share your thoughts with your trust network';
  $('create-post-btn').textContent = 'Post';
}

// Save edit (modified createPost to handle edits)
async function saveEdit() {
  if (!editingPost) return;

  const content = $('post-content').value.trim();
  const nsfw = $('post-nsfw').checked;
  const cwEnabled = $('post-cw-enabled').checked;
  const contentWarning = cwEnabled ? $('post-cw-text').value.trim() : null;

  if (!content) {
    showResult('post-result', 'Please enter some content', false);
    return;
  }

  try {
    $('create-post-btn').disabled = true;
    $('create-post-btn').textContent = 'Saving...';

    const body = { content, nsfw };
    if (contentWarning) {
      body.contentWarning = contentWarning;
    }

    await apiCall(`/post/${editingPost.id}`, 'PUT', body);

    showResult('post-result', 'Post edited successfully!', true);
    $('post-content').value = '';
    $('char-count').textContent = '0';
    $('post-nsfw').checked = false;
    $('post-cw-enabled').checked = false;
    $('post-cw-text').value = '';
    $('cw-input-wrapper').style.display = 'none';

    // Reset edit state
    cancelEdit();

    // Refresh feed
    await loadFeed();
  } catch (error) {
    showResult('post-result', `Error: ${error.message}`, false);
  } finally {
    $('create-post-btn').disabled = false;
    $('create-post-btn').textContent = 'Post';
  }
}

// =========================================================================
// 6b. REACTIONS
// =========================================================================

// Render reactions bar for a post
function renderReactionsBar(postId, reactions, myReaction, availableEmojis) {
  // Show emojis that have reactions or are available for clicking
  const reactionButtons = availableEmojis.map(emoji => {
    const count = reactions[emoji] || 0;
    const isMyReaction = myReaction === emoji;
    const btnClass = isMyReaction ? 'reaction-btn active' : 'reaction-btn';

    return `<button class="${btnClass}" onclick="event.stopPropagation(); toggleReaction('${postId}', '${emoji}')" title="${emoji}">
      ${emoji}${count > 0 ? `<span class="reaction-count">${count}</span>` : ''}
    </button>`;
  }).join('');

  return `<div class="reactions-bar">${reactionButtons}</div>`;
}

// Toggle a reaction on a post
async function toggleReaction(postId, emoji) {
  // Visitors cannot react - show invite popup
  if (!requireMembership()) return;

  try {
    // Check if we already have this reaction (need to get current state)
    const data = await apiCall(`/reactions/${postId}`);
    const isCurrentlyReacted = data.myReaction === emoji;

    if (isCurrentlyReacted) {
      await apiCall('/unreact', 'POST', { postId, emoji });
    } else {
      await apiCall('/react', 'POST', { postId, emoji });
    }

    // Reload feed to update reactions
    await loadFeed();
  } catch (error) {
    console.error('Error toggling reaction:', error);
  }
}

// =========================================================================
// 6c. CONTENT WARNINGS
// =========================================================================

// Toggle content warning visibility
function toggleCW(cwId) {
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

// =========================================================================
// 6d. BOOKMARKS
// =========================================================================

async function toggleBookmark(postId) {
  // Visitors cannot bookmark - show invite popup
  if (!requireMembership()) return;

  try {
    // Check current state (we'll toggle it)
    const response = await fetch(`/api/bookmarks`);
    const data = await response.json();
    const isCurrentlyBookmarked = data.data.posts.some(p => p.id === postId);

    if (isCurrentlyBookmarked) {
      await apiCall('/unbookmark', 'POST', { postId });
    } else {
      await apiCall('/bookmark', 'POST', { postId });
    }

    // Refresh feed to update bookmark icons
    await loadFeedWithCurrentFilter();
  } catch (error) {
    console.error('Error toggling bookmark:', error);
  }
}

// =========================================================================
// 6e. SEARCH
// =========================================================================

let currentSearchQuery = '';

async function searchPosts() {
  const query = $('feed-search').value.trim();
  if (!query) {
    clearSearch();
    return;
  }

  currentSearchQuery = query;
  showLoading('feed-list');

  try {
    const data = await apiCall(`/search?q=${encodeURIComponent(query)}`);
    $('clear-search-btn').style.display = 'inline-block';

    if (!data.posts || data.posts.length === 0) {
      $('feed-list').innerHTML = `
        <div class="empty-state">
          <p>No posts found for "${escapeHtml(query)}"</p>
          <button class="btn btn-small" onclick="clearSearch()">Clear Search</button>
        </div>
      `;
      return;
    }

    renderSearchResults(data.posts, query);
  } catch (error) {
    $('feed-list').innerHTML = `<p class="empty-state">Search error: ${error.message}</p>`;
  }
}

function renderSearchResults(posts, query) {
  $('feed-list').innerHTML = `
    <div class="search-results-header">
      <span>Found ${posts.length} result${posts.length !== 1 ? 's' : ''} for "${escapeHtml(query)}"</span>
    </div>
  ` + posts.map(post => renderFeedItem(post)).join('');
}

function clearSearch() {
  currentSearchQuery = '';
  $('feed-search').value = '';
  $('clear-search-btn').style.display = 'none';
  loadFeed();
}

// =========================================================================
// 6f. FEED FILTERS
// =========================================================================

let currentFilter = 'all';
let currentTagFilter = null; // Track active tag filter

async function loadFeedWithCurrentFilter() {
  // If we have a tag filter active, use that
  if (currentTagFilter) {
    await loadFeedByTag(currentTagFilter);
    return;
  }

  switch (currentFilter) {
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

// Load and display tag filter pills
async function loadTagFilterPills() {
  try {
    const data = await apiCall('/tags');
    const container = $('tag-filter-pills');
    const wrapper = $('tag-filters');

    if (!data.tags || data.tags.length === 0) {
      wrapper.style.display = 'none';
      return;
    }

    // Show the tag filter section
    wrapper.style.display = 'flex';

    // Build pills HTML
    container.innerHTML = data.tags.map(tag => `
      <button class="tag-pill${currentTagFilter === tag.tag ? ' active' : ''}"
              onclick="filterByTag('${escapeHtml(tag.tag)}')"
              title="${tag.count} users">
        ${escapeHtml(tag.tag)}
      </button>
    `).join('');
  } catch (error) {
    console.error('Error loading tag pills:', error);
    $('tag-filters').style.display = 'none';
  }
}

// Filter feed by tag
async function filterByTag(tag) {
  // Toggle tag filter - clicking same tag clears filter
  if (currentTagFilter === tag) {
    currentTagFilter = null;
  } else {
    currentTagFilter = tag;
  }

  // Update pill states
  $$('.tag-pill').forEach(pill => {
    pill.classList.toggle('active', pill.textContent.trim() === currentTagFilter);
  });

  // Clear the main filter buttons active state if using tag filter
  if (currentTagFilter) {
    $$('.filter-btn').forEach(btn => btn.classList.remove('active'));
  } else {
    // Re-activate 'all' filter
    currentFilter = 'all';
    document.querySelector('.filter-btn[data-filter="all"]').classList.add('active');
  }

  await loadFeedWithCurrentFilter();
}

// Load feed filtered by tag
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
          <button class="btn btn-secondary" onclick="filterByTag('${escapeHtml(tag)}')">Clear Filter</button>
        </div>
      `;
      return;
    }

    $('feed-list').innerHTML = data.posts.map(post => renderFeedItem(post)).join('');
  } catch (error) {
    $('feed-list').innerHTML = `<p class="empty-state">Error loading tagged posts: ${error.message}</p>`;
  }
}

async function setFeedFilter(filter) {
  currentFilter = filter;
  currentTagFilter = null; // Clear tag filter when using main filters

  // Update active button
  $$('.filter-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelector(`.filter-btn[data-filter="${filter}"]`).classList.add('active');

  // Clear tag pill active state
  $$('.tag-pill').forEach(pill => pill.classList.remove('active'));

  await loadFeedWithCurrentFilter();
}

async function loadBookmarks() {
  showLoading('feed-list');
  try {
    const data = await apiCall('/bookmarks');

    if (!data.posts || data.posts.length === 0) {
      $('feed-list').innerHTML = `
        <div class="empty-state-helpful">
          <div class="empty-icon">🔖</div>
          <h4>No bookmarks yet</h4>
          <p>Bookmark posts to save them for later.</p>
        </div>
      `;
      return;
    }

    $('feed-list').innerHTML = data.posts.map(post => renderFeedItem(post)).join('');
  } catch (error) {
    $('feed-list').innerHTML = `<p class="empty-state">Error loading bookmarks: ${error.message}</p>`;
  }
}

async function loadReplies() {
  showLoading('feed-list');
  try {
    const data = await apiCall('/notifications/replies');
    // Mark replies as seen when viewing
    await apiCall('/notifications/mark-seen', 'POST', { type: 'replies' });

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

    $('feed-list').innerHTML = data.posts.map(post => renderFeedItem(post)).join('');
  } catch (error) {
    $('feed-list').innerHTML = `<p class="empty-state">Error loading replies: ${error.message}</p>`;
  }
}

async function loadMentionsView() {
  showLoading('feed-list');
  try {
    const data = await apiCall('/mentions');
    // Mark mentions as seen when viewing
    await apiCall('/notifications/mark-seen', 'POST', { type: 'mentions' });

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

    $('feed-list').innerHTML = data.posts.map(post => renderFeedItem(post)).join('');
  } catch (error) {
    $('feed-list').innerHTML = `<p class="empty-state">Error loading mentions: ${error.message}</p>`;
  }
}

// Helper to render a single feed item (used by search and filters)
function renderFeedItem(post) {
  const hasMedia = post.media && post.media.cid;
  const rep = post.reputation || { score: 0, distance: 0 };
  const repColor = getReputationColor(rep.score);
  const authorName = post.authorDisplayName || post.author.slice(0, 16) + '...';
  const hasCW = !!post.contentWarning;
  const cwId = `cw-${post.id}`;
  const reactions = post.reactions || {};
  const myReaction = post.myReaction;
  const reactionEmojis = ['👍', '❤️', '🔥', '😂', '😮', '🙏'];
  const reactionsHtml = renderReactionsBar(post.id, reactions, myReaction, reactionEmojis);
  // Use server-side isAuthor flag (reliable) instead of window.userPublicKey (may not be set yet)
  const isYou = post.isAuthor || rep.distance === 0;
  const authorAvatar = post.authorAvatar || '👤';
  const distanceClass = `distance-${Math.min(rep.distance, 3)}`;

  // Trust context (Self tag)
  const trustContext = isYou ? '<span class="trust-context trust-self">Self</span>' : '';

  return `
    <div class="feed-item ${hasMedia ? 'has-media' : ''} ${hasCW ? 'has-cw' : ''} ${distanceClass}" onclick="viewThread('${post.id}')" style="cursor: pointer;">
      <div class="feed-item-wrapper">
        <div class="feed-avatar">${renderAvatar(authorAvatar)}</div>
        <div class="feed-post-content">
          <div class="feed-header">
            <div class="feed-author">
              <span title="${post.author}">${escapeHtml(authorName)}</span>
              ${!isYou ? `<span class="reputation-badge" style="background-color: ${repColor}">
                ${rep.distance === 1 ? '1st' : rep.distance === 2 ? '2nd' : '3rd+'}
              </span>` : ''}
            </div>
            <div class="feed-meta">
              ${trustContext}
              ${hasCW ? `<span class="cw-badge">CW: ${escapeHtml(post.contentWarning)}</span>` : ''}
            </div>
          </div>
          ${post.replyTo ? `<div class="feed-reply-indicator">↳ Reply to ${post.replyTo.slice(0, 8)}...</div>` : ''}
          ${hasCW ? `
            <div class="cw-wrapper" id="${cwId}">
              <button class="cw-reveal-btn" onclick="event.stopPropagation(); toggleCW('${cwId}')">
                ⚠️ ${escapeHtml(post.contentWarning)} - Click to reveal
              </button>
              <div class="cw-content" style="display: none;">
                <div class="feed-content">${renderPostContent(post)}</div>
              </div>
            </div>
          ` : `
            <div class="feed-content">${renderPostContent(post)}</div>
          `}
          <div class="feed-footer">
            <div class="feed-timestamp">🙌 Witnessed ${formatRelativeTime(post.proof?.timestamp || post.timestamp)}</div>
            <div class="feed-actions">
              ${reactionsHtml}
              <button class="btn-action ${post.isBookmarked ? 'active' : ''}" onclick="event.stopPropagation(); toggleBookmark('${post.id}')">
                ${post.isBookmarked ? 'Saved' : 'Save'}
              </button>
              <button class="btn-action" onclick="event.stopPropagation(); startReply('${post.id}', '${escapeHtml(authorName)}')">Reply</button>
              ${!isYou ? `<button class="btn-action btn-mute" onclick="event.stopPropagation(); muteUser('${post.author}', '${escapeHtml(authorName)}')" title="Mute">Mute</button>` : ''}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// =========================================================================
// 6g. LIVE UPDATES (Server-Sent Events)
// =========================================================================

let eventSource = null;
let newPostsCount = 0;

function connectLiveUpdates() {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource('/api/live');

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'new_post':
          newPostsCount++;
          showNewPostsBanner();
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

function showNewPostsBanner() {
  const banner = $('new-posts-banner');
  const countSpan = $('new-posts-count');
  countSpan.textContent = newPostsCount;
  banner.style.display = 'block';
}

async function loadNewPosts() {
  newPostsCount = 0;
  $('new-posts-banner').style.display = 'none';
  await loadFeed();
}

// =========================================================================
// 6h. NOTIFICATIONS
// =========================================================================

async function updateNotificationCounts() {
  try {
    const data = await apiCall('/notifications/counts');
    updateNotificationBadges(data);
  } catch (error) {
    console.error('Error fetching notifications:', error);
  }
}

function updateNotificationBadges(counts) {
  // Feed badge (replies + mentions)
  const feedBadge = $('feed-badge');
  const feedCount = (counts.replies || 0) + (counts.mentions || 0);
  if (feedCount > 0) {
    feedBadge.textContent = feedCount;
    feedBadge.style.display = 'inline';
  } else {
    feedBadge.style.display = 'none';
  }

  // Slides badge
  const slidesBadge = $('slides-badge');
  if (counts.slides > 0) {
    slidesBadge.textContent = counts.slides;
    slidesBadge.style.display = 'inline';
  } else {
    slidesBadge.style.display = 'none';
  }
}

// =========================================================================
// 7. TRUST & REPUTATION
// =========================================================================

async function loadTrustedUsers() {
  showLoading('trusted-users-list');
  try {
    const data = await apiCall('/trusted');
    const container = $('trusted-users-list');
    const countBadge = $('trust-count-badge');

    countBadge.textContent = data.count || 0;

    if (!data.users || data.users.length === 0) {
      container.innerHTML = `
        <div class="empty-state-helpful">
          <div class="empty-icon">🌱</div>
          <h4>Your trust circle is empty</h4>
          <p>Start by trusting someone you know. Their posts will appear in your feed, and you'll see posts from people they trust too.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = data.users.map(user => {
      const tags = user.tags || [];
      const tagsHtml = tags.length > 0
        ? `<div class="user-tags">${tags.map(t => `<span class="tag-badge-small">${escapeHtml(t)}</span>`).join('')}</div>`
        : '';
      const hasNickname = !!user.nickname;
      const displayName = user.displayName || user.publicKeyShort + '...';
      const isMuted = user.isMuted || false;
      const isSelf = user.isSelf || false;
      const weight = user.weight ?? 1.0;
      const weightLabel = getWeightLabel(weight);
      const weightClass = weight >= 0.9 ? 'weight-full' : weight >= 0.5 ? 'weight-medium' : 'weight-low';

      // Self entry has special styling - no mute/nickname buttons
      if (isSelf) {
        return `
          <div class="trusted-user-card self-card">
            <div class="trusted-user-info">
              <div class="trusted-user-name" title="${user.publicKey}">
                ${escapeHtml(displayName)}
                <span class="self-badge">You</span>
              </div>
              <div class="trusted-user-key-small">${user.publicKeyShort}...</div>
            </div>
            <div class="trusted-user-actions">
              <button class="btn-small" onclick="copyToClipboard2('${user.publicKey}')">Copy</button>
            </div>
          </div>
        `;
      }

      const muteBtn = isMuted
        ? `<button class="btn-small btn-unmute" onclick="unmuteUser('${user.publicKey}')" title="Unmute">🔊</button>`
        : `<button class="btn-small btn-mute" onclick="muteUser('${user.publicKey}', '${escapeHtml(displayName)}')" title="Mute">🔇</button>`;

      const weightBadge = weight < 1.0
        ? `<span class="weight-badge ${weightClass}" title="${weightLabel}">${weight.toFixed(1)}</span>`
        : '';

      return `
        <div class="trusted-user-card ${isMuted ? 'muted' : ''}">
          <div class="trusted-user-info">
            <div class="trusted-user-name ${hasNickname ? 'has-nickname' : ''} ${isMuted ? 'muted-name' : ''}" title="${user.publicKey}">
              ${escapeHtml(displayName)}
              ${weightBadge}
              ${isMuted ? '<span class="muted-badge">muted</span>' : ''}
            </div>
            <div class="trusted-user-key-small">${user.publicKeyShort}...</div>
            ${tagsHtml}
          </div>
          <div class="trusted-user-actions">
            ${muteBtn}
            <button class="btn-small btn-nickname" onclick="editNickname('${user.publicKey}', '${escapeHtml(user.nickname || '')}')" title="Set nickname">✏️</button>
            <button class="btn-small" onclick="copyToClipboard2('${user.publicKey}')">Copy</button>
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Error loading trusted users:', error);
    $('trusted-users-list').innerHTML = `<p class="empty-state">Error loading trust circle</p>`;
  }
}

// Copy text to clipboard (helper)
function copyToClipboard2(text) {
  navigator.clipboard.writeText(text).then(() => {
    alert('Public key copied!');
  });
}

// Edit nickname for a user
async function editNickname(publicKey, currentNickname) {
  const newNickname = prompt(
    `Set a nickname for ${publicKey.slice(0, 12)}...`,
    currentNickname || ''
  );

  // User cancelled
  if (newNickname === null) return;

  try {
    await apiCall('/nickname', 'POST', {
      publicKey,
      nickname: newNickname.trim()
    });

    // Reload trusted users list and feed to reflect changes
    await loadTrustedUsers();
    await loadFeed();

    if (newNickname.trim()) {
      showResult('trust-result', `Nickname set: "${newNickname.trim()}"`, true);
    } else {
      showResult('trust-result', 'Nickname removed', true);
    }
  } catch (error) {
    showResult('trust-result', `Error: ${error.message}`, false);
  }
}

// Get color for reputation score
function getReputationColor(score) {
  if (score >= 0.8) return '#22c55e'; // green
  if (score >= 0.6) return '#84cc16'; // lime
  if (score >= 0.4) return '#eab308'; // yellow
  if (score >= 0.2) return '#f97316'; // orange
  return '#ef4444'; // red
}

// =========================================================================
// 8. THREAD VIEW
// =========================================================================

async function viewThread(postId) {
  try {
    const data = await apiCall(`/thread/${postId}`);

    // Show thread tab button and switch to it
    // Tab order: Feed(0), Post(1), Trust(2), Slides(3), Profile(4), Thread(5), Settings(6), Identity(7), Stats(8)
    const threadTabBtn = document.querySelector('.tab-btn[data-tab="thread"]');
    threadTabBtn.style.display = 'block';

    $$('.tab-btn').forEach(b => b.classList.remove('active'));
    threadTabBtn.classList.add('active');
    $$('.tab-content').forEach(content => content.classList.remove('active'));
    $('thread-tab').classList.add('active');

    // Display parent post
    const parent = data.parent;
    const parentHasMedia = parent.media && parent.media.cid;
    const parentAuthorName = parent.authorDisplayName || parent.author.slice(0, 16) + '...';
    const parentHasNickname = !!parent.authorNickname;
    const parentAvatar = parent.authorAvatar || '👤';
    const parentTimestamp = parent.proof?.timestamp || parent.timestamp;
    $('thread-parent').innerHTML = `
      <div class="feed-item thread-parent-post ${parentHasMedia ? 'has-media' : ''}">
        <div class="feed-item-wrapper">
          <div class="feed-avatar">${renderAvatar(parentAvatar)}</div>
          <div class="feed-post-content">
            <div class="feed-author"><span class="${parentHasNickname ? 'has-nickname' : ''}" title="${parent.author}">${escapeHtml(parentAuthorName)}</span></div>
            ${parent.replyTo ? `<div class="feed-reply-indicator">↳ Reply to ${parent.replyTo.slice(0, 8)}... <a href="#" onclick="event.preventDefault(); viewThread('${parent.replyTo}')">View parent</a></div>` : ''}
            <div class="feed-content">${renderPostContent(parent)}</div>
            <div class="feed-footer">
              <div class="feed-timestamp">${parentTimestamp ? new Date(parentTimestamp).toLocaleString() : 'Unknown'}</div>
              <button class="btn-reply" onclick="startReply('${parent.id}', '${escapeHtml(parentAuthorName)}')">Reply</button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Display replies
    const repliesList = $('thread-replies-list');
    if (data.replies.length === 0) {
      repliesList.innerHTML = '<p class="empty-state">No replies yet. Be the first to reply!</p>';
    } else {
      repliesList.innerHTML = data.replies.map(reply => {
        const replyHasMedia = reply.media && reply.media.cid;
        const replyAuthorName = reply.authorDisplayName || reply.author.slice(0, 16) + '...';
        const replyHasNickname = !!reply.authorNickname;
        const replyAvatar = reply.authorAvatar || '👤';
        const replyTimestamp = reply.proof?.timestamp || reply.timestamp;
        return `
          <div class="feed-item ${replyHasMedia ? 'has-media' : ''}" onclick="viewThread('${reply.id}')" style="cursor: pointer;">
            <div class="feed-item-wrapper">
              <div class="feed-avatar">${renderAvatar(replyAvatar)}</div>
              <div class="feed-post-content">
                <div class="feed-author"><span class="${replyHasNickname ? 'has-nickname' : ''}" title="${reply.author}">${escapeHtml(replyAuthorName)}</span></div>
                <div class="feed-content">${renderPostContent(reply)}</div>
                <div class="feed-footer">
                  <div class="feed-timestamp">${replyTimestamp ? new Date(replyTimestamp).toLocaleString() : 'Unknown'}</div>
                  <button class="btn-reply" onclick="event.stopPropagation(); startReply('${reply.id}', '${escapeHtml(replyAuthorName)}')">Reply</button>
                </div>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
  } catch (error) {
    console.error('Error loading thread:', error);
    alert(`Error loading thread: ${error.message}`);
  }
}

// =========================================================================
// 9. POST CREATION
// =========================================================================

function startReply(postId, author) {
  // Visitors cannot reply - show invite popup
  if (!requireMembership()) return;

  replyingTo = postId;

  // Switch to post tab
  $$('.tab-btn').forEach(b => b.classList.remove('active'));
  $$('.tab-btn')[1].classList.add('active'); // Post tab is second
  $$('.tab-content').forEach(content => content.classList.remove('active'));
  $('post-tab').classList.add('active');

  // Update UI to show we're replying
  $('post-content').placeholder = `Reply to ${author}...`;
  $('post-content').focus();

  // Show cancel button
  const helpText = document.querySelector('.help-text');
  helpText.innerHTML = `Replying to post ${postId.slice(0, 8)}... <button onclick="cancelReply()" class="btn btn-small">Cancel</button>`;
}

// Cancel Reply
function cancelReply() {
  replyingTo = null;
  $('post-content').placeholder = "What's on your mind?";
  const helpText = document.querySelector('.help-text');
  helpText.textContent = 'Share your thoughts with your trust network';
}

// Create Post (or save edit if editing)
async function createPost() {
  // Visitors cannot post - show invite popup
  if (!requireMembership()) return;

  // If we're editing, call saveEdit instead
  if (editingPost) {
    await saveEdit();
    return;
  }

  const content = $('post-content').value.trim();
  const nsfw = $('post-nsfw').checked;
  const cwEnabled = $('post-cw-enabled').checked;
  const contentWarning = cwEnabled ? $('post-cw-text').value.trim() : null;

  // Allow posts with just media (no text required)
  if (!content && !pendingMedia) {
    showResult('post-result', 'Please enter some content or attach media', false);
    return;
  }

  // Validate content warning if enabled
  if (cwEnabled && !contentWarning) {
    showResult('post-result', 'Please enter a content warning description', false);
    return;
  }

  try {
    $('create-post-btn').disabled = true;
    $('create-post-btn').textContent = 'Posting...';

    const body = { content, nsfw };
    if (replyingTo) {
      body.replyTo = replyingTo;
    }
    // Include media CID if we have pending media
    if (pendingMedia && pendingMedia.cid) {
      body.mediaCid = pendingMedia.cid;
    }
    // Include content warning if set
    if (contentWarning) {
      body.contentWarning = contentWarning;
    }

    const postResult = await apiCall('/post', 'POST', body);

    // If a ticket was just minted, start the timer
    if (postResult.ticketInfo && postResult.ticketInfo.expiry) {
      startDayPassTimer(postResult.ticketInfo.expiry);
    }

    const hasMedia = pendingMedia !== null;
    showResult('post-result',
      replyingTo
        ? (hasMedia ? 'Reply with media posted!' : 'Reply posted!')
        : (hasMedia ? 'Post with media created!' : 'Post created successfully!'),
      true
    );
    $('post-content').value = '';
    $('char-count').textContent = '0';
    $('post-nsfw').checked = false; // Reset NSFW checkbox
    $('post-cw-enabled').checked = false; // Reset CW checkbox
    $('post-cw-text').value = ''; // Clear CW text
    $('cw-input-wrapper').style.display = 'none'; // Hide CW input

    // Clear media preview
    clearMediaPreview();

    // Reset reply state
    if (replyingTo) {
      cancelReply();
    }

    // Refresh feed
    await loadFeed();
  } catch (error) {
    // Check if this is an invitation-required error
    if (isInvitationRequiredError(error)) {
      showInvitePopover();
    } else {
      showResult('post-result', `Error: ${error.message}`, false);
    }
  } finally {
    $('create-post-btn').disabled = false;
    $('create-post-btn').textContent = 'Post';
  }
}

// Trust a new user
async function trustUser() {
  // Visitors cannot trust - show invite popup
  if (!requireMembership()) return;

  const publicKey = $('trust-public-key').value.trim();

  if (!publicKey) {
    showResult('trust-result', 'Please enter a public key', false);
    return;
  }

  // Get weight from slider (0.1 to 1.0)
  const weightSlider = $('trust-weight');
  const weight = weightSlider ? parseInt(weightSlider.value, 10) / 100 : 1.0;

  try {
    $('trust-btn').disabled = true;
    $('trust-btn').textContent = 'Adding...';

    await apiCall('/trust', 'POST', { publicKey, weight });

    const weightLabel = getWeightLabel(weight);
    showResult('trust-result', `Added ${publicKey.slice(0, 8)}... with ${weightLabel} (${weight.toFixed(1)})`, true);
    $('trust-public-key').value = '';

    // Reset weight slider to default
    if (weightSlider) {
      weightSlider.value = 100;
      updateTrustWeightDisplay();
    }

    // Reload the trusted users list
    await loadTrustedUsers();
  } catch (error) {
    showResult('trust-result', `Error: ${error.message}`, false);
  } finally {
    $('trust-btn').disabled = false;
    $('trust-btn').textContent = 'Trust';
  }
}

// Get human-readable label for trust weight
function getWeightLabel(weight) {
  if (weight >= 0.9) return 'Full Trust';
  if (weight >= 0.7) return 'High Trust';
  if (weight >= 0.5) return 'Medium Trust';
  if (weight >= 0.3) return 'Low Trust';
  return 'Minimal Trust';
}

// Update trust weight display when slider changes
function updateTrustWeightDisplay() {
  const slider = $('trust-weight');
  const valueDisplay = $('trust-weight-value');
  const labelDisplay = $('trust-weight-label');

  if (!slider || !valueDisplay) return;

  const weight = parseInt(slider.value, 10) / 100;
  valueDisplay.textContent = weight.toFixed(1);

  if (labelDisplay) {
    labelDisplay.textContent = getWeightLabel(weight);
  }
}

// =========================================================================
// 10. SLIDES (Encrypted DMs)
// =========================================================================

async function sendSlide() {
  // Visitors cannot send slides - show invite popup
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

    // Refresh slides
    await loadSlides();
  } catch (error) {
    showResult('slide-result', `Error: ${error.message}`, false);
  } finally {
    $('send-slide-btn').disabled = false;
    $('send-slide-btn').textContent = 'Send Encrypted Slide';
  }
}

// Load Slides
async function loadSlides() {
  showLoading('slides-list');
  try {
    const data = await apiCall('/slides');
    const slidesList = $('slides-list');

    // Update badge
    updateSlidesBadge(data.slides?.length || 0);

    if (!data.slides || data.slides.length === 0) {
      slidesList.innerHTML = `
        <div class="empty-state-helpful">
          <div class="empty-icon">📬</div>
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
          <button class="btn btn-small" onclick="startSlideReply('${slide.sender}')">Reply</button>
        </div>
      `;
    }).join('');
  } catch (error) {
    $('slides-list').innerHTML = `<p class="empty-state">Error loading slides: ${error.message}</p>`;
  }
}

// Update slides notification badge
function updateSlidesBadge(count) {
  const badge = $('slides-badge');
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

// Start Slide Reply
function startSlideReply(recipientKey) {
  $('slide-recipient').value = recipientKey;
  $('slide-message').focus();
}

// =========================================================================
// 11. IDENTITY & PROFILE
// =========================================================================

async function loadIdentity() {
  try {
    const data = await apiCall('/identity');

    $('identity-public-key').textContent = data.publicKey;
    $('identity-created').textContent = formatRelativeTime(data.created);

    // Store public key for QR code generation
    window.userPublicKey = data.publicKey;
  } catch (error) {
    console.error('Error loading identity:', error);
  }
}

// Format relative time (e.g., "2 hours ago")
function formatRelativeTime(timestamp) {
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

// Toggle QR Code Display
let qrCodeGenerated = false;
window.toggleQRCode = function() {
  const container = $('qr-code-container');
  const isHidden = container.style.display === 'none';

  if (isHidden) {
    // Show QR code
    container.style.display = 'block';

    // Generate QR code only once
    if (!qrCodeGenerated && window.userPublicKey) {
      const qrContainer = $('qr-code');
      qrContainer.innerHTML = ''; // Clear any previous QR code

      // Generate QR code using QRCode.js
      new QRCode(qrContainer, {
        text: window.userPublicKey,
        width: 256,
        height: 256,
        colorDark: '#f1f5f9',
        colorLight: '#0f172a',
        correctLevel: QRCode.CorrectLevel.M
      });

      qrCodeGenerated = true;
    }
  } else {
    // Hide QR code
    container.style.display = 'none';
  }
};

// Load Stats
async function loadStats() {
  try {
    const data = await apiCall('/stats');

    // Get actual feed count
    const feedData = await apiCall('/feed');
    const feedCount = feedData.totalPosts || feedData.posts?.length || 0;

    $('stat-posts').textContent = feedCount;
    $('stat-trusted').textContent = data.identity?.trustCount || 0;
    $('stat-network').textContent = feedCount; // Network size = posts visible to you
  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

// Copy to clipboard
window.copyToClipboard = function(elementId) {
  const text = $(elementId).textContent;
  navigator.clipboard.writeText(text).then(() => {
    alert('Copied to clipboard!');
  });
};

// Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Render avatar - handles both URLs (as <img>) and emojis (as text)
function renderAvatar(avatar) {
  if (!avatar) return '👤';
  // Check if it's a URL
  if (avatar.startsWith('http://') || avatar.startsWith('https://')) {
    return `<img src="${escapeHtml(avatar)}" alt="avatar" class="avatar-img" onerror="this.outerHTML='👤'">`;
  }
  // Otherwise treat as emoji/text
  return escapeHtml(avatar);
}

// =========================================================================
// 12. MEDIA UPLOAD
// =========================================================================

// Format file size for display
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Setup media upload handlers
function setupMediaUpload() {
  const dropZone = $('media-drop-zone');
  const fileInput = $('media-input');
  const browseBtn = $('media-browse-btn');
  const removeBtn = $('media-remove-btn');

  // Browse button click
  browseBtn.addEventListener('click', (e) => {
    e.preventDefault();
    fileInput.click();
  });

  // File input change
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleMediaFile(e.target.files[0]);
    }
  });

  // Remove media button
  removeBtn.addEventListener('click', () => {
    clearMediaPreview();
  });

  // Drag and drop handlers
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
      handleMediaFile(e.dataTransfer.files[0]);
    }
  });
}

// Handle selected media file
async function handleMediaFile(file) {
  // Validate file type
  const allowedTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    'video/mp4', 'video/webm', 'video/ogg',
    'audio/mpeg', 'audio/ogg', 'audio/wav',
    'application/pdf'
  ];

  if (!allowedTypes.includes(file.type)) {
    showResult('post-result', `Unsupported file type: ${file.type}`, false);
    return;
  }

  // Validate file size (100MB max)
  if (file.size > 100 * 1024 * 1024) {
    showResult('post-result', 'File too large. Maximum size is 100MB.', false);
    return;
  }

  // Show preview
  showMediaPreview(file);

  // Upload to server
  await uploadMedia(file);
}

// Show media preview
function showMediaPreview(file) {
  const preview = $('media-preview');
  const dropZone = $('media-drop-zone');
  const previewContent = $('media-preview-content');

  $('media-preview-name').textContent = file.name;
  $('media-preview-size').textContent = formatFileSize(file.size);

  // Clear previous preview
  previewContent.innerHTML = '';

  // Create preview based on file type
  if (file.type.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    img.onload = () => URL.revokeObjectURL(img.src);
    previewContent.appendChild(img);
  } else if (file.type.startsWith('video/')) {
    const video = document.createElement('video');
    video.src = URL.createObjectURL(file);
    video.controls = true;
    video.muted = true;
    previewContent.appendChild(video);
  } else if (file.type.startsWith('audio/')) {
    const audio = document.createElement('audio');
    audio.src = URL.createObjectURL(file);
    audio.controls = true;
    previewContent.appendChild(audio);
  } else {
    // PDF or other - show icon
    const icon = document.createElement('div');
    icon.className = 'file-icon';
    icon.innerHTML = file.type === 'application/pdf' ? '📄 PDF' : '📁 File';
    previewContent.appendChild(icon);
  }

  dropZone.style.display = 'none';
  preview.style.display = 'block';
}

// Upload media to server
async function uploadMedia(file) {
  const progressContainer = $('media-upload-progress');
  const progressFill = $('progress-fill');
  const progressText = $('progress-text');

  progressContainer.style.display = 'block';
  progressFill.style.width = '0%';
  progressText.textContent = 'Uploading...';

  try {
    // Read file as ArrayBuffer
    const buffer = await file.arrayBuffer();

    // Upload using raw binary
    const response = await fetch(`${API_BASE}/media/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': file.type,
        'X-Filename': file.name
      },
      body: buffer
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Upload failed');
    }

    // Store uploaded media info
    pendingMedia = data.data;

    progressFill.style.width = '100%';
    progressText.textContent = 'Uploaded!';

    setTimeout(() => {
      progressContainer.style.display = 'none';
    }, 1000);

    console.log('Media uploaded:', pendingMedia);
  } catch (error) {
    console.error('Upload error:', error);
    progressText.textContent = `Error: ${error.message}`;
    progressFill.style.backgroundColor = '#ef4444';

    // Clear pending media on error
    pendingMedia = null;
  }
}

// Clear media preview
function clearMediaPreview() {
  const preview = $('media-preview');
  const dropZone = $('media-drop-zone');
  const previewContent = $('media-preview-content');
  const progressContainer = $('media-upload-progress');
  const fileInput = $('media-input');

  preview.style.display = 'none';
  dropZone.style.display = 'block';
  previewContent.innerHTML = '';
  progressContainer.style.display = 'none';
  fileInput.value = '';
  pendingMedia = null;
}

// Render media in post content
function renderPostContent(post) {
  let content = escapeHtml(post.content);

  // Check if post has media
  if (post.media && post.media.cid) {
    const mediaUrl = `${API_BASE}/media/${post.media.cid}`;
    const mimeType = post.media.mimeType;

    // Remove media link from content display
    content = content.replace(/\[clout-media:\s*[^\]]+\]/g, '');

    // Add media element
    let mediaHtml = '';
    if (mimeType.startsWith('image/')) {
      mediaHtml = `<div class="post-media"><img src="${mediaUrl}" alt="Post media" loading="lazy"></div>`;
    } else if (mimeType.startsWith('video/')) {
      mediaHtml = `<div class="post-media"><video src="${mediaUrl}" controls preload="metadata"></video></div>`;
    } else if (mimeType.startsWith('audio/')) {
      mediaHtml = `<div class="post-media"><audio src="${mediaUrl}" controls></audio></div>`;
    } else if (mimeType === 'application/pdf') {
      mediaHtml = `<div class="post-media post-media-file"><a href="${mediaUrl}" target="_blank" class="media-link">📄 View PDF</a></div>`;
    }

    return content.trim() + mediaHtml;
  }

  // Check for [clout-media: CID] pattern in content (fallback)
  const mediaMatch = post.content.match(/\[clout-media:\s*([^\]]+)\]/);
  if (mediaMatch) {
    const cid = mediaMatch[1].trim();
    const mediaUrl = `${API_BASE}/media/${cid}`;
    content = content.replace(/\[clout-media:\s*[^\]]+\]/g, '');

    // Default to image for unknown media
    return content.trim() + `<div class="post-media"><img src="${mediaUrl}" alt="Post media" loading="lazy" onerror="this.parentElement.innerHTML='<span class=\\'media-error\\'>Media unavailable</span>'"></div>`;
  }

  return content;
}

// Character counter for post
function setupCharCounter() {
  const textarea = $('post-content');
  const counter = $('char-count');

  textarea.addEventListener('input', () => {
    counter.textContent = textarea.value.length;
  });

  // Bio character counter
  const bioTextarea = $('profile-bio');
  const bioCounter = $('bio-char-count');
  bioTextarea.addEventListener('input', () => {
    bioCounter.textContent = bioTextarea.value.length;
  });
}

// Profile functions
async function loadProfile() {
  try {
    const data = await apiCall('/identity');
    const profile = data;

    // Update display
    $('profile-name-display').textContent = profile.metadata?.displayName || '(No name set)';
    $('profile-bio-display').textContent = profile.metadata?.bio || '';
    $('profile-avatar-display').innerHTML = renderAvatar(profile.metadata?.avatar);
    $('profile-key-display').textContent = profile.publicKey.slice(0, 16) + '...';

    // Show bio only if it exists
    if (profile.metadata?.bio) {
      $('profile-bio-display').style.display = 'block';
    } else {
      $('profile-bio-display').style.display = 'none';
    }
  } catch (error) {
    console.error('Failed to load profile:', error);
  }
}

function showProfileEdit() {
  // Load current values into form
  apiCall('/identity').then(data => {
    const profile = data;
    $('profile-name').value = profile.metadata?.displayName || '';
    $('profile-bio').value = profile.metadata?.bio || '';
    $('profile-avatar').value = profile.metadata?.avatar || '';
    $('bio-char-count').textContent = ($('profile-bio').value || '').length;
  });

  // Toggle view/edit
  $('profile-view').style.display = 'none';
  $('profile-edit').style.display = 'block';
  $('profile-result').style.display = 'none';
}

function cancelProfileEdit() {
  $('profile-view').style.display = 'block';
  $('profile-edit').style.display = 'none';
  $('profile-result').style.display = 'none';
}

async function saveProfile() {
  // Visitors cannot save profile - show invite popup
  if (!requireMembership()) return;

  const displayName = $('profile-name').value.trim();
  const bio = $('profile-bio').value.trim();
  const avatar = $('profile-avatar').value.trim();

  try {
    $('save-profile-btn').disabled = true;
    $('save-profile-btn').textContent = 'Saving...';

    await apiCall('/profile', 'POST', { displayName, bio, avatar });

    showResult('profile-result', 'Profile updated! Changes will sync to peers automatically.', true);

    // Reload profile display
    await loadProfile();

    // Switch back to view mode after short delay
    setTimeout(() => {
      cancelProfileEdit();
    }, 1500);
  } catch (error) {
    showResult('profile-result', `Error: ${error.message}`, false);
  } finally {
    $('save-profile-btn').disabled = false;
    $('save-profile-btn').textContent = 'Save Profile';
  }
}

// =========================================================================
// 13. SETTINGS
// =========================================================================

// Load Settings
async function loadSettings() {
  try {
    const data = await apiCall('/settings');

    // Update form fields
    $('settings-nsfw-enabled').checked = data.nsfwEnabled || false;
    $('settings-max-hops').value = data.trustSettings?.maxHops || 3;

    const minRep = data.trustSettings?.minReputation || 0.3;
    $('settings-min-reputation').value = Math.round(minRep * 100);
    $('settings-min-reputation-value').textContent = minRep.toFixed(2);

    // Load content type filters (media settings)
    const filters = data.trustSettings?.contentTypeFilters || {};
    const defaultHops = data.trustSettings?.maxHops || 3;

    // Map content type patterns to select values
    const imageHops = filters['image/*']?.maxHops ?? defaultHops;
    const videoHops = filters['video/*']?.maxHops ?? defaultHops;
    const audioHops = filters['audio/*']?.maxHops ?? defaultHops;

    $('media-filter-images-hops').value = imageHops;
    $('media-filter-videos-hops').value = videoHops;
    $('media-filter-audio-hops').value = audioHops;

    // Load auto follow-back setting
    $('settings-auto-follow-back').checked = data.trustSettings?.autoFollowBack || false;

    // Show admin section if available
    if (data.admin && data.admin.enabled) {
      $('admin-section').style.display = 'block';
      $('freebird-admin-link').href = data.admin.freebirdUrl;
    } else {
      $('admin-section').style.display = 'none';
    }

    // Load tags
    await loadTags();
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

// Save Settings
async function saveSettings() {
  // Visitors cannot save settings - show invite popup
  if (!requireMembership()) return;

  try {
    $('save-settings-btn').disabled = true;
    $('save-settings-btn').textContent = 'Saving...';

    const settings = {
      showNsfw: $('settings-nsfw-enabled').checked,
      maxHops: parseInt($('settings-max-hops').value),
      minReputation: parseInt($('settings-min-reputation').value) / 100,
      autoFollowBack: $('settings-auto-follow-back').checked
    };

    await apiCall('/settings', 'POST', settings);
    showResult('settings-result', 'Settings saved!', true);
  } catch (error) {
    showResult('settings-result', `Error: ${error.message}`, false);
  } finally {
    $('save-settings-btn').disabled = false;
    $('save-settings-btn').textContent = 'Save Settings';
  }
}

// Save Media Filter Settings
async function saveMediaFilters() {
  // Visitors cannot save settings - show invite popup
  if (!requireMembership()) return;

  try {
    $('save-media-filters-btn').disabled = true;
    $('save-media-filters-btn').textContent = 'Saving...';

    const imageHops = parseInt($('media-filter-images-hops').value);
    const videoHops = parseInt($('media-filter-videos-hops').value);
    const audioHops = parseInt($('media-filter-audio-hops').value);
    const defaultHops = parseInt($('settings-max-hops').value) || 3;

    // Only set filters for media types that differ from default
    const promises = [];

    if (imageHops !== defaultHops) {
      promises.push(apiCall('/settings/content-filter', 'POST', {
        contentType: 'image/*',
        maxHops: imageHops,
        minReputation: 0.3
      }));
    }

    if (videoHops !== defaultHops) {
      promises.push(apiCall('/settings/content-filter', 'POST', {
        contentType: 'video/*',
        maxHops: videoHops,
        minReputation: 0.3
      }));
    }

    if (audioHops !== defaultHops) {
      promises.push(apiCall('/settings/content-filter', 'POST', {
        contentType: 'audio/*',
        maxHops: audioHops,
        minReputation: 0.3
      }));
    }

    // If set to default, we should still save (to ensure they're applied)
    if (promises.length === 0) {
      // Save all with their current values
      promises.push(
        apiCall('/settings/content-filter', 'POST', { contentType: 'image/*', maxHops: imageHops, minReputation: 0.3 }),
        apiCall('/settings/content-filter', 'POST', { contentType: 'video/*', maxHops: videoHops, minReputation: 0.3 }),
        apiCall('/settings/content-filter', 'POST', { contentType: 'audio/*', maxHops: audioHops, minReputation: 0.3 })
      );
    }

    await Promise.all(promises);

    showResult('media-filter-result', 'Media settings saved!', true);
  } catch (error) {
    showResult('media-filter-result', `Error: ${error.message}`, false);
  } finally {
    $('save-media-filters-btn').disabled = false;
    $('save-media-filters-btn').textContent = 'Save Media Settings';
  }
}

// Load Tags
async function loadTags() {
  try {
    const data = await apiCall('/tags');
    const tagsList = $('tags-list');

    if (!data.tags || data.tags.length === 0) {
      tagsList.innerHTML = '<p class="empty-state">No tags yet</p>';
      return;
    }

    tagsList.innerHTML = data.tags.map(tag => `
      <div class="tag-item">
        <span class="tag-name">${escapeHtml(tag.tag)}</span>
        <span class="tag-count">${tag.count} users</span>
        <button class="btn btn-small" onclick="viewTagUsers('${escapeHtml(tag.tag)}')">View</button>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading tags:', error);
    $('tags-list').innerHTML = '<p class="empty-state">Error loading tags</p>';
  }
}

// View users with a specific tag
async function viewTagUsers(tag) {
  try {
    const data = await apiCall(`/tags/${encodeURIComponent(tag)}/users`);
    const users = data.users || [];

    if (users.length === 0) {
      alert(`No users with tag "${tag}"`);
      return;
    }

    const userList = users.map(u => `${u.short}... (${u.publicKey})`).join('\n');
    alert(`Users with tag "${tag}":\n\n${userList}`);
  } catch (error) {
    alert(`Error: ${error.message}`);
  }
}

// Add Tag
async function addTag() {
  const tag = $('new-tag-name').value.trim();
  const publicKey = $('new-tag-user').value.trim();

  if (!tag || !publicKey) {
    showResult('tag-result', 'Please enter both tag name and user public key', false);
    return;
  }

  try {
    $('add-tag-btn').disabled = true;
    await apiCall('/tags', 'POST', { tag, publicKey });

    showResult('tag-result', `Tag "${tag}" added to user!`, true);
    $('new-tag-name').value = '';
    $('new-tag-user').value = '';

    // Reload tags in Trust tab and Feed tag pills
    await loadTags();
    loadTagFilterPills();
  } catch (error) {
    showResult('tag-result', `Error: ${error.message}`, false);
  } finally {
    $('add-tag-btn').disabled = false;
  }
}

// =========================================================================
// DATA MANAGEMENT (Export/Import/Identities)
// =========================================================================

// Export backup - downloads a JSON file
async function exportBackup() {
  try {
    $('export-backup-btn').disabled = true;
    $('export-backup-btn').textContent = 'Exporting...';

    const response = await fetch('/api/data/export');
    if (!response.ok) throw new Error('Export failed');

    const backup = await response.json();

    // Create download link
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clout-backup-${backup.identity.publicKey.slice(0, 8)}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    alert('Backup downloaded successfully!');
  } catch (error) {
    alert(`Export failed: ${error.message}`);
  } finally {
    $('export-backup-btn').disabled = false;
    $('export-backup-btn').textContent = 'Download Backup';
  }
}

// Import backup from file
async function importBackup(file) {
  try {
    const text = await file.text();
    const backup = JSON.parse(text);

    // Validate
    if (!backup.version) {
      throw new Error('Invalid backup file format');
    }

    $('import-backup-btn').disabled = true;
    $('import-backup-btn').textContent = 'Importing...';

    const result = await apiCall('/data/import', 'POST', backup);

    showResult('import-result',
      `Imported: ${result.postsImported} posts, ${result.trustSignalsImported} trust signals` +
      (result.localDataImported ? ', local data' : ''),
      true);

    // Reload feed to show imported content
    setTimeout(() => loadFeed(), 1000);
  } catch (error) {
    showResult('import-result', `Import failed: ${error.message}`, false);
  } finally {
    $('import-backup-btn').disabled = false;
    $('import-backup-btn').textContent = 'Select Backup File';
    $('import-backup-input').value = '';
  }
}

// Load identities list
async function loadIdentities() {
  try {
    const data = await apiCall('/data/identities');
    const container = $('identities-list');

    if (!data.identities || data.identities.length === 0) {
      container.innerHTML = '<p class="empty-state">No identities found</p>';
      return;
    }

    container.innerHTML = data.identities.map(id => `
      <div class="identity-card ${id.isDefault ? 'active' : ''}">
        <div class="identity-info">
          <div class="identity-name">
            ${escapeHtml(id.name)}
            ${id.isDefault ? '<span class="identity-badge active">Active</span>' : ''}
          </div>
          <div class="identity-key">${id.publicKeyShort}...</div>
          <div class="identity-created">Created ${formatRelativeTime(id.created)}</div>
        </div>
        <div class="identity-actions">
          ${!id.isDefault ? `<button class="btn-small" onclick="switchIdentity('${escapeHtml(id.name)}')">Switch</button>` : ''}
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading identities:', error);
    $('identities-list').innerHTML = '<p class="empty-state">Error loading identities</p>';
  }
}

// Switch to a different identity (requires restart)
async function switchIdentity(name) {
  if (!confirm(`Switch to identity "${name}"?\n\nThis requires restarting the server to take effect.`)) {
    return;
  }

  try {
    const result = await apiCall('/data/identities/switch', 'POST', { name });
    alert(result.message || 'Identity switched. Please restart the server.');
    await loadIdentities();
  } catch (error) {
    alert(`Failed to switch identity: ${error.message}`);
  }
}

// Create new identity
async function createIdentity() {
  const name = $('new-identity-name').value.trim();

  if (!name) {
    showResult('identity-result', 'Please enter an identity name', false);
    return;
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    showResult('identity-result', 'Name can only contain letters, numbers, underscores, and hyphens', false);
    return;
  }

  try {
    $('create-identity-btn').disabled = true;
    await apiCall('/data/identities', 'POST', { name, setDefault: false });

    showResult('identity-result', `Identity "${name}" created!`, true);
    $('new-identity-name').value = '';

    await loadIdentities();
  } catch (error) {
    showResult('identity-result', `Error: ${error.message}`, false);
  } finally {
    $('create-identity-btn').disabled = false;
  }
}

// Export current identity secret key
async function exportIdentityKey() {
  if (!confirm('WARNING: Your secret key gives full control of your identity!\n\nOnly export this if you need to backup or move your identity to another device.\n\nContinue?')) {
    return;
  }

  try {
    const currentIdentity = await apiCall('/data/identity/current');
    const result = await apiCall(`/data/identities/${currentIdentity.name}/export`);

    // Show in a prompt so they can copy it
    const key = result.secretKey;
    prompt('Your secret key (copy this and keep it safe!):', key);
  } catch (error) {
    alert(`Failed to export key: ${error.message}`);
  }
}

// Import identity from secret key
async function importIdentityKey() {
  const name = $('import-identity-name').value.trim();
  const secretKey = $('import-identity-key').value.trim();

  if (!name || !secretKey) {
    showResult('identity-result', 'Please enter both name and secret key', false);
    return;
  }

  try {
    $('import-identity-btn').disabled = true;
    await apiCall('/data/identities/import', 'POST', { name, secretKey, setDefault: false });

    showResult('identity-result', `Identity "${name}" imported!`, true);
    $('import-identity-name').value = '';
    $('import-identity-key').value = '';

    await loadIdentities();
  } catch (error) {
    showResult('identity-result', `Error: ${error.message}`, false);
  } finally {
    $('import-identity-btn').disabled = false;
  }
}

// Setup settings event listeners
function setupSettings() {
  // Min reputation slider
  $('settings-min-reputation').addEventListener('input', (e) => {
    $('settings-min-reputation-value').textContent = (e.target.value / 100).toFixed(2);
  });

  // Save settings button
  $('save-settings-btn').addEventListener('click', saveSettings);

  // Save media filters button
  $('save-media-filters-btn').addEventListener('click', saveMediaFilters);

  // Add tag button
  $('add-tag-btn').addEventListener('click', addTag);

  // Data management
  $('export-backup-btn').addEventListener('click', exportBackup);
  $('import-backup-btn').addEventListener('click', () => $('import-backup-input').click());
  $('import-backup-input').addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      importBackup(e.target.files[0]);
    }
  });

  // Identity management
  $('create-identity-btn').addEventListener('click', createIdentity);
  $('export-identity-btn').addEventListener('click', exportIdentityKey);
  $('import-identity-btn').addEventListener('click', importIdentityKey);
}

// =========================================================================
// 14. APP BOOTSTRAP
// =========================================================================

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupCharCounter();
  setupMediaUpload();
  setupSettings();

  // Event listeners
  $('init-btn').addEventListener('click', initializeClout);
  $('create-post-btn').addEventListener('click', createPost);
  $('trust-btn').addEventListener('click', trustUser);
  $('refresh-feed-btn').addEventListener('click', loadFeed);
  $('send-slide-btn').addEventListener('click', sendSlide);
  $('refresh-slides-btn').addEventListener('click', loadSlides);
  $('back-to-feed-btn').addEventListener('click', () => {
    // Switch back to feed tab
    $$('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.tab-btn[data-tab="feed"]').classList.add('active');
    $$('.tab-content').forEach(content => content.classList.remove('active'));
    $('feed-tab').classList.add('active');

    // Hide thread tab button
    document.querySelector('.tab-btn[data-tab="thread"]').style.display = 'none';

    // Reload feed
    loadFeed();
  });

  // Character counter for slide message
  $('slide-message').addEventListener('input', () => {
    $('slide-char-count').textContent = $('slide-message').value.length;
  });

  // Content warning toggle
  $('post-cw-enabled').addEventListener('change', (e) => {
    $('cw-input-wrapper').style.display = e.target.checked ? 'block' : 'none';
    if (e.target.checked) {
      $('post-cw-text').focus();
    }
  });

  // Trust weight slider
  const trustWeightSlider = $('trust-weight');
  if (trustWeightSlider) {
    trustWeightSlider.addEventListener('input', updateTrustWeightDisplay);
  }

  // Profile event listeners
  $('edit-profile-btn').addEventListener('click', showProfileEdit);
  $('save-profile-btn').addEventListener('click', saveProfile);
  $('cancel-edit-btn').addEventListener('click', cancelProfileEdit);

  // Search
  $('search-btn').addEventListener('click', searchPosts);
  $('clear-search-btn').addEventListener('click', clearSearch);
  $('feed-search').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchPosts();
  });

  // Feed filters
  $$('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => setFeedFilter(btn.dataset.filter));
  });

  // Auto-initialize on page load
  autoInitialize();
});

// Auto-initialize Clout connection
// Tries to initialize for returning users, falls back to visitor mode
async function autoInitialize() {
  try {
    // Check if server is available
    const health = await apiCall('/health');

    // Try to initialize - will work if an identity already exists on the server
    updateStatus('Connecting...', false);

    try {
      await initializeClout();
      // Successfully initialized - user has an identity
      isVisitor = false;
    } catch (initError) {
      // Initialization failed - likely no identity exists
      // Enter visitor mode: show the feed but require invitation for interactions
      console.log('No existing identity, entering visitor mode');
      isVisitor = true;
      initialized = false;

      // Show main app in visitor mode
      $('init-section').style.display = 'none';
      $('main-app').style.display = 'block';
      updateStatus('Visitor Mode', false);

      // Load the visitor feed (will show welcome message)
      await loadVisitorFeed();
    }
  } catch (error) {
    // Server not responding - show init section for manual retry
    updateStatus('Server not responding. Click Initialize to retry.', false);
    console.error('Auto-init failed:', error);
  }
}

// Load feed in visitor mode
async function loadVisitorFeed() {
  showLoading('feed-list');
  try {
    const data = await apiCall('/feed');
    const feedList = $('feed-list');

    if (data.isVisitor) {
      // Show visitor welcome message
      feedList.innerHTML = `
        <div class="empty-state-helpful visitor-welcome">
          <div class="empty-icon">👋</div>
          <h4>Welcome to Clout</h4>
          <p>${data.message || 'Clout is an invitation-only network. Get an invitation from someone you know to join the conversation.'}</p>
          <div class="empty-actions">
            <button class="btn btn-primary" onclick="showInvitePopover()">🎟️ I Have an Invitation</button>
          </div>
          <p class="help-text" style="margin-top: 1rem;">
            Don't have an invitation? Ask someone in the network to invite you.
          </p>
        </div>
      `;
    } else if (!data.posts || data.posts.length === 0) {
      feedList.innerHTML = `
        <div class="empty-state-helpful">
          <div class="empty-icon">🏠</div>
          <h4>Your feed is quiet</h4>
          <p>Posts from people in your trust circle will appear here.</p>
          <div class="empty-actions">
            <button class="btn btn-primary" onclick="switchToTab('trust')">Add Someone to Trust</button>
            <button class="btn btn-secondary" onclick="switchToTab('post')">Write Your First Post</button>
          </div>
        </div>
      `;
    } else {
      // Regular feed rendering (shouldn't happen in visitor mode)
      renderFeed(data.posts);
    }
  } catch (error) {
    const feedList = $('feed-list');

    // Check if this is a private instance (visitors not allowed)
    if (error.message?.includes('private') || error.message?.includes('Identity required')) {
      // Private instance - show init screen instead
      $('main-app').style.display = 'none';
      $('init-section').style.display = 'block';
      updateStatus('Private Instance - Identity Required', false);
      feedList.innerHTML = '';
    } else {
      feedList.innerHTML = `
        <div class="empty-state-helpful">
          <div class="empty-icon">❌</div>
          <h4>Unable to load feed</h4>
          <p>${error.message}</p>
        </div>
      `;
    }
  }
}
