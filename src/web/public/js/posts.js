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
import { $, formatFileSize, isInvitationRequiredError, startDayPassTimer } from './ui.js';
import { loadFeed, loadFeedWithCurrentFilter } from './feed.js';

// Track which attachment type is active: 'media' or 'link'
let activeAttachmentType = 'media';

// =========================================================================
// Compose-root-aware element lookup
// =========================================================================
//
// The compose form exists in TWO places in the DOM: the #post-tab panel
// (reached via #/compose) and a clone of <template id="compose-template">
// that is inserted into #compose-modal-body each time the compose modal
// opens. Both copies use the SAME element IDs (so the markup stays in
// sync). To avoid getElementById returning the wrong copy, all compose
// lookups must scope to the *active compose root*: the modal body when
// the modal is open, otherwise #post-tab.

function composeRoot() {
  const modal = document.getElementById('compose-modal');
  if (modal && modal.classList.contains('active')) {
    return document.getElementById('compose-modal-body');
  }
  return document.getElementById('post-tab');
}

function composeEl(id) {
  return composeRoot().querySelector('#' + id);
}

/**
 * Scoped equivalent of ui.showResult for the active compose form's
 * #post-result element. showResult() uses getElementById, which would
 * resolve to the #post-tab copy even while the modal is open.
 */
function showComposeResult(message, isSuccess) {
  const el = composeEl('post-result');
  if (!el) return;
  el.textContent = message;
  el.className = `result-message ${isSuccess ? 'success' : 'error'}`;
  el.setAttribute('aria-live', 'polite');
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

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

  const content = composeEl('post-content').value.trim();
  const nsfw = composeEl('post-nsfw').checked;
  const cwEnabled = composeEl('post-cw-enabled').checked;
  const contentWarning = cwEnabled ? composeEl('post-cw-text').value.trim() : null;

  if (!content && !state.pendingMedia && !state.pendingLink) {
    showComposeResult('Please enter some content or attach media/link', false);
    return;
  }

  if (cwEnabled && !contentWarning) {
    showComposeResult('Please enter a content warning description', false);
    return;
  }

  try {
    composeEl('create-post-btn').disabled = true;
    composeEl('create-post-btn').textContent = 'Posting...';

    // Build post options
    const options = { nsfw };
    if (state.replyingTo) {
      options.replyTo = state.replyingTo;
    }
    if (state.pendingMedia && state.pendingMedia.cid) {
      options.mediaCid = state.pendingMedia.cid;
      options.mediaMimeType = state.pendingMedia.mimeType;
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
    showComposeResult(
      state.replyingTo
        ? (attachmentType ? `Reply with ${attachmentType} posted!` : 'Reply posted!')
        : (attachmentType ? `Post with ${attachmentType} created!` : 'Post created successfully!'),
      true
    );

    // Reset form
    composeEl('post-content').value = '';
    composeEl('char-count').textContent = '0';
    composeEl('post-nsfw').checked = false;
    composeEl('post-cw-enabled').checked = false;
    composeEl('post-cw-text').value = '';
    composeEl('cw-input-wrapper').style.display = 'none';
    clearMediaPreview();
    clearLinkPreview();

    if (state.replyingTo) {
      cancelReply();
    }

    await loadFeed();

    // Auto-close compose modal after successful post
    if (window.cloutApp?.closeComposeModal) {
      setTimeout(() => window.cloutApp.closeComposeModal(), 800);
    }
  } catch (error) {
    if (isInvitationRequiredError(error)) {
      showInvitePopover();
    } else {
      showComposeResult(`Error: ${error.message}`, false);
    }
  } finally {
    composeEl('create-post-btn').disabled = false;
    composeEl('create-post-btn').textContent = 'Post';
  }
}

/**
 * Start replying to a post
 */
export function startReply(postId, author, requireMembership) {
  if (!requireMembership()) return;

  state.setReplyingTo(postId);

  // Open compose modal (replaces dead tab-switching code)
  window.cloutApp.openComposeModal();

  composeEl('post-content').placeholder = `Reply to ${author}...`;
  composeEl('post-content').focus();

  const helpText = composeRoot().querySelector('.help-text');
  helpText.innerHTML = `Replying to post ${postId.slice(0, 8)}... <button onclick="window.cloutApp.cancelReply()" class="btn btn-small">Cancel</button>`;
}

/**
 * Cancel reply
 */
export function cancelReply() {
  state.setReplyingTo(null);
  composeEl('post-content').placeholder = "What's on your mind?";
  const helpText = composeRoot().querySelector('.help-text');
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

  // Open compose modal (replaces dead tab-switching code)
  window.cloutApp.openComposeModal();

  composeEl('post-content').value = currentContent;
  composeEl('post-content').placeholder = 'Edit your post...';
  composeEl('char-count').textContent = currentContent.length;
  composeEl('post-content').focus();

  const helpText = composeRoot().querySelector('.help-text');
  helpText.innerHTML = `Editing post ${postId.slice(0, 8)}... <button onclick="window.cloutApp.cancelEdit()" class="btn btn-small">Cancel</button>`;
  composeEl('create-post-btn').textContent = 'Save Edit';
}

/**
 * Cancel edit
 */
export function cancelEdit() {
  state.setEditingPost(null);
  composeEl('post-content').value = '';
  composeEl('post-content').placeholder = "What's on your mind?";
  composeEl('char-count').textContent = '0';
  const helpText = composeRoot().querySelector('.help-text');
  helpText.textContent = 'Share your thoughts with your trust network';
  composeEl('create-post-btn').textContent = 'Post';
}

/**
 * Save edit (browser-signed)
 */
async function saveEdit(requireMembership) {
  if (!state.editingPost) return;

  const content = composeEl('post-content').value.trim();
  const nsfw = composeEl('post-nsfw').checked;
  const cwEnabled = composeEl('post-cw-enabled').checked;
  const contentWarning = cwEnabled ? composeEl('post-cw-text').value.trim() : null;

  if (!content) {
    showComposeResult('Please enter some content', false);
    return;
  }

  try {
    composeEl('create-post-btn').disabled = true;
    composeEl('create-post-btn').textContent = 'Saving...';

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

    showComposeResult('Post edited successfully!', true);
    composeEl('post-content').value = '';
    composeEl('char-count').textContent = '0';
    composeEl('post-nsfw').checked = false;
    composeEl('post-cw-enabled').checked = false;
    composeEl('post-cw-text').value = '';
    composeEl('cw-input-wrapper').style.display = 'none';

    cancelEdit();
    await loadFeed();
  } catch (error) {
    showComposeResult(`Error: ${error.message}`, false);
  } finally {
    composeEl('create-post-btn').disabled = false;
    composeEl('create-post-btn').textContent = 'Post';
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
 * Setup media upload handlers on a given compose root.
 * @param {ParentNode} root - #post-tab or the cloned modal body.
 */
export function setupMediaUpload(root) {
  const dropZone = root.querySelector('#media-drop-zone');
  const fileInput = root.querySelector('#media-input');
  const browseBtn = root.querySelector('#media-browse-btn');
  const removeBtn = root.querySelector('#media-remove-btn');

  if (!dropZone || !fileInput || !browseBtn || !removeBtn) return;

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
    showComposeResult(`Unsupported file type: ${file.type}`, false);
    return;
  }

  if (file.size > 100 * 1024 * 1024) {
    showComposeResult('File too large. Maximum size is 100MB.', false);
    return;
  }

  showMediaPreview(file);
  await uploadMedia(file);
}

/**
 * Show media preview
 */
function showMediaPreview(file) {
  const preview = composeEl('media-preview');
  const dropZone = composeEl('media-drop-zone');
  const previewContent = composeEl('media-preview-content');

  composeEl('media-preview-name').textContent = file.name;
  composeEl('media-preview-size').textContent = formatFileSize(file.size);

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
  const progressContainer = composeEl('media-upload-progress');
  const progressFill = composeEl('progress-fill');
  const progressText = composeEl('progress-text');

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
  const preview = composeEl('media-preview');
  const dropZone = composeEl('media-drop-zone');
  const previewContent = composeEl('media-preview-content');
  const progressContainer = composeEl('media-upload-progress');
  const fileInput = composeEl('media-input');

  if (preview) preview.style.display = 'none';
  if (dropZone) dropZone.style.display = 'block';
  if (previewContent) previewContent.innerHTML = '';
  if (progressContainer) progressContainer.style.display = 'none';
  if (fileInput) fileInput.value = '';
  state.setPendingMedia(null);
}

/**
 * Setup character counter for the profile bio field (global, once).
 * The post-content char counter is wired per compose-root by
 * setupComposeHandlers() because the compose form is duplicated between
 * #post-tab and the compose-modal clone.
 */
export function setupCharCounter() {
  const bioTextarea = $('profile-bio');
  const bioCounter = $('bio-char-count');
  if (bioTextarea && bioCounter) {
    bioTextarea.addEventListener('input', () => {
      bioCounter.textContent = bioTextarea.value.length;
    });
  }
}

/**
 * Wire all compose-form interactions on a given root (#post-tab or a
 * cloned template subtree). Call once at bootstrap for #post-tab and
 * again each time the compose modal clones the template.
 *
 * The create-post-btn is intentionally NOT wired here — it uses
 * data-action="createPost" and is handled by the global click-delegation
 * dispatcher in app.js, so it works for both the #post-tab button and
 * the modal clone without per-root wiring.
 *
 * @param {ParentNode} root
 */
export function setupComposeHandlers(root) {
  if (!root) return;

  // Char counter
  const textarea = root.querySelector('#post-content');
  const counter = root.querySelector('#char-count');
  if (textarea && counter) {
    textarea.addEventListener('input', () => {
      counter.textContent = textarea.value.length;
    });
  }

  // Content warning toggle
  const cwToggle = root.querySelector('#post-cw-enabled');
  const cwWrapper = root.querySelector('#cw-input-wrapper');
  const cwText = root.querySelector('#post-cw-text');
  if (cwToggle && cwWrapper) {
    cwToggle.addEventListener('change', (e) => {
      cwWrapper.style.display = e.target.checked ? 'block' : 'none';
      if (e.target.checked && cwText) cwText.focus();
    });
  }

  setupMediaUpload(root);
  setupAttachmentSelector(root);
  setupLinkPreview(root);
}

// =========================================================================
// Attachment Selector & Link Preview
// =========================================================================

/**
 * Setup attachment type selector (media vs link) on a given compose root.
 * @param {ParentNode} root
 */
export function setupAttachmentSelector(root) {
  const mediaBtn = root.querySelector('#attach-media-btn');
  const linkBtn = root.querySelector('#attach-link-btn');
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

  const mediaBtn = composeEl('attach-media-btn');
  const linkBtn = composeEl('attach-link-btn');
  const mediaSection = composeEl('media-upload-section');
  const linkSection = composeEl('link-input-section');

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
 * Setup link preview handlers on a given compose root.
 * @param {ParentNode} root
 */
export function setupLinkPreview(root) {
  const urlInput = root.querySelector('#link-url-input');
  const fetchBtn = root.querySelector('#link-fetch-btn');
  const removeBtn = root.querySelector('#link-remove-btn');

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

  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      clearLinkPreview();
    });
  }
}

/**
 * Fetch OpenGraph metadata for a URL
 */
async function fetchLinkPreview() {
  const urlInput = composeEl('link-url-input');
  const fetchBtn = composeEl('link-fetch-btn');
  const statusDiv = composeEl('link-fetch-status');
  const statusText = composeEl('link-fetch-text');

  const url = urlInput.value.trim();
  if (!url) {
    showComposeResult('Please enter a URL', false);
    return;
  }

  // Basic URL validation
  try {
    new URL(url);
  } catch {
    showComposeResult('Please enter a valid URL', false);
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
  const preview = composeEl('link-preview');
  const imageDiv = composeEl('link-preview-image');
  const siteDiv = composeEl('link-preview-site');
  const titleDiv = composeEl('link-preview-title');
  const descDiv = composeEl('link-preview-description');

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
  const urlInput = composeEl('link-url-input');
  const preview = composeEl('link-preview');
  const statusDiv = composeEl('link-fetch-status');
  const imageDiv = composeEl('link-preview-image');
  const siteDiv = composeEl('link-preview-site');
  const titleDiv = composeEl('link-preview-title');
  const descDiv = composeEl('link-preview-description');

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
