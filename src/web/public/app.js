// Clout Web UI - Frontend Application

const API_BASE = '/api';
let initialized = false;

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
      <div class="feed-item">
        <div class="feed-author">${post.author.slice(0, 16)}...</div>
        <div class="feed-content">${escapeHtml(post.content)}</div>
        <div class="feed-timestamp">${new Date(post.timestamp).toLocaleString()}</div>
      </div>
    `).join('');
  } catch (error) {
    $('feed-list').innerHTML = `<p class="empty-state">Error loading feed: ${error.message}</p>`;
  }
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

    await apiCall('/post', 'POST', { content });

    showResult('post-result', 'Post created successfully!', true);
    $('post-content').value = '';
    $('char-count').textContent = '0';

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
