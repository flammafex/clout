// Clout Web UI - Frontend Application

const API_BASE = '/api';
let initialized = false;
let replyingTo = null; // Track which post we're replying to
let pendingMedia = null; // Track uploaded media for post { cid, mimeType, filename, size }

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
      if (tab === 'settings') loadSettings();
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

    feedList.innerHTML = data.posts.map(post => {
      const hasMedia = post.media && post.media.cid;
      const rep = post.reputation || { score: 0, distance: 0 };
      const repColor = getReputationColor(rep.score);
      const tags = post.authorTags || [];
      const tagsHtml = tags.length > 0
        ? `<span class="author-tags">${tags.map(t => `<span class="tag-badge">${escapeHtml(t)}</span>`).join('')}</span>`
        : '';

      return `
        <div class="feed-item ${hasMedia ? 'has-media' : ''} ${post.nsfw ? 'nsfw-post' : ''}" onclick="viewThread('${post.id}')" style="cursor: pointer;">
          <div class="feed-header">
            <div class="feed-author">
              ${post.author.slice(0, 16)}...
              <span class="reputation-badge" style="background-color: ${repColor}" title="Reputation: ${rep.score.toFixed(2)}, Distance: ${rep.distance}">
                ${rep.distance === 0 ? 'You' : rep.distance === 1 ? '1st' : rep.distance === 2 ? '2nd' : '3rd'}
              </span>
              ${tagsHtml}
            </div>
            ${post.nsfw ? '<span class="nsfw-badge">NSFW</span>' : ''}
          </div>
          ${post.replyTo ? `<div class="feed-reply-indicator">↳ Reply to ${post.replyTo.slice(0, 8)}...</div>` : ''}
          <div class="feed-content">${renderPostContent(post)}</div>
          <div class="feed-footer">
            <div class="feed-timestamp">${new Date(post.timestamp).toLocaleString()}</div>
            <button class="btn-reply" onclick="event.stopPropagation(); startReply('${post.id}', '${post.author.slice(0, 16)}')">Reply</button>
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    $('feed-list').innerHTML = `<p class="empty-state">Error loading feed: ${error.message}</p>`;
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
    const parentHasMedia = parent.media && parent.media.cid;
    $('thread-parent').innerHTML = `
      <div class="feed-item thread-parent-post ${parentHasMedia ? 'has-media' : ''}">
        <div class="feed-author">${parent.author.slice(0, 16)}...</div>
        ${parent.replyTo ? `<div class="feed-reply-indicator">↳ Reply to ${parent.replyTo.slice(0, 8)}... <a href="#" onclick="event.preventDefault(); viewThread('${parent.replyTo}')">View parent</a></div>` : ''}
        <div class="feed-content">${renderPostContent(parent)}</div>
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
      repliesList.innerHTML = data.replies.map(reply => {
        const replyHasMedia = reply.media && reply.media.cid;
        return `
          <div class="feed-item ${replyHasMedia ? 'has-media' : ''}" onclick="viewThread('${reply.id}')" style="cursor: pointer;">
            <div class="feed-author">${reply.author.slice(0, 16)}...</div>
            <div class="feed-content">${renderPostContent(reply)}</div>
            <div class="feed-footer">
              <div class="feed-timestamp">${new Date(reply.timestamp).toLocaleString()}</div>
              <button class="btn-reply" onclick="event.stopPropagation(); startReply('${reply.id}', '${reply.author.slice(0, 16)}')">Reply</button>
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
  const nsfw = $('post-nsfw').checked;

  // Allow posts with just media (no text required)
  if (!content && !pendingMedia) {
    showResult('post-result', 'Please enter some content or attach media', false);
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

    await apiCall('/post', 'POST', body);

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

    // Clear media preview
    clearMediaPreview();

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

// =========================================================================
// MEDIA UPLOAD FUNCTIONS
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

// =========================================================================
// SETTINGS FUNCTIONS
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

    // Load tags
    await loadTags();
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

// Save Settings
async function saveSettings() {
  try {
    $('save-settings-btn').disabled = true;
    $('save-settings-btn').textContent = 'Saving...';

    const settings = {
      showNsfw: $('settings-nsfw-enabled').checked,
      maxHops: parseInt($('settings-max-hops').value),
      minReputation: parseInt($('settings-min-reputation').value) / 100
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

    // Reload tags
    await loadTags();
  } catch (error) {
    showResult('tag-result', `Error: ${error.message}`, false);
  } finally {
    $('add-tag-btn').disabled = false;
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

  // Add tag button
  $('add-tag-btn').addEventListener('click', addTag);
}

// Initialize app
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
