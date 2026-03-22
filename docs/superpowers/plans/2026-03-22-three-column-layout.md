# Three-Column Layout Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Clout's frontend from a 2-column layout (220px nav sidebar + content) to a 3-column layout (72px icon rail + fluid center + 240px right sidebar) modeled after X/Twitter and Bluesky.

**Architecture:** Pure frontend change across `index.html`, `styles.css`, `js/app.js`, `js/feed.js`, and `js/ui.js`. No backend changes. Mobile breakpoint (<=768px) is untouched.

**Tech Stack:** HTML, CSS (custom properties, CSS Grid, sticky positioning), vanilla JS (ES modules)

**Spec:** `docs/superpowers/specs/2026-03-22-three-column-layout-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/web/public/index.html` | Remove header, restructure left rail to icons, add right sidebar, add hop tabs, inline compose, compose modal |
| Modify | `src/web/public/styles.css` | 3-column grid, rail styling, sidebar widgets, hop tabs, sort row, compose modal, responsive breakpoints |
| Modify | `src/web/public/js/app.js` | Tab switching, compose modal, sidebar search wiring, stats targets, visitor visibility |
| Modify | `src/web/public/js/feed.js` | Hop filter logic, update `setFeedSort`/`setFeedFilter`/`searchPosts`/`clearSearch` selectors |
| Modify | `src/web/public/js/ui.js` | `startDayPassTimer`: change `$('day-pass-timer').style.display = 'flex'` to `= 'block'` since the sidebar widget is a block-level `.sidebar-widget`, not a flex container (the internal `.daypass-row` handles flex) |

---

## Important: Duplicate ID Prevention

The old header contains elements with IDs `status-indicator`, `status-text`, `day-pass-timer`, `day-pass-countdown`, `clout-posts`, `clout-authors`, `clout-reactions`, `clout-peers`, and `offline-indicator`. These same IDs are reused in the new rail and sidebar. **Task 1 removes the entire header first**, so by the time Tasks 2-3 add new elements with these IDs, no duplicates exist. All existing JS `$('id')` calls continue to work without changes since the IDs are preserved.

---

### Task 1: Remove Header, Add CSS Grid Shell

**Files:**
- Modify: `src/web/public/index.html:41-90` (remove header block)
- Modify: `src/web/public/styles.css:4180-4232` (grid layout)

- [ ] **Step 1: Remove the header and relocate visitor banner**

In `index.html`, replace the entire `<header class="app-header">` block (lines 41-90) with just the visitor banner placed outside the header:

```html
<!-- Visitor Banner (outside grid, full-width) -->
<div id="visitor-banner" class="visitor-banner" style="display: none;">
  <div class="visitor-banner-content">
    <span class="visitor-icon">&#x1F440;</span>
    <div class="visitor-text">
      <strong>Browsing as a visitor</strong>
      <span>You can view the feed, but you need an invitation to post and interact.</span>
    </div>
    <button id="visitor-join-btn" class="btn btn-primary">Have an invite code?</button>
    <button id="visitor-restore-btn" class="btn btn-secondary">Restore Identity</button>
  </div>
</div>
```

This removes: `header-main-row`, `header-brand`, `instance-info`, `status-indicator`, `status-text`, `offline-indicator`, `day-pass-timer`, `day-pass-countdown`, `instance-clout` (with `clout-posts`, `clout-authors`, `clout-reactions`, `clout-peers`). All these IDs will be re-created in the rail (Task 2) and sidebar (Task 3).

- [ ] **Step 2: Update `.app-shell` grid to three columns**

In `styles.css`, change the `.app-shell` rule (line ~4180):

```css
.app-shell {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) 240px;
  gap: 1rem;
  align-items: start;
  max-width: 1100px;
  margin: 0 auto;
}
```

- [ ] **Step 3: Update `.app-rail-left` to 72px column**

```css
.app-rail-left {
  position: sticky;
  top: 1rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: calc(100vh - 2rem);
}
```

- [ ] **Step 4: Add `.app-rail-right` sidebar base styles**

```css
.app-rail-right {
  position: sticky;
  top: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.sidebar-widget {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 0.85rem;
}

.sidebar-widget h4 {
  font-size: 0.85rem;
  margin-bottom: 0.5rem;
  color: var(--text);
}
```

- [ ] **Step 5: Update `.container`**

```css
.container {
  margin: 0 auto;
  padding: 1rem;
}
```

- [ ] **Step 6: Hide old header styles**

Add `display: none` to `.app-header` and remove or comment out the old header CSS rules: `.header-main-row`, `.header-brand`, `.header-status-col`, `.header-logo`, `.instance-clout`, `.clout-stat`, `.clout-value`, `.clout-label`, `.clout-peers`.

- [ ] **Step 7: Commit**

```bash
git add src/web/public/index.html src/web/public/styles.css
git commit -m "feat: remove header, set up 3-column CSS grid shell"
```

---

### Task 2: Left Rail — Icon Navigation

**Files:**
- Modify: `src/web/public/index.html:151-166` (rail content)
- Modify: `src/web/public/styles.css` (icon rail styles)

- [ ] **Step 1: Replace rail HTML with icon nav**

Replace the `<aside class="app-rail-left">` contents (lines ~151-166) with:

```html
<aside class="app-rail-left">
  <div class="rail-brand">
    <span class="rail-monogram">C</span>
  </div>
  <nav class="app-nav-tabs">
    <button class="tab-btn active" data-tab="feed" aria-label="Home" title="Home">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
      <span id="feed-badge" class="tab-badge" style="display: none;">0</span>
    </button>
    <button class="tab-btn" data-tab="trust" aria-label="Network" title="Network">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
    </button>
    <button class="tab-btn" data-tab="slides" aria-label="DMs" title="DMs">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <span id="slides-badge" class="tab-badge" style="display: none;">0</span>
    </button>
    <button class="tab-btn" data-tab="profile" aria-label="Profile" title="Profile">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
    </button>
    <button class="tab-btn" data-tab="owner" aria-label="Owner" title="Owner">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
    </button>
    <button class="tab-btn" data-tab="settings" aria-label="Settings" title="Settings">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
      <span id="settings-badge" class="tab-badge" style="display: none;">!</span>
    </button>
    <button class="tab-btn" data-tab="thread" style="display: none;" aria-label="Thread" title="Thread">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    </button>
  </nav>
  <div class="rail-spacer"></div>
  <button class="compose-fab" aria-label="New post" title="New post" id="compose-fab-btn">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
  </button>
  <div class="rail-status">
    <span id="status-indicator" class="status-dot"></span>
    <span id="status-text" class="rail-status-label">Not initialized</span>
    <span id="offline-indicator" class="offline-indicator" style="display: none;">Offline</span>
  </div>
  <button id="mobile-more-trigger" class="mobile-more-trigger" type="button">More</button>
</aside>
```

Note: `#offline-indicator` is relocated here from the removed header so existing JS continues to work.

- [ ] **Step 2: Add icon rail CSS**

Replace old `.rail-brand`, `.rail-logo`, `.app-nav-tabs`, `.app-nav-tabs .tab-btn` rules with:

```css
.rail-monogram {
  font-size: 1.6rem;
  font-weight: 800;
  color: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
}

.rail-brand {
  margin-bottom: 0.75rem;
  display: flex;
  justify-content: center;
}

.rail-logo {
  display: none;
}

.app-nav-tabs {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  border: none;
  background: none;
  border-radius: 0;
  padding: 0;
  margin-bottom: 0;
}

.app-nav-tabs .tab-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: none;
  border-radius: 12px;
  background: none;
  color: var(--text-dim);
  cursor: pointer;
  position: relative;
  transition: background 0.15s, color 0.15s;
  text-align: center;
  font-size: 0;
}

.app-nav-tabs .tab-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.app-nav-tabs .tab-btn.active {
  background: rgba(99, 102, 241, 0.2);
  color: var(--primary);
}

.app-nav-tabs .tab-btn svg {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}

.app-nav-tabs .tab-btn .tab-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  min-width: 16px;
  height: 16px;
  font-size: 0.65rem;
  background: var(--error);
  color: white;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 3px;
}

.rail-spacer { flex: 1; }

.compose-fab {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  background: var(--primary);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 0.75rem;
  transition: background 0.15s;
}

.compose-fab:hover { background: var(--primary-hover); }

.rail-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.5rem 0;
}

.rail-status-label {
  font-size: 0.6rem;
  color: var(--text-dim);
  text-align: center;
  line-height: 1.2;
  max-width: 64px;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 3: Verify — left rail is 72px with icons, status, and compose FAB**

- [ ] **Step 4: Commit**

```bash
git add src/web/public/index.html src/web/public/styles.css
git commit -m "feat: convert left nav to 72px icon rail with monogram, FAB, status"
```

---

### Task 3: Right Sidebar — Widgets

**Files:**
- Modify: `src/web/public/index.html` (add `<aside class="app-rail-right">` after `</main>`, remove old in-feed search)
- Modify: `src/web/public/styles.css` (sidebar widget styles)

- [ ] **Step 1: Add right sidebar HTML**

In `index.html`, after the closing `</main>` of `.app-main` and before the closing `</div>` of `.app-shell`, insert:

```html
<aside class="app-rail-right">
  <div class="sidebar-widget sidebar-search">
    <div class="sidebar-search-input">
      <input type="text" id="sidebar-search" class="input" placeholder="Search posts, authors...">
      <button id="sidebar-search-btn" class="sidebar-search-icon" aria-label="Search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </button>
    </div>
  </div>

  <div class="sidebar-widget sidebar-feed-legend">
    <h4>Feed Legend</h4>
    <div class="legend-levels">
      <div class="legend-item"><span class="legend-icon">&#x1FA9E;</span><div class="legend-text"><strong>Self</strong><span class="legend-desc">Your own posts</span></div></div>
      <div class="legend-item"><span class="legend-icon">&#x1F464;</span><div class="legend-text"><strong>Direct (1 hop)</strong><span class="legend-desc">People you personally trust</span></div></div>
      <div class="legend-item"><span class="legend-icon">&#x1F465;</span><div class="legend-text"><strong>Friends of Friends (2 hops)</strong><span class="legend-desc">Vouched for by someone you trust</span></div></div>
      <div class="legend-item"><span class="legend-icon">&#x1F310;</span><div class="legend-text"><strong>Extended Network (3 hops)</strong><span class="legend-desc">Within your wider web of trust</span></div></div>
    </div>
  </div>

  <div class="sidebar-widget sidebar-stats">
    <h4>Network</h4>
    <div class="sidebar-stats-grid">
      <div class="sidebar-stat"><span class="sidebar-stat-value" id="clout-posts">-</span><span class="sidebar-stat-label">posts</span></div>
      <div class="sidebar-stat"><span class="sidebar-stat-value" id="clout-authors">-</span><span class="sidebar-stat-label">authors</span></div>
      <div class="sidebar-stat"><span class="sidebar-stat-value" id="clout-reactions">-</span><span class="sidebar-stat-label">reactions</span></div>
      <div class="sidebar-stat"><span class="sidebar-stat-value" id="clout-peers">-</span><span class="sidebar-stat-label">peers</span></div>
    </div>
  </div>

  <div id="day-pass-timer" class="sidebar-widget sidebar-daypass" style="display: none;">
    <h4>Day Pass</h4>
    <div class="daypass-row">
      <span class="daypass-icon">&#x1F54A;&#xFE0F;</span>
      <span id="day-pass-countdown" class="daypass-countdown">--:--:--</span>
      <span class="daypass-label">remaining</span>
    </div>
  </div>
</aside>
```

These IDs (`clout-posts`, `clout-authors`, etc.) are safe because the header containing the old copies was removed in Task 1.

- [ ] **Step 2: Remove old in-feed search bar**

In `index.html`, delete the `#search-bar-container` block from the feed tab (lines ~194-199 in original):

```html
<!-- DELETE THIS BLOCK -->
<div id="search-bar-container" class="search-bar">
  <input type="text" id="feed-search" ...>
  <button id="search-btn" ...>
  <button id="clear-search-btn" ...>
</div>
```

- [ ] **Step 3: Add sidebar widget CSS**

```css
.sidebar-search-input {
  display: flex;
  position: relative;
}

.sidebar-search-input .input {
  width: 100%;
  padding-right: 2rem;
  font-size: 0.85rem;
  border-radius: 999px;
  background: var(--bg);
  border: 1px solid var(--border);
}

.sidebar-search-icon {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  padding: 4px;
}

.legend-levels {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.legend-item {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}

.legend-icon {
  font-size: 1rem;
  flex-shrink: 0;
  width: 24px;
  text-align: center;
}

.legend-text {
  display: flex;
  flex-direction: column;
  font-size: 0.8rem;
  line-height: 1.3;
}

.legend-text strong { color: var(--text); }

.legend-desc {
  color: var(--text-dim);
  font-size: 0.75rem;
}

.sidebar-stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

.sidebar-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.35rem;
}

.sidebar-stat-value {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text);
}

.sidebar-stat-label {
  font-size: 0.7rem;
  color: var(--text-dim);
}

.daypass-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.daypass-countdown {
  font-family: monospace;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text);
}

.daypass-label {
  font-size: 0.75rem;
  color: var(--text-dim);
}
```

- [ ] **Step 4: Verify — sidebar shows search, legend, stats, day pass**

- [ ] **Step 5: Commit**

```bash
git add src/web/public/index.html src/web/public/styles.css
git commit -m "feat: right sidebar with search, feed legend, stats, day pass"
```

---

### Task 4: Feed — Hop Tabs, Sort Row, and Selector Updates

**Files:**
- Modify: `src/web/public/index.html:171-223` (feed tab content)
- Modify: `src/web/public/styles.css` (hop tabs, sort row, inline compose)
- Modify: `src/web/public/js/feed.js` (hop filter, update selectors in `setFeedSort`, `setFeedFilter`, `searchPosts`, `clearSearch`)
- Modify: `src/web/public/js/app.js` (wire new elements)

- [ ] **Step 1: Replace feed tab HTML**

Replace the entire `#feed-tab` content (lines ~171-223) with:

```html
<div id="feed-tab" class="tab-content active">
  <!-- Inline Quick Compose -->
  <div id="inline-compose" class="inline-compose">
    <div class="inline-compose-row">
      <div class="inline-compose-avatar">&#x1F464;</div>
      <input type="text" id="inline-compose-input" class="inline-compose-field" placeholder="What's on your mind?">
    </div>
    <div id="inline-compose-expanded" class="inline-compose-expanded" style="display: none;">
      <textarea id="inline-compose-text" class="inline-compose-textarea" rows="3" maxlength="5000"></textarea>
      <div class="inline-compose-actions">
        <button class="btn btn-small btn-primary" id="inline-post-btn">Post</button>
        <button class="btn btn-small" id="inline-compose-expand" title="Full editor">&#x2026;</button>
      </div>
    </div>
  </div>

  <!-- Hop Filter Tabs -->
  <div class="feed-tabs" id="feed-hop-tabs">
    <button class="feed-tab-btn active" data-hop="all">All</button>
    <button class="feed-tab-btn" data-hop="1">1st Hop</button>
    <button class="feed-tab-btn" data-hop="2">2nd Hop</button>
    <button class="feed-tab-btn" data-hop="3">3rd Hop</button>
  </div>

  <!-- Sort Row + Content-Type Filters -->
  <div class="feed-sort-row">
    <div class="feed-sort-pills">
      <button class="sort-pill active" data-sort="newest">Newest</button>
      <button class="sort-pill" data-sort="hot">Hot</button>
      <button class="sort-pill" data-sort="reactions">Top</button>
      <button class="sort-pill" data-sort="replies">Discussed</button>
    </div>
    <div class="sort-separator"></div>
    <div id="feed-filters-container" class="feed-filter-icons">
      <button class="filter-icon-btn active" data-filter="all" title="All Posts">All</button>
      <button class="filter-icon-btn" data-filter="bookmarks" title="Bookmarks">&#x1F516;</button>
      <button class="filter-icon-btn" data-filter="replies" title="Replies">&#x1F4AC;</button>
      <button class="filter-icon-btn" data-filter="mentions" title="Mentions">@</button>
    </div>
  </div>

  <!-- Tag Filter -->
  <div id="tag-filters" class="tag-filters" style="display: none;">
    <span class="tag-filter-label">Tags:</span>
    <div id="tag-filter-pills" class="tag-filter-pills"></div>
  </div>

  <!-- New Posts Banner -->
  <div id="new-posts-banner" class="new-posts-banner" style="display: none;">
    <button onclick="window.cloutApp.loadNewPosts()">&#x2B06;&#xFE0F; <span id="new-posts-count">0</span> new posts - Click to load</button>
  </div>

  <div id="feed-result" class="result-message"></div>
  <div id="feed-list" class="feed-list"></div>
</div>
```

- [ ] **Step 2: Add hop tabs, sort row, inline compose CSS**

```css
/* Hop Filter Tabs */
.feed-tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
}

.feed-tab-btn {
  flex: 1;
  padding: 0.7rem 0.5rem;
  text-align: center;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-dim);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}

.feed-tab-btn:hover { color: var(--text); }
.feed-tab-btn.active { color: var(--primary); border-bottom-color: var(--primary); }

/* Sort Row */
.feed-sort-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0;
}

.feed-sort-pills { display: flex; gap: 0.35rem; }

.sort-pill {
  padding: 0.25rem 0.65rem;
  font-size: 0.75rem;
  border-radius: 999px;
  border: none;
  background: var(--bg-tertiary);
  color: var(--text-dim);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.sort-pill:hover { color: var(--text); }
.sort-pill.active { background: var(--primary); color: white; }

.sort-separator {
  width: 1px;
  height: 16px;
  background: var(--border);
  margin: 0 0.25rem;
}

.feed-filter-icons { display: flex; gap: 0.35rem; }

.filter-icon-btn {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  border-radius: 999px;
  border: none;
  background: var(--bg-tertiary);
  color: var(--text-dim);
  cursor: pointer;
}

.filter-icon-btn:hover { color: var(--text); }
.filter-icon-btn.active { background: rgba(99, 102, 241, 0.2); color: var(--primary); }

/* Inline Compose */
.inline-compose {
  padding: 0.75rem;
  border-bottom: 1px solid var(--border);
}

.inline-compose-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.inline-compose-avatar {
  font-size: 1.5rem;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.inline-compose-field {
  flex: 1;
  padding: 0.5rem 0.75rem;
  border-radius: 999px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 0.9rem;
}

.inline-compose-field:focus { outline: none; border-color: var(--primary); }

.inline-compose-expanded {
  margin-top: 0.5rem;
  padding-left: calc(36px + 0.75rem);
}

.inline-compose-textarea {
  width: 100%;
  padding: 0.5rem;
  border-radius: 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 0.9rem;
  resize: vertical;
  font-family: inherit;
}

.inline-compose-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.35rem;
}
```

- [ ] **Step 3: Update `setFeedSort()` in feed.js**

The existing `setFeedSort()` function uses `document.querySelectorAll('.feed-sort-btn')`. Change this selector to `.sort-pill`:

```javascript
// In setFeedSort():
document.querySelectorAll('.sort-pill').forEach(btn => {
  btn.classList.toggle('active', btn.dataset.sort === sort);
});
```

- [ ] **Step 4: Update `setFeedFilter()` in feed.js**

The existing `setFeedFilter()` and `filterByTag()` functions use `$$('.filter-btn')`. Change to `.filter-icon-btn`:

```javascript
// In setFeedFilter():
$$('.filter-icon-btn').forEach(btn => {
  btn.classList.toggle('active', btn.dataset.filter === filter);
});

// In filterByTag():
$$('.filter-icon-btn').forEach(btn => btn.classList.remove('active'));
```

- [ ] **Step 5: Update `searchPosts()` and `clearSearch()` in feed.js**

The existing functions reference `$('feed-search')`, `$('search-btn')`, and `$('clear-search-btn')`. Update them to use the sidebar search:

```javascript
// In searchPosts():
// Change: const query = $('feed-search').value.trim();
// To:
const query = $('sidebar-search').value.trim();

// In clearSearch():
// Change: $('feed-search').value = '';
// To:
$('sidebar-search').value = '';
// Remove ALL references to $('clear-search-btn') — it no longer exists.
// This includes the line inside searchPosts() (~feed.js:825):
//   $('clear-search-btn').style.display = 'inline-block';
// Delete that line. Also remove the reference in clearSearch().
```

- [ ] **Step 6: Add hop filter state and function in feed.js**

At the top of `feed.js`, add:

```javascript
let currentHopFilter = 'all';
```

Add export function:

```javascript
export function setHopFilter(hop) {
  currentHopFilter = hop;
  document.querySelectorAll('.feed-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.hop === hop);
  });
  loadFeedWithCurrentFilter();
}
```

In the feed filtering logic (where posts are filtered by trust), add hop distance filtering. Use `window.userPublicKey` (not the closure-scoped `browserPublicKey`):

```javascript
if (currentHopFilter !== 'all') {
  const hopNum = parseInt(currentHopFilter);
  posts = posts.filter(p =>
    p._hopDistance === hopNum ||
    (hopNum === 0 && p.author === window.userPublicKey)
  );
}
```

Export `setHopFilter` from feed.js.

- [ ] **Step 7: Wire new elements in app.js**

In the `DOMContentLoaded` handler of `app.js`:

```javascript
// Hop tab clicks
document.querySelectorAll('.feed-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => setHopFilter(btn.dataset.hop));
});

// Sort pill clicks (replace old .feed-sort-btn listeners)
document.querySelectorAll('.sort-pill').forEach(btn => {
  btn.addEventListener('click', () => setFeedSort(btn.dataset.sort));
});

// Filter icon clicks (replace old .filter-btn listeners)
document.querySelectorAll('.filter-icon-btn').forEach(btn => {
  btn.addEventListener('click', () => setFeedFilter(btn.dataset.filter));
});

// Sidebar search (replaces old #search-btn / #feed-search listeners)
$('sidebar-search-btn')?.addEventListener('click', () => {
  switchToTab('feed');
  searchPosts();
});
$('sidebar-search')?.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    switchToTab('feed');
    searchPosts();
  }
});

// Inline compose
const inlineInput = $('inline-compose-input');
const inlineExpanded = $('inline-compose-expanded');
const inlineText = $('inline-compose-text');

inlineInput?.addEventListener('focus', () => {
  inlineExpanded.style.display = 'block';
  inlineText.value = inlineInput.value;
  inlineInput.style.display = 'none';
  inlineText.focus();
});

$('inline-post-btn')?.addEventListener('click', async () => {
  const text = inlineText.value.trim();
  if (!text || !requireMembership()) return;
  try {
    await apiCall('/posts', 'POST', { content: text });
    inlineText.value = '';
    inlineInput.value = '';
    inlineExpanded.style.display = 'none';
    inlineInput.style.display = 'block';
    loadFeed();
  } catch (e) {
    showResult('feed-result', e.message, false);
  }
});
```

Remove or update these old listeners — the elements no longer exist:
- `$('search-btn')` — removed (search is now `$('sidebar-search-btn')`)
- `$('clear-search-btn')` — removed
- `$('feed-search')` keypress — removed
- `$$('.filter-btn')` — now `.filter-icon-btn` (already wired above)
- `$('refresh-feed-btn')` — removed

**Critical:** These must be removed or use optional chaining (`?.addEventListener`) in this step, not deferred to Task 9, or the app will throw `TypeError: Cannot read properties of null` at boot between Tasks 4 and 9.

Add `setHopFilter` to `window.cloutApp` exports and to the import from feed.js.

- [ ] **Step 8: Remove old feed sort/filter CSS**

Remove or replace the old `.feed-sort`, `.feed-sort-buttons`, `.feed-sort-btn`, `.search-bar` CSS rules — they are superseded by `.sort-pill`, `.feed-sort-row`, sidebar search.

- [ ] **Step 9: Verify — hop tabs filter, sort pills work, sidebar search works, inline compose posts**

- [ ] **Step 10: Commit**

```bash
git add src/web/public/index.html src/web/public/styles.css src/web/public/js/feed.js src/web/public/js/app.js
git commit -m "feat: hop filter tabs, sort row, inline compose, updated selectors"
```

---

### Task 5: Compose Modal

**Files:**
- Modify: `src/web/public/index.html` (add modal before `</body>`)
- Modify: `src/web/public/styles.css` (modal overlay)
- Modify: `src/web/public/js/app.js` (open/close, fix empty-state buttons)

- [ ] **Step 1: Add compose modal HTML**

Before `</body>`:

```html
<div id="compose-modal" class="compose-modal-overlay" style="display: none;">
  <div class="compose-modal">
    <div class="compose-modal-header">
      <h3>New Post</h3>
      <button class="compose-modal-close" id="compose-modal-close" aria-label="Close">&times;</button>
    </div>
    <div class="compose-modal-body" id="compose-modal-body">
      <!-- #post-tab content moved here on open, moved back on close -->
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add compose modal CSS**

```css
.compose-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(2px);
}

.compose-modal {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 16px;
  width: 90%;
  max-width: 600px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
}

.compose-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--border);
}

.compose-modal-header h3 { font-size: 1rem; margin: 0; }

.compose-modal-close {
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0 0.25rem;
  line-height: 1;
}

.compose-modal-close:hover { color: var(--text); }

.compose-modal-body { padding: 1rem; }
```

- [ ] **Step 3: Wire compose modal in app.js — use DOM move (not cloneNode) to avoid duplicate IDs**

```javascript
function openComposeModal(draftText = '') {
  if (!requireMembership()) return;
  const modal = $('compose-modal');
  const body = $('compose-modal-body');
  const postTabSection = $('post-tab').querySelector('.section');

  // MOVE (not clone) the post-tab section into the modal to avoid duplicate IDs
  body.appendChild(postTabSection);

  if (draftText) {
    const textarea = $('post-content');
    if (textarea) textarea.value = draftText;
  }

  modal.style.display = 'flex';
}

function closeComposeModal() {
  const modal = $('compose-modal');
  const body = $('compose-modal-body');
  const postTabSection = body.querySelector('.section');

  // Move the section back to #post-tab
  if (postTabSection) {
    $('post-tab').appendChild(postTabSection);
  }

  modal.style.display = 'none';
}
```

Wire events:

```javascript
$('compose-fab-btn')?.addEventListener('click', () => openComposeModal());
$('compose-modal-close')?.addEventListener('click', closeComposeModal);
$('compose-modal')?.addEventListener('click', (e) => {
  if (e.target === $('compose-modal')) closeComposeModal();
});

// Inline compose expand button opens modal with draft
$('inline-compose-expand')?.addEventListener('click', () => {
  const draft = $('inline-compose-text')?.value || '';
  openComposeModal(draft);
});
```

Export `openComposeModal` on `window.cloutApp`.

- [ ] **Step 4: Update empty-state "Write Your First Post" buttons**

In `feed.js`, find the empty-state HTML that calls `switchToTab('post')` (~line 388 and ~line 561). Change these to call `openComposeModal()`:

```javascript
// Change: onclick="window.cloutApp.switchToTab('post')"
// To:
onclick="window.cloutApp.openComposeModal()"
```

There are two instances in feed.js — search both for `switchToTab('post')` or `switchToTab(&quot;post&quot;)`.

Also in `index.html`, find the `mobile-compose-fab` button (~line 984) which has `onclick="window.cloutApp.switchToTab('post')"` and change it to `onclick="window.cloutApp.openComposeModal()"`. Otherwise the mobile compose FAB navigates to the hidden `#post-tab` instead of opening the modal.

- [ ] **Step 5: Verify — FAB opens modal, inline expand opens modal, posting works, close returns form to #post-tab**

- [ ] **Step 6: Commit**

```bash
git add src/web/public/index.html src/web/public/styles.css src/web/public/js/app.js src/web/public/js/feed.js
git commit -m "feat: compose modal (DOM move, no ID duplication)"
```

---

### Task 6: Remove Trust Explainer from Network Tab

**Files:**
- Modify: `src/web/public/index.html` (remove `.trust-explainer` block from `#trust-tab`)

- [ ] **Step 1: Remove the trust explainer block**

In `index.html`, locate and delete the `<!-- Trust Explainer -->` block inside `#trust-tab`. It starts with `<div class="trust-explainer">` and ends with the closing `</div>` after the level-3 entry (~lines 419-452 in original). This content now lives in the right sidebar as "Feed Legend."

- [ ] **Step 2: Verify — Network tab no longer shows "How Your Feed Works"**

- [ ] **Step 3: Commit**

```bash
git add src/web/public/index.html
git commit -m "refactor: remove trust explainer from network tab (now in sidebar)"
```

---

### Task 7: Update Tab Switching and Visitor Visibility

**Files:**
- Modify: `src/web/public/js/app.js` (`updateTabVisibility`, `loadInstanceInfo`)

- [ ] **Step 1: Update `updateTabVisibility`**

```javascript
function updateTabVisibility(isVisitor) {
  const memberOnlyTabs = ['post', 'trust', 'slides', 'profile', 'settings'];

  memberOnlyTabs.forEach(tabName => {
    const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (tabBtn) tabBtn.style.display = isVisitor ? 'none' : '';
  });

  // Hide compose elements for visitors
  const composeFab = $('compose-fab-btn');
  if (composeFab) composeFab.style.display = isVisitor ? 'none' : '';

  const inlineCompose = $('inline-compose');
  if (inlineCompose) inlineCompose.style.display = isVisitor ? 'none' : '';

  // Hide sidebar search and inline search fallback for visitors
  const sidebarSearch = document.querySelector('.sidebar-search');
  if (sidebarSearch) sidebarSearch.style.display = isVisitor ? 'none' : '';

  const inlineSearchFallback = document.querySelector('.inline-search-fallback');
  if (inlineSearchFallback) inlineSearchFallback.style.display = isVisitor ? 'none' : '';
}
```

- [ ] **Step 2: Simplify `loadInstanceInfo`**

The header is gone, so `$('instance-info')` and `$('instance-operator-text')` no longer exist. Update:

```javascript
async function loadInstanceInfo() {
  try {
    const result = await apiCall('/instance');
    // Instance info stored for internal use; no header to display it
  } catch (error) {
    console.warn('[App] Could not load instance info:', error.message);
  }
}
```

In `setupMobileHeaderBehavior()` (~app.js:125), remove the `$('instance-info')` click handler (lines ~126-133) since the header is gone, but **preserve the scroll-based `nav-scroll-down` class toggle** (lines ~135-142) — that controls the mobile nav hide-on-scroll behavior which is still needed.

- [ ] **Step 3: Verify — visitor mode hides member-only icons and compose, member mode shows all**

- [ ] **Step 4: Commit**

```bash
git add src/web/public/js/app.js
git commit -m "feat: update visitor visibility for icon rail layout"
```

---

### Task 8: Responsive Breakpoints

**Files:**
- Modify: `src/web/public/styles.css` (media queries)

- [ ] **Step 1: Add 769px-1200px breakpoint**

Per spec: right sidebar hidden, search moves inline above hop tabs, stats/Day Pass become a collapsible summary row, Feed Legend hidden.

```css
@media (max-width: 1200px) and (min-width: 769px) {
  .app-shell {
    grid-template-columns: 72px minmax(0, 1fr);
  }

  .app-rail-right {
    display: none;
  }

  /* Show a compact inline search above hop tabs when sidebar hidden */
  .feed-tabs::before {
    content: '';
    display: block;
  }

  /* Create inline search fallback that shows at this breakpoint */
  .inline-search-fallback {
    display: flex;
    padding: 0.5rem;
    border-bottom: 1px solid var(--border);
  }

  .inline-search-fallback .input {
    flex: 1;
    font-size: 0.85rem;
    border-radius: 999px;
    background: var(--bg);
    border: 1px solid var(--border);
    padding: 0.4rem 0.75rem;
  }
}
```

Additionally, add a hidden-by-default inline search div in the feed tab HTML (in Task 4's HTML, before the hop tabs):

```html
<!-- Inline search fallback (visible at 769-1200px when sidebar hidden) -->
<div class="inline-search-fallback" style="display: none;">
  <input type="text" id="inline-search-fallback" class="input" placeholder="Search..." aria-label="Search posts and authors">
</div>
```

And CSS to show it at the breakpoint:

```css
@media (max-width: 1200px) and (min-width: 769px) {
  .inline-search-fallback {
    display: flex !important;
  }
}
```

Wire in app.js — add explicit event listeners and sync logic:

```javascript
// Inline search fallback (visible at 769-1200px)
$('inline-search-fallback')?.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    // Sync to sidebar search so searchPosts() reads the right value
    const query = $('inline-search-fallback').value;
    $('sidebar-search').value = query;
    switchToTab('feed');
    searchPosts();
  }
});
```

Also update `clearSearch()` in feed.js to clear both inputs:

```javascript
// In clearSearch(), after clearing sidebar-search:
if ($('inline-search-fallback')) $('inline-search-fallback').value = '';
```

- [ ] **Step 2: Update existing <=768px mobile breakpoint**

Add to the existing `@media (max-width: 768px)` block:

```css
.app-rail-right {
  display: none;
}

.inline-compose {
  display: none;
}

.compose-fab {
  display: none; /* mobile uses existing mobile-compose-fab */
}

.feed-tabs {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.feed-sort-row {
  flex-wrap: wrap;
}

.inline-search-fallback {
  display: none !important;
}
```

- [ ] **Step 3: Verify at three widths**

- >1200px: full 3-column
- 769-1200px: 2-column with inline search fallback
- <=768px: single column, bottom tab bar, unchanged

- [ ] **Step 4: Commit**

```bash
git add src/web/public/index.html src/web/public/styles.css src/web/public/js/app.js
git commit -m "feat: responsive breakpoints for 3-column layout"
```

---

### Task 9: Final Cleanup

**Files:**
- Modify: `src/web/public/styles.css` (remove dead rules)
- Modify: `src/web/public/js/app.js` (remove dead listeners)

- [ ] **Step 1: Remove dead CSS rules**

Remove: `.app-header`, `.header-main-row`, `.header-brand`, `.header-status-col`, `.header-logo`, `.instance-clout`, `.clout-stat`, `.clout-value`, `.clout-label`, `.clout-peers` rules. Also remove old `.feed-sort`, `.feed-sort-buttons`, `.feed-sort-btn`, `.search-bar` rules (superseded by new sort/search styles).

- [ ] **Step 2: Remove dead event listeners in app.js**

Remove or update these from the `DOMContentLoaded` handler:
- `$('search-btn')` listener — search is now `$('sidebar-search-btn')`
- `$('clear-search-btn')` listener — removed element
- `$('feed-search')` keypress listener — removed element
- `$('refresh-feed-btn')` listener — if button was removed in Task 4's HTML
- `$$('.filter-btn')` listener loop — now `.filter-icon-btn` (already wired in Task 4)

Use optional chaining (`?.addEventListener`) for any elements that may not exist.

- [ ] **Step 3: Full visual QA**

Test:
1. All 6 nav icons switch tabs correctly
2. Feed hop tabs filter by distance
3. Sort pills change sort order
4. Content-type filter icons (All, Bookmarks, Replies, Mentions) work
5. Inline compose posts text
6. Compose FAB opens modal with full form
7. Sidebar search searches and shows results in feed
8. Visitor mode hides member-only elements
9. Thread view works in center column
10. Mobile layout unchanged (<=768px)
11. Day Pass timer shows in sidebar when active
12. Network stats populate in sidebar
13. Empty-state "Write Your First Post" opens compose modal

- [ ] **Step 4: Commit**

```bash
git add src/web/public/styles.css src/web/public/js/app.js
git commit -m "chore: remove dead header/sort/search CSS and event listeners"
```
