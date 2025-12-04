// Clout Web UI - Frontend Application

const API_BASE = '/api';
let initialized = false;
let replyingTo = null; // Track which post we're replying to

// Utility functions
const $ = (id) => document.getElementById(id);
const $$ = (selector) => document.querySelectorAll(selector);

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

// Tab Management
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
      if (tab === 'identity') loadIdentity();
      if (tab === 'stats') loadStats();
    });
  });
}

// Initialize Clout
async function initializeClout() {
  try {
    $('init-btn').disabled = true;
    $('init-btn').textContent = 'Initializing...';
    updateStatus('Initializing...', false);

    await apiCall('/init', 'POST');

    initialized = true;
    $('init-section').style.display = 'none';
    $('main-app').style.display = 'block';
    updateStatus('Connected', true);

    // Load initial data
    await loadFeed();
    await loadIdentity();
  } catch (error) {
    updateStatus(`Error: ${error.message}`, false);
    $('init-btn').disabled = false;
    $('init-btn').textContent = 'Initialize Clout';
  }
}

// Load Feed
async function loadFeed() {
  try {
    const data = await apiCall('/feed');
    const feedList = $('feed-list');

    if (!data.posts || data.posts.length === 0) {
      feedList.innerHTML = '<p class="empty-state">No posts yet. Trust someone or create a post!</p>';
      return;
    }

    feedList.innerHTML = data.posts.map(post => `
      <div class="feed-item" onclick="viewThread('${post.id}')" style="cursor: pointer;">
        <div class="feed-author">${post.author.slice(0, 16)}...</div>
        ${post.replyTo ? `<div class="feed-reply-indicator">↳ Reply to ${post.replyTo.slice(0, 8)}...</div>` : ''}
        <div class="feed-content">${escapeHtml(post.content)}</div>
        <div class="feed-footer">
          <div class="feed-timestamp">${new Date(post.timestamp).toLocaleString()}</div>
          <button class="btn-reply" onclick="event.stopPropagation(); startReply('${post.id}', '${post.author.slice(0, 16)}')">Reply</button>
        </div>
      </div>
    `).join('');
  } catch (error) {
    $('feed-list').innerHTML = `<p class="empty-state">Error loading feed: ${error.message}</p>`;
  }
}

// View Thread
async function viewThread(postId) {
  try {
    const data = await apiCall(`/thread/${postId}`);

    // Show thread tab button and switch to it
    const threadTabBtn = $$('.tab-btn')[3]; // Thread tab is 4th
    threadTabBtn.style.display = 'block';

    $$('.tab-btn').forEach(b => b.classList.remove('active'));
    threadTabBtn.classList.add('active');
    $$('.tab-content').forEach(content => content.classList.remove('active'));
    $('thread-tab').classList.add('active');

    // Display parent post
    const parent = data.parent;
    $('thread-parent').innerHTML = `
      <div class="feed-item thread-parent-post">
        <div class="feed-author">${parent.author.slice(0, 16)}...</div>
        ${parent.replyTo ? `<div class="feed-reply-indicator">↳ Reply to ${parent.replyTo.slice(0, 8)}... <a href="#" onclick="event.preventDefault(); viewThread('${parent.replyTo}')">View parent</a></div>` : ''}
        <div class="feed-content">${escapeHtml(parent.content)}</div>
        <div class="feed-footer">
          <div class="feed-timestamp">${new Date(parent.timestamp).toLocaleString()}</div>
          <button class="btn-reply" onclick="startReply('${parent.id}', '${parent.author.slice(0, 16)}')">Reply</button>
        </div>
      </div>
    `;

    // Display replies
    const repliesList = $('thread-replies-list');
    if (data.replies.length === 0) {
      repliesList.innerHTML = '<p class="empty-state">No replies yet. Be the first to reply!</p>';
    } else {
      repliesList.innerHTML = data.replies.map(reply => `
        <div class="feed-item" onclick="viewThread('${reply.id}')" style="cursor: pointer;">
          <div class="feed-author">${reply.author.slice(0, 16)}...</div>
          <div class="feed-content">${escapeHtml(reply.content)}</div>
          <div class="feed-footer">
            <div class="feed-timestamp">${new Date(reply.timestamp).toLocaleString()}</div>
            <button class="btn-reply" onclick="event.stopPropagation(); startReply('${reply.id}', '${reply.author.slice(0, 16)}')">Reply</button>
          </div>
        </div>
      `).join('');
    }
  } catch (error) {
    console.error('Error loading thread:', error);
    alert(`Error loading thread: ${error.message}`);
  }
}

// Start Reply
function startReply(postId, author) {
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

// Create Post
async function createPost() {
  const content = $('post-content').value.trim();

  if (!content) {
    showResult('post-result', 'Please enter some content', false);
    return;
  }

  try {
    $('create-post-btn').disabled = true;
    $('create-post-btn').textContent = 'Posting...';

    const body = { content };
    if (replyingTo) {
      body.replyTo = replyingTo;
    }

    await apiCall('/post', 'POST', body);

    showResult('post-result', replyingTo ? 'Reply posted!' : 'Post created successfully!', true);
    $('post-content').value = '';
    $('char-count').textContent = '0';

    // Reset reply state
    if (replyingTo) {
      cancelReply();
    }

    // Refresh feed
    await loadFeed();
  } catch (error) {
    showResult('post-result', `Error: ${error.message}`, false);
  } finally {
    $('create-post-btn').disabled = false;
    $('create-post-btn').textContent = 'Post';
  }
}

// Trust User
async function trustUser() {
  const publicKey = $('trust-public-key').value.trim();

  if (!publicKey) {
    showResult('trust-result', 'Please enter a public key', false);
    return;
  }

  try {
    $('trust-btn').disabled = true;
    $('trust-btn').textContent = 'Trusting...';

    await apiCall('/trust', 'POST', { publicKey });

    showResult('trust-result', 'User trusted successfully!', true);
    $('trust-public-key').value = '';
  } catch (error) {
    showResult('trust-result', `Error: ${error.message}`, false);
  } finally {
    $('trust-btn').disabled = false;
    $('trust-btn').textContent = 'Trust User';
  }
}

// Load Identity
async function loadIdentity() {
  try {
    const data = await apiCall('/identity');

    $('identity-public-key').textContent = data.publicKey;
    $('identity-name').textContent = data.name;
    $('identity-created').textContent = new Date(data.created).toLocaleString();
  } catch (error) {
    console.error('Error loading identity:', error);
  }
}

// Load Stats
async function loadStats() {
  try {
    const data = await apiCall('/stats');

    $('stat-posts').textContent = data.totalPosts || 0;
    $('stat-trusted').textContent = data.trustedCount || 0;
    $('stat-network').textContent = data.networkSize || 0;
    $('stat-hops').textContent = data.maxHops || 3;
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

// Character counter for post
function setupCharCounter() {
  const textarea = $('post-content');
  const counter = $('char-count');

  textarea.addEventListener('input', () => {
    counter.textContent = textarea.value.length;
  });
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupCharCounter();

  // Event listeners
  $('init-btn').addEventListener('click', initializeClout);
  $('create-post-btn').addEventListener('click', createPost);
  $('trust-btn').addEventListener('click', trustUser);
  $('refresh-feed-btn').addEventListener('click', loadFeed);
  $('back-to-feed-btn').addEventListener('click', () => {
    // Switch back to feed tab
    $$('.tab-btn').forEach(b => b.classList.remove('active'));
    $$('.tab-btn')[0].classList.add('active'); // Feed is first
    $$('.tab-content').forEach(content => content.classList.remove('active'));
    $('feed-tab').classList.add('active');

    // Hide thread tab button
    $$('.tab-btn')[3].style.display = 'none';

    // Reload feed
    loadFeed();
  });

  // Check health
  apiCall('/health').then(data => {
    if (data.initialized) {
      // Auto-init if already initialized
      initializeClout();
    }
  }).catch(() => {
    updateStatus('Server not responding', false);
  });
});
