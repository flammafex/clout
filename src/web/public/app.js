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
      if (tab === 'slides') loadSlides();
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
    await loadProfile();
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

// Send Slide (Encrypted DM)
async function sendSlide() {
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
  try {
    const data = await apiCall('/slides');
    const slidesList = $('slides-list');

    if (!data.slides || data.slides.length === 0) {
      slidesList.innerHTML = '<p class="empty-state">No slides yet</p>';
      return;
    }

    slidesList.innerHTML = data.slides.map(slide => `
      <div class="slide-item">
        <div class="slide-header">
          <div class="slide-sender">📬 From: ${slide.sender.slice(0, 16)}...</div>
          <div class="slide-timestamp">${new Date(slide.timestamp).toLocaleString()}</div>
        </div>
        <div class="slide-message">${escapeHtml(slide.message)}</div>
        <button class="btn btn-small" onclick="startSlideReply('${slide.sender}')">Reply</button>
      </div>
    `).join('');
  } catch (error) {
    $('slides-list').innerHTML = `<p class="empty-state">Error loading slides: ${error.message}</p>`;
  }
}

// Start Slide Reply
function startSlideReply(recipientKey) {
  $('slide-recipient').value = recipientKey;
  $('slide-message').focus();
}

// Load Identity
async function loadIdentity() {
  try {
    const data = await apiCall('/identity');

    $('identity-public-key').textContent = data.publicKey;
    $('identity-name').textContent = data.metadata?.displayName || '(Not set - set in Profile tab)';
    $('identity-created').textContent = new Date(data.created).toLocaleString();

    // Store public key for QR code generation
    window.userPublicKey = data.publicKey;
  } catch (error) {
    console.error('Error loading identity:', error);
  }
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
    $('stat-network').textContent = data.identity?.trustCount || 0; // For now, network size = trust count
    $('stat-hops').textContent = 3; // Max hops is hardcoded to 3
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
    $('profile-avatar-display').textContent = profile.metadata?.avatar || '👤';
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

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupCharCounter();

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
    $$('.tab-btn')[0].classList.add('active'); // Feed is first
    $$('.tab-content').forEach(content => content.classList.remove('active'));
    $('feed-tab').classList.add('active');

    // Hide thread tab button
    $$('.tab-btn')[4].style.display = 'none';

    // Reload feed
    loadFeed();
  });

  // Character counter for slide message
  $('slide-message').addEventListener('input', () => {
    $('slide-char-count').textContent = $('slide-message').value.length;
  });

  // Profile event listeners
  $('edit-profile-btn').addEventListener('click', showProfileEdit);
  $('save-profile-btn').addEventListener('click', saveProfile);
  $('cancel-edit-btn').addEventListener('click', cancelProfileEdit);

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
