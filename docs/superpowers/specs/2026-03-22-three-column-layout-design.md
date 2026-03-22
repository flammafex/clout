# Three-Column Layout Redesign

**Date:** 2026-03-22
**Status:** Approved

## Overview

Redesign Clout's frontend from a 2-column layout (220px nav sidebar + content area) to a 3-column layout modeled after X/Twitter and Bluesky. The goal is a modern social network feel with better use of horizontal space and persistent contextual information in a right sidebar.

## Layout Structure

### Three Columns

| Column | Width | Position | Content |
|--------|-------|----------|---------|
| Left rail | 72px | Sticky | Logo, nav icons, compose button, status |
| Center | Fluid (`1fr`, largest, max-width 700px content) | Scrollable | Feed, Network, DMs, Profile, Owner, Settings pages |
| Right sidebar | ~240px | Sticky | Search, Feed Legend, Network stats, Day Pass |

Grid definition: `grid-template-columns: 72px minmax(0, 1fr) 240px`

Container max-width: 1100px (centered). This yields a center column of ~788px at full width, with feed content capped at 700px within it (centered, matching typical social feed widths).

### Left Rail (72px)

- **Top:** Clout monogram — a single-letter "C" in the brand font/color. The full `clout.webp` logo is too wide for 72px; use a CSS text monogram (no new asset needed).
- **Nav icons:** Vertically stacked icon buttons (~40x40px) with `aria-label` and `title` tooltip on hover
  - Home (feed)
  - Network (trust management)
  - DMs (slides)
  - Profile
  - Owner (visible to owner only)
  - Settings
- **Bottom:** Status indicator (green dot + "Connected" or "Visitor mode" label, small text)
- **Compose:** Floating "+" button (circular, primary color) above status

The rail does NOT expand on hover or at wider breakpoints — it stays at 72px. All nav buttons must have `aria-label` attributes for accessibility.

### Center Column (Fluid)

The widest column. Content changes based on the active nav item. All existing tab content pages render here.

#### Feed Page Specific

**Inline quick-compose** at the top:
- Avatar + "What's on your mind?" input
- On focus: expands to show a text area and "Post" button
- For simple text-only posts
- If the user needs media/tags/NSFW, clicking a media icon or pressing a shortcut opens the full compose modal with their draft text carried over

**Hop filter tabs** (Bluesky-style, full-width):
- Tabs: All | 1st Hop | 2nd Hop | 3rd Hop
- Rendered as a tab bar with bottom-border indicator on active tab
- Positioned below the inline compose

**Sort row** below the hop tabs:
- Pill buttons: Newest | Hot | Top | Discussed
- Secondary visual weight (smaller, muted colors)

**Content-type filter pills** — the existing Bookmarks / Replies / Mentions / Tags filters remain as small icon-pills in the sort row, after a visual separator. These are orthogonal to hop filtering (a user can view "Bookmarks from 2nd hop"). The tag filter row (`#tag-filters`) also remains, appearing below the sort row when tags are active.

**New posts banner** ("X new posts — Click to load") renders between the sort row and the first post, same as current behavior.

**Feed posts** render below. Existing post card design is preserved.

#### Thread View

When a user clicks into a thread, the center column swaps to show the thread view (replacing feed content, same as current behavior). The `#thread-tab` content renders in the center column with its "Back to Feed" button. The right sidebar remains unchanged during thread view.

#### Other Pages

Network, DMs, Profile, Owner, and Settings pages render their existing content in the center column. No changes to their internal layout — they simply fill the center column instead of the full `app-main` area.

The "How Your Feed Works" / trust level explainer is **removed from the Network tab** since it now lives permanently in the right sidebar as "Feed Legend."

### Right Sidebar (240px, Sticky)

Static across all pages. Contains these widgets top-to-bottom:

1. **Search bar** — text input at the top, matching X/Bluesky placement. Searches posts and authors (same scope as current feed search). On submit, switches to the Home/feed view and applies the search filter — results render in the center column feed list. The current in-feed search bar is removed.
2. **Feed Legend** — renamed from "How Your Feed Works." Shows the trust level hierarchy:
   - Self (0 hops) — your own posts
   - Direct (1 hop) — people you personally trust
   - Friends of Friends (2 hops) — vouched for by someone you trust
   - Extended Network (3 hops) — within your wider web of trust
3. **Network stats** — posts, authors, reactions, peers counts (moved from header)
4. **Day Pass status** — Freebird Day Pass timer and expiry (moved from header)

Each widget is a card with `background: var(--bg-card)` styling (the elevated card background, not the page background), rounded corners, subtle border.

## Header

**Removed.** The full-width header bar is eliminated:

- Logo → left rail (top, as monogram)
- "Connected"/"Visitor mode" status → left rail (bottom, next to status dot)
- Network stats → right sidebar widget
- Day Pass timer → right sidebar widget
- Instance operator text → left rail tooltip on the monogram, or removed if not essential

## Visitor / Pre-Auth Experience

The visitor banner and init-section (invite/restore buttons) render **outside the 3-column grid**, as a full-width section above `#main-app`. This is the same DOM position as current — these elements are shown before the user has an identity and `#main-app` is hidden. No change to the onboarding flow structure.

Once authenticated, the visitor banner hides and `#main-app` (with the 3-column grid) becomes visible — same as current behavior.

## Compose Experience

Two paths to create a post:

1. **Inline quick-compose** — always visible at top of feed. Simple text area + Post button. For fast text-only posts.
2. **Full compose modal** — triggered by the "+" button in the left rail (or by clicking a media/expand icon in the inline compose). Opens as a **centered overlay modal** (max-width 600px, max-height 80vh, scrollable) with full editing capabilities: text area, media upload, tags, NSFW toggle. Same functionality as the current Compose tab. The modal has a backdrop overlay that dims the page.

The `#post-tab` div is kept in the DOM but never navigated to via the rail. Its content is cloned/referenced by the compose modal. The Compose tab button is removed from the left rail navigation.

## Mobile Behavior

The 3-column layout applies to desktop only (>768px breakpoint):

- **Left rail** → collapses to fixed bottom tab bar (existing mobile behavior)
- **Right sidebar** → hidden entirely on mobile
- **Center column** → full width
- Compose FAB (floating action button) → preserved for mobile compose

No changes to the existing mobile navigation, bottom sheet, or safe-area handling.

## Tab/Page Switching

The existing tab switching mechanism is preserved conceptually:
- Clicking a nav icon in the left rail swaps the center column content
- Left rail and right sidebar remain static
- Active nav icon gets a highlighted background
- Data loading triggers remain the same (loadFeed on Home, loadTrustedUsers on Network, etc.)

## CSS Architecture

The main structural change is in `.app-shell`:
- Current: `grid-template-columns: 220px minmax(0, 1fr)`
- New: `grid-template-columns: 72px minmax(0, 1fr) 240px`

Container: `max-width: 1100px; margin: 0 auto;`

New elements:
- `.app-rail-right` — right sidebar container, `position: sticky; top: 1rem`
- `.sidebar-widget` — card styling for each right sidebar widget (`background: var(--bg-card)`)
- `.feed-tabs` — full-width tab bar for hop filters
- `.feed-sort-row` — secondary sort pill buttons (includes content-type filter icons after separator)
- `.inline-compose` — quick-compose component at top of feed
- `.compose-modal` — full-featured compose overlay (centered, max-width 600px, backdrop)

Modified elements:
- `.app-rail-left` — width reduced from 220px to 72px, content switches to icon-only
- `.app-header` — removed (display: none)
- `.tab-btn` — restyled as icon buttons (centered, 40x40, with `aria-label`)

## Responsive Breakpoints

| Breakpoint | Layout |
|-----------|--------|
| >1200px | Full 3-column: 72px / fluid / 240px |
| 769px–1200px | 2-column: 72px / fluid. Right sidebar hidden. Search bar moves inline above the hop tabs in the feed. Stats and Day Pass become a collapsible summary row at the top of the center column (click to expand). Feed Legend hidden at this breakpoint. |
| ≤768px | Single column with bottom tab bar (existing mobile layout) |

## What Is NOT Changing

- Post card design and rendering
- Trust graph logic and filtering
- Dark Social Graph architecture (client-side IndexedDB)
- All backend routes and APIs
- Mobile bottom tab bar behavior
- Network, DMs, Profile, Owner, Settings page internals
- Authentication and Day Pass flow
- Virtual scroller implementation
- Visitor/init-section onboarding flow structure
