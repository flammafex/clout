/**
 * Thread Module - Thread view functionality
 *
 * Handles:
 * - Loading and displaying thread views
 * - Parent post and replies
 * - Edit chain resolution
 */

import * as state from './state.js';
import { apiCall } from './api.js';
import { $, $$, escapeHtml, formatRelativeTime, renderAvatar } from './ui.js';
import { renderReactionsBar } from './reactions.js';
import { renderPostContent, recalculateTrustForPosts } from './feed.js';

/**
 * Check if current user is a visitor (no browser identity)
 */
function isVisitorMode() {
  return state.isVisitor;
}

/**
 * View a thread
 */
export async function viewThread(postId) {
  try {
    const response = await fetch(`/api/thread/${postId}`);
    const result = await response.json();

    // Handle retracted/deleted posts gracefully
    if (!response.ok || !result.success) {
      showThreadTab();
      $('thread-parent').innerHTML = `
        <div class="feed-item thread-parent-post" style="text-align: center; padding: 2rem;">
          <div class="empty-state">
            <p style="font-size: 2rem; margin-bottom: 1rem;">&#x1F5D1;&#xFE0F;</p>
            <p><strong>This post is no longer available</strong></p>
            <p style="color: var(--text-dim); margin-top: 0.5rem;">It may have been retracted by the author.</p>
            <button class="btn" onclick="window.cloutApp.switchToTab('feed')" style="margin-top: 1rem;">&#x2190; Back to Feed</button>
          </div>
        </div>
      `;
      $('thread-replies-list').innerHTML = '';
      return;
    }

    const data = result.data;

    // If the post was resolved through an edit chain, update the URL
    if (data.resolved && data.parent) {
      const newPostId = data.parent.id;
      const newUrl = new URL(window.location);
      newUrl.searchParams.set('thread', newPostId);
      window.history.replaceState({}, '', newUrl);
      console.log(`[Thread] Resolved edited post ${data.originalId.slice(0, 8)}... -> ${newPostId.slice(0, 8)}...`);
    }

    // Recalculate trust data using browser's Dark Social Graph
    // This ensures isAuthor, isBookmarked, nicknames use browser identity
    const allPosts = [data.parent, ...data.replies];
    await recalculateTrustForPosts(allPosts);

    showThreadTab();

    // Display parent post
    $('thread-parent').innerHTML = renderThreadPost(data.parent, true);

    // Display replies
    const repliesList = $('thread-replies-list');
    if (data.replies.length === 0) {
      repliesList.innerHTML = '<p class="empty-state">No replies yet. Be the first to reply!</p>';
    } else {
      repliesList.innerHTML = data.replies.map(reply => renderThreadPost(reply, false)).join('');
    }
  } catch (error) {
    console.error('Error loading thread:', error);
    showThreadTab();
    $('thread-parent').innerHTML = `
      <div class="feed-item thread-parent-post" style="text-align: center; padding: 2rem;">
        <div class="empty-state">
          <p style="font-size: 2rem; margin-bottom: 1rem;">&#x26A0;&#xFE0F;</p>
          <p><strong>Could not load thread</strong></p>
          <p style="color: var(--text-dim); margin-top: 0.5rem;">${escapeHtml(error.message)}</p>
          <button class="btn" onclick="window.cloutApp.switchToTab('feed')" style="margin-top: 1rem;">&#x2190; Back to Feed</button>
        </div>
      </div>
    `;
    $('thread-replies-list').innerHTML = '';
  }
}

/**
 * Show thread tab and switch to it
 */
function showThreadTab() {
  const threadTabBtn = document.querySelector('.tab-btn[data-tab="thread"]');
  threadTabBtn.style.display = 'block';
  $$('.tab-btn').forEach(b => b.classList.remove('active'));
  threadTabBtn.classList.add('active');
  $$('.tab-content').forEach(content => content.classList.remove('active'));
  $('thread-tab').classList.add('active');
}

/**
 * Render a post in thread view
 */
function renderThreadPost(post, isParent = false) {
  const hasMedia = post.media && post.media.cid;
  const authorName = post.authorDisplayName || post.author.slice(0, 16) + '...';
  const hasNickname = !!post.authorNickname;
  const avatar = post.authorAvatar || '&#x1F464;';
  const timestamp = post.proof?.timestamp || post.timestamp;
  const editedIndicator = post.isEdited ? '<span class="edited-badge" title="This post has been edited">edited</span>' : '';
  const visitor = isVisitorMode();

  // Reactions bar - hide for visitors
  const reactions = post.reactions || {};
  const reactionsHtml = visitor ? '' : renderReactionsBar(post.id, reactions, post.myReaction);

  // Redact button - hide for visitors
  const muteBtn = (!visitor && !post.isAuthor)
    ? `<button class="btn-action btn-mute" onclick="event.stopPropagation(); window.cloutApp.muteUser('${post.author}', '${escapeHtml(authorName)}')" title="Redact">Redact</button>`
    : '';

  // Author actions - hide for visitors
  const authorActions = (!visitor && post.isAuthor)
    ? `<button class="btn-action" onclick="event.stopPropagation(); window.cloutApp.startEditPost('${post.id}')" title="Revise">Revise</button>
       <button class="btn-action btn-retract" onclick="event.stopPropagation(); window.cloutApp.retractPost('${post.id}')" title="Retract">Retract</button>`
    : '';

  // Save button - hide for visitors
  const saveBtn = visitor ? '' : `
    <button class="btn-action ${post.isBookmarked ? 'active' : ''}" onclick="event.stopPropagation(); window.cloutApp.toggleBookmark('${post.id}')" title="${post.isBookmarked ? 'Remove bookmark' : 'Bookmark'}">
      ${post.isBookmarked ? 'Saved' : 'Save'}
    </button>`;

  // Reply button - hide for visitors
  const replyBtn = visitor ? '' : `
    <button class="btn-action" onclick="event.stopPropagation(); window.cloutApp.startReply('${post.id}', '${escapeHtml(authorName)}')">Reply</button>`;

  const parentClass = isParent ? 'thread-parent-post' : '';
  const clickHandler = isParent ? '' : `onclick="window.cloutApp.viewThread('${post.id}')" style="cursor: pointer;"`;

  return `
    <div class="feed-item ${parentClass} ${hasMedia ? 'has-media' : ''}" ${clickHandler}>
      <div class="feed-item-wrapper">
        <div class="feed-avatar">${renderAvatar(avatar)}</div>
        <div class="feed-post-content">
          <div class="feed-author"><span class="${hasNickname ? 'has-nickname' : ''}" title="${post.author}">${escapeHtml(authorName)}</span></div>
          ${post.replyTo ? `<div class="feed-reply-indicator">&#x21B3; Reply to ${post.replyTo.slice(0, 8)}... <a href="#" onclick="event.preventDefault(); event.stopPropagation(); window.cloutApp.viewThread('${post.resolvedReplyTo || post.replyTo}')">View parent</a></div>` : ''}
          <div class="feed-content">${renderPostContent(post)}</div>
          <div class="feed-footer">
            <div class="feed-timestamp">&#x1F64C; ${formatRelativeTime(timestamp)} ${editedIndicator}</div>
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
