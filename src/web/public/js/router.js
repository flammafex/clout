/**
 * Router Module - Hash-based URL routing for the Clout PWA
 *
 * Pure vanilla JS, no framework. Enables deep links and back-button
 * support by mapping window.location.hash to tab switches + loaders.
 *
 * Routes:
 *   #/feed                 → feed tab
 *   #/compose              → post tab (compose)
 *   #/trust                → trust tab
 *   #/slides               → slides tab
 *   #/thread/:postId       → thread tab, load specific post
 *   #/profile              → profile tab (current user)
 *   #/profile/:publicKey   → profile tab, view specific user
 *   #/settings             → settings tab
 *   #/owner                → owner tab
 *   #/tag/:tag             → feed tab, filter by tag
 */

import { switchToTab } from './ui.js';

// Tabs that correspond to a real tab-content panel. 'compose' maps to
// the 'post' tab internally; 'tag' reuses the feed tab.
const VALID_TABS = new Set([
  'feed', 'compose', 'trust', 'slides',
  'thread', 'profile', 'settings', 'owner', 'tag'
]);

// Registered loaders: tab name -> function(paramsArray)
const loaders = new Map();

let initialized = false;
// Re-entrancy guard: prevents a loader/navigate from recursing into the
// route handler while a route is already being dispatched.
let dispatching = false;

/**
 * Parse a location hash into a route object.
 *
 * @param {string} hash - e.g. '#/thread/abc123'
 * @returns {{ tab: string, params: string[] }}
 */
export function parseHash(hash) {
  let clean = hash || '';
  if (clean.startsWith('#')) clean = clean.slice(1);
  if (clean.startsWith('/')) clean = clean.slice(1);
  if (!clean) return { tab: 'feed', params: [] };
  const parts = clean.split('/').filter(p => p.length > 0);
  return { tab: parts[0] || 'feed', params: parts.slice(1) };
}

/**
 * Register a loader function for a tab. The loader receives the route
 * params array (e.g. ['abc123'] for #/thread/abc123).
 *
 * @param {string} tab
 * @param {function(string[]): void} fn
 */
export function registerLoader(tab, fn) {
  loaders.set(tab, fn);
}

/**
 * Navigate to a hash route. Sets window.location.hash (which fires
 * hashchange). If the hash is already set, the handler is invoked
 * directly so the route still reloads (e.g. re-clicking the active tab).
 *
 * @param {string} hash - e.g. '#/feed' or '/feed'
 */
export function navigate(hash) {
  if (!hash) return;
  if (!hash.startsWith('#')) hash = '#' + hash;
  if (window.location.hash === hash) {
    handleRoute();
  } else {
    window.location.hash = hash;
  }
}

/**
 * Get the route object for the current hash.
 *
 * @returns {{ tab: string, params: string[] }}
 */
export function getRoute() {
  return parseHash(window.location.hash);
}

/**
 * Core route handler. Called on hashchange and on demand from navigate().
 * Calls switchToTab(tab) and the registered loader with params.
 */
function handleRoute() {
  if (dispatching) return;
  dispatching = true;
  try {
    const { tab, params } = parseHash(window.location.hash);

    if (!VALID_TABS.has(tab)) {
      // Unknown / invalid route → redirect to feed
      if (window.location.hash !== '#/feed') {
        window.location.hash = '#/feed';
      } else {
        switchToTab('feed');
        const loader = loaders.get('feed');
        if (typeof loader === 'function') loader([]);
      }
      return;
    }

    // 'compose' route uses the 'post' tab panel
    const tabId = tab === 'compose' ? 'post' : tab;
    // 'tag' route reuses the feed tab panel
    const panelId = tab === 'tag' ? 'feed' : tabId;

    // Show/hide the thread nav button (hidden unless viewing a thread)
    const threadBtn = document.querySelector('.tab-btn[data-tab="thread"]');
    if (threadBtn) threadBtn.style.display = (tab === 'thread') ? 'block' : 'none';

    switchToTab(panelId);

    const loader = loaders.get(tab);
    if (typeof loader === 'function') {
      try {
        loader(params);
      } catch (e) {
        console.error('[Router] Loader error for', tab, e);
      }
    }
  } finally {
    dispatching = false;
  }
}

/**
 * Initialize the router. Wires the hashchange listener and triggers the
 * initial route. Must be called AFTER all loaders are registered.
 *
 * On initial load:
 *   - if no hash is present, default to #/feed
 *   - if a deep link is present, dispatch it immediately
 */
export function init() {
  if (initialized) return;
  initialized = true;
  window.addEventListener('hashchange', handleRoute);

  if (!window.location.hash || window.location.hash === '#' || window.location.hash === '#/') {
    // No deep link — default to feed. Setting the hash fires hashchange
    // asynchronously, which dispatches the feed loader.
    window.location.hash = '#/feed';
  } else {
    // Deep link present — dispatch it now.
    handleRoute();
  }
}
