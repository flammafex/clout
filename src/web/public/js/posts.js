/**
 * Posts Module - Post creation, editing, and retracting
 *
 * Handles:
 * - Creating new posts
 * - Editing existing posts
 * - Retracting posts
 * - Reply functionality
 * - Media upload handling
 * - Link preview handling
 */

import * as state from './state.js';
import { apiCall, uploadMediaFile, submitSignedPost, API_BASE } from './api.js';
import { $, $$, showResult, formatFileSize, isInvitationRequiredError, startDayPassTimer } from './ui.js';
import { loadFeed, loadFeedWithCurrentFilter } from './feed.js';

// Track which attachment type is active: 'media' or 'link'
let activeAttachmentType = 'media';

/**
 * Create a new post
 */
export async function createPost(requireMembership, showInvitePopover) {
  if (!requireMembership()) return;

  // If editing, call saveEdit instead
  if (state.editingPost) {
    await saveEdit(requireMembership);
    return;
  }

  const content = $('post-content').value.trim();
  const nsfw = $('post-nsfw').checked;
  const cwEnabled = $('post-cw-enabled').checked;
  const contentWarning = cwEnabled ? $('post-cw-text').value.trim() : null;

  if (!content && !state.pendingMedia && !state.pendingLink) {
    showResult('post-result', 'Please enter some content or attach media/link', false);
    return;
  }

  if (cwEnabled && !contentWarning) {
    showResult('post-result', 'Please enter a content warning description', false);
    return;
  }

  try {
    $('create-post-btn').disabled = true;
    $('create-post-btn').textContent = 'Posting...';

    // Build post options
    const options = { nsfw };
    if (state.replyingTo) {
      options.replyTo = state.replyingTo;
    }
    if (state.pendingMedia && state.pendingMedia.cid) {
      options.mediaCid = state.pendingMedia.cid;
    }
    if (state.pendingLink) {
      options.link = state.pendingLink;
    }
    if (contentWarning) {
      options.contentWarning = contentWarning;
    }

    // Use browser-side signing for secure post submission
    const postResult = await submitSignedPost(content, options);

    if (postResult.ticketExpiry) {
      startDayPassTimer(postResult.ticketExpiry);
    }

    const hasMedia = state.pendingMedia !== null;
    const hasLink = state.pendingLink !== null;
    const attachmentType = hasMedia ? 'media' : (hasLink ? 'link preview' : '');
    showResult('post-result',
      state.replyingTo
        ? (attachmentType ? `Reply with ${attachmentType} posted!` : 'Reply posted!')
        : (attachmentType ? `Post with ${attachmentType} created!` : 'Post created successfully!'),
      true
    );

    // Reset form
    $('post-content').value = '';
    $('char-count').textContent = '0';
    $('post-nsfw').checked = false;
    $('post-cw-enabled').checked = false;
    $('post-cw-text').value = '';
    $('cw-input-wrapper').style.display = 'none';
    clearMediaPreview();
    clearLinkPreview();

    if (state.replyingTo) {
      cancelReply();
    }

    await loadFeed();
  } catch (error) {
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

/**
 * Start replying to a post
 */
export function startReply(postId, author, requireMembership) {
  if (!requireMembership()) return;

  state.setReplyingTo(postId);

  // Switch to post tab
  $$('.tab-btn').forEach(b => b.classList.remove('active'));
  $$('.tab-btn')[1].classList.add('active');
  $$('.tab-content').forEach(content => content.classList.remove('active'));
  $('post-tab').classList.add('active');

  $('post-content').placeholder = `Reply to ${author}...`;
  $('post-content').focus();

  const helpText = document.querySelector('.help-text');
  helpText.innerHTML = `Replying to post ${postId.slice(0, 8)}... <button onclick="window.cloutApp.cancelReply()" class="btn btn-small">Cancel</button>`;
}

/**
 * Cancel reply
 */
export function cancelReply() {
  state.setReplyingTo(null);
  $('post-content').placeholder = "What's on your mind?";
  const helpText = document.querySelector('.help-text');
  helpText.textContent = 'Share your thoughts with your trust network';
}

/**
 * Start editing a post
 */
export function startEditPost(postId, requireMembership) {
  if (!requireMembership()) return;

  const cachedPost = state.getCachedPost(postId);
  if (!cachedPost) {
    alert('Could not find post to edit. Please refresh the feed.');
    return;
  }

  const currentContent = cachedPost.content || '';
  state.setEditingPost({ id: postId, content: currentContent });

  // Switch to post tab
  $$('.tab-btn').forEach(b => b.classList.remove('active'));
  $$('.tab-btn')[1].classList.add('active');
  $$('.tab-content').forEach(content => content.classList.remove('active'));
  $('post-tab').classList.add('active');

  $('post-content').value = currentContent;
  $('post-content').placeholder = 'Edit your post...';
  $('char-count').textContent = currentContent.length;
  $('post-content').focus();

  const helpText = document.querySelector('.help-text');
  helpText.innerHTML = `Editing post ${postId.slice(0, 8)}... <button onclick="window.cloutApp.cancelEdit()" class="btn btn-small">Cancel</button>`;
  $('create-post-btn').textContent = 'Save Edit';
}

/**
 * Cancel edit
 */
export function cancelEdit() {
  state.setEditingPost(null);
  $('post-content').value = '';
  $('post-content').placeholder = "What's on your mind?";
  $('char-count').textContent = '0';
  const helpText = document.querySelector('.help-text');
  helpText.textContent = 'Share your thoughts with your trust network';
  $('create-post-btn').textContent = 'Post';
}

/**
 * Save edit (browser-signed)
 */
async function saveEdit(requireMembership) {
  if (!state.editingPost) return;

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

    // Get browser identity for signing
    if (!window.CloutIdentity || !window.CloutCrypto) {
      throw new Error('Identity or crypto module not loaded');
    }

    const identity = await window.CloutIdentity.load();
    if (!identity) {
      throw new Error('No browser identity found');
    }

    const Crypto = window.CloutCrypto;
    const timestamp = Date.now();
    const originalPostId = state.editingPost.id;

    // Sign edited content using the canonical post signature domain.
    const signaturePayload = window.CloutCrypto.buildPostSignaturePayload({
      content,
      author: identity.publicKeyHex,
      timestamp,
      replyTo: state.editingPost.replyTo ?? null,
      mediaCid: null,
      link: null,
      nsfw,
      contentWarning
    });
    const signatureMessage = `CLOUT_POST_V2:${window.CloutCrypto.hashObject(signaturePayload)}`;
    const payloadBytes = new TextEncoder().encode(signatureMessage);

    // Sign with private key
    const signature = Crypto.sign(payloadBytes, identity.privateKey);
    const signatureHex = Crypto.toHex(signature);

    // Submit browser-signed edit
    await apiCall('/edit/submit', 'POST', {
      originalPostId,
      content,
      author: identity.publicKeyHex,
      signature: signatureHex,
      timestamp,
      nsfw,
      contentWarning
    });

    showResult('post-result', 'Post edited successfully!', true);
    $('post-content').value = '';
    $('char-count').textContent = '0';
    $('post-nsfw').checked = false;
    $('post-cw-enabled').checked = false;
    $('post-cw-text').value = '';
    $('cw-input-wrapper').style.display = 'none';

    cancelEdit();
    await loadFeed();
  } catch (error) {
    showResult('post-result', `Error: ${error.message}`, false);
  } finally {
    $('create-post-btn').disabled = false;
    $('create-post-btn').textContent = 'Post';
  }
}

/**
 * Retract a post (browser-signed)
 */
export async function retractPost(postId, requireMembership) {
  if (!requireMembership()) return;

  if (!confirm('Are you sure you want to retract this post?\n\nRetracting is an act of accountability - you\'re publicly taking back what you said. The original post still exists cryptographically but will be hidden from feeds.')) {
    return;
  }

  try {
    // Get browser identity
    if (!window.CloutIdentity || !window.CloutCrypto) {
      throw new Error('Identity or crypto module not loaded');
    }

    const identity = await window.CloutIdentity.load();
    if (!identity) {
      throw new Error('No browser identity found');
    }

    const Crypto = window.CloutCrypto;
    const timestamp = Date.now();

    // Create signature payload: "retract:{postId}:{author}:{timestamp}"
    const signaturePayload = `retract:${postId}:${identity.publicKeyHex}:${timestamp}`;
    const payloadBytes = new TextEncoder().encode(signaturePayload);

    // Sign with private key
    const signature = Crypto.sign(payloadBytes, identity.privateKey);
    const signatureHex = Crypto.toHex(signature);

    // Submit browser-signed retraction
    await apiCall('/retract/submit', 'POST', {
      postId,
      author: identity.publicKeyHex,
      signature: signatureHex,
      timestamp,
      reason: 'retracted'
    });

    await loadFeedWithCurrentFilter();
  } catch (error) {
    alert(`Could not retract post: ${error.message}`);
  }
}

// =========================================================================
// Media Upload
// =========================================================================

/**
 * Setup media upload handlers
 */
export function setupMediaUpload() {
  const dropZone = $('media-drop-zone');
  const fileInput = $('media-input');
  const browseBtn = $('media-browse-btn');
  const removeBtn = $('media-remove-btn');

  browseBtn.addEventListener('click', (e) => {
    e.preventDefault();
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleMediaFile(e.target.files[0]);
    }
  });

  removeBtn.addEventListener('click', () => {
    clearMediaPreview();
  });

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

/**
 * Handle selected media file
 */
async function handleMediaFile(file) {
  // Note: SVG is intentionally excluded - it can contain embedded JavaScript (XSS vector)
  const allowedTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/webm', 'video/ogg',
    'audio/mpeg', 'audio/ogg', 'audio/wav',
    'application/pdf'
  ];

  if (!allowedTypes.includes(file.type)) {
    showResult('post-result', `Unsupported file type: ${file.type}`, false);
    return;
  }

  if (file.size > 100 * 1024 * 1024) {
    showResult('post-result', 'File too large. Maximum size is 100MB.', false);
    return;
  }

  showMediaPreview(file);
  await uploadMedia(file);
}

/**
 * Show media preview
 */
function showMediaPreview(file) {
  const preview = $('media-preview');
  const dropZone = $('media-drop-zone');
  const previewContent = $('media-preview-content');

  $('media-preview-name').textContent = file.name;
  $('media-preview-size').textContent = formatFileSize(file.size);

  previewContent.innerHTML = '';

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
    const icon = document.createElement('div');
    icon.className = 'file-icon';
    icon.innerHTML = file.type === 'application/pdf' ? '&#x1F4C4; PDF' : '&#x1F4C1; File';
    previewContent.appendChild(icon);
  }

  dropZone.style.display = 'none';
  preview.style.display = 'block';
}

/**
 * Upload media to server
 */
async function uploadMedia(file) {
  const progressContainer = $('media-upload-progress');
  const progressFill = $('progress-fill');
  const progressText = $('progress-text');

  progressContainer.style.display = 'block';
  progressFill.style.width = '0%';
  progressText.textContent = 'Uploading...';

  try {
    const result = await uploadMediaFile(file);
    state.setPendingMedia(result);

    progressFill.style.width = '100%';
    progressText.textContent = 'Uploaded!';

    setTimeout(() => {
      progressContainer.style.display = 'none';
    }, 1000);

    console.log('Media uploaded:', state.pendingMedia);
  } catch (error) {
    console.error('Upload error:', error);
    progressText.textContent = `Error: ${error.message}`;
    progressFill.style.backgroundColor = '#ef4444';
    state.setPendingMedia(null);
  }
}

/**
 * Clear media preview
 */
export function clearMediaPreview() {
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
  state.setPendingMedia(null);
}

/**
 * Setup character counter
 */
export function setupCharCounter() {
  const textarea = $('post-content');
  const counter = $('char-count');

  textarea.addEventListener('input', () => {
    counter.textContent = textarea.value.length;
  });

  const bioTextarea = $('profile-bio');
  const bioCounter = $('bio-char-count');
  bioTextarea.addEventListener('input', () => {
    bioCounter.textContent = bioTextarea.value.length;
  });
}

// =========================================================================
// Link Preview
// =========================================================================

/**
 * Setup attachment type selector (media vs link)
 */
export function setupAttachmentSelector() {
  const mediaBtn = $('attach-media-btn');
  const linkBtn = $('attach-link-btn');
  const mediaSection = $('media-upload-section');
  const linkSection = $('link-input-section');

  if (!mediaBtn || !linkBtn) return;

  mediaBtn.addEventListener('click', () => {
    switchAttachmentType('media');
  });

  linkBtn.addEventListener('click', () => {
    switchAttachmentType('link');
  });
}

/**
 * Switch between media and link attachment modes
 */
function switchAttachmentType(type) {
  activeAttachmentType = type;

  const mediaBtn = $('attach-media-btn');
  const linkBtn = $('attach-link-btn');
  const mediaSection = $('media-upload-section');
  const linkSection = $('link-input-section');

  if (type === 'media') {
    mediaBtn.classList.add('active');
    linkBtn.classList.remove('active');
    mediaSection.style.display = 'block';
    linkSection.style.display = 'none';
    // Clear link when switching to media
    clearLinkPreview();
  } else {
    linkBtn.classList.add('active');
    mediaBtn.classList.remove('active');
    linkSection.style.display = 'block';
    mediaSection.style.display = 'none';
    // Clear media when switching to link
    clearMediaPreview();
  }
}

/**
 * Setup link preview handlers
 */
export function setupLinkPreview() {
  const urlInput = $('link-url-input');
  const fetchBtn = $('link-fetch-btn');
  const removeBtn = $('link-remove-btn');

  if (!urlInput || !fetchBtn) return;

  fetchBtn.addEventListener('click', () => {
    fetchLinkPreview();
  });

  // Also fetch on Enter key
  urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      fetchLinkPreview();
    }
  });

  removeBtn.addEventListener('click', () => {
    clearLinkPreview();
  });
}

/**
 * Fetch OpenGraph metadata for a URL
 */
async function fetchLinkPreview() {
  const urlInput = $('link-url-input');
  const fetchBtn = $('link-fetch-btn');
  const statusDiv = $('link-fetch-status');
  const statusText = $('link-fetch-text');

  const url = urlInput.value.trim();
  if (!url) {
    showResult('post-result', 'Please enter a URL', false);
    return;
  }

  // Basic URL validation
  try {
    new URL(url);
  } catch {
    showResult('post-result', 'Please enter a valid URL', false);
    return;
  }

  // Show loading state
  fetchBtn.disabled = true;
  fetchBtn.textContent = 'Fetching...';
  statusDiv.style.display = 'block';
  statusDiv.classList.remove('error');
  statusText.textContent = 'Fetching preview...';

  try {
    const data = await apiCall(`/opengraph/fetch?url=${encodeURIComponent(url)}`);

    // Store the link metadata
    state.setPendingLink(data);

    // Display preview
    showLinkPreview(data);

    statusDiv.style.display = 'none';
    console.log('Link preview fetched:', data);
  } catch (error) {
    console.error('Link preview error:', error);
    statusDiv.classList.add('error');
    statusText.textContent = `Error: ${error.message}`;
    state.setPendingLink(null);
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.textContent = 'Preview';
  }
}

/**
 * Show link preview in the form
 */
function showLinkPreview(data) {
  const preview = $('link-preview');
  const imageDiv = $('link-preview-image');
  const siteDiv = $('link-preview-site');
  const titleDiv = $('link-preview-title');
  const descDiv = $('link-preview-description');

  // Images not used - hide the div
  if (imageDiv) imageDiv.style.display = 'none';

  // Set text content
  siteDiv.textContent = data.siteName || new URL(data.url).hostname;
  titleDiv.textContent = data.title || 'Untitled';
  descDiv.textContent = data.description || '';

  preview.style.display = 'block';
}

/**
 * Clear link preview
 */
export function clearLinkPreview() {
  const urlInput = $('link-url-input');
  const preview = $('link-preview');
  const statusDiv = $('link-fetch-status');
  const imageDiv = $('link-preview-image');
  const siteDiv = $('link-preview-site');
  const titleDiv = $('link-preview-title');
  const descDiv = $('link-preview-description');

  if (urlInput) urlInput.value = '';
  if (preview) preview.style.display = 'none';
  if (statusDiv) statusDiv.style.display = 'none';
  if (imageDiv) {
    imageDiv.style.backgroundImage = '';
    imageDiv.style.display = 'none';
  }
  if (siteDiv) siteDiv.textContent = '';
  if (titleDiv) titleDiv.textContent = '';
  if (descDiv) descDiv.textContent = '';

  state.setPendingLink(null);
}
