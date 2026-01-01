/**
 * Clout Service Worker
 *
 * Handles:
 * - Static asset caching for offline shell
 * - Network-first API requests with cache fallback
 * - Background sync queue for offline actions (future)
 */

const CACHE_VERSION = 'v2';
const STATIC_CACHE = `clout-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `clout-dynamic-${CACHE_VERSION}`;

// Static assets to cache on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/clout.webp',
  '/js/app.js',
  '/js/api.js',
  '/js/feed.js',
  '/js/invite.js',
  '/js/notifications.js',
  '/js/posts.js',
  '/js/profile.js',
  '/js/reactions.js',
  '/js/slides.js',
  '/js/state.js',
  '/js/thread.js',
  '/js/trust.js',
  '/js/ui.js',
  '/clout-modules.js',
  '/crypto-browser.js',
  '/identity-browser.js',
  '/user-data-browser.js',
  '/daypass-browser.js',
  '/voprf-browser.js',
  '/manifest.json'
];

// API routes that should use network-first strategy
const API_ROUTES = ['/api/'];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');

  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Caching static assets...');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('[SW] Static assets cached');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] Failed to cache static assets:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name.startsWith('clout-') && name !== STATIC_CACHE && name !== DYNAMIC_CACHE)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Service worker activated');
        return self.clients.claim();
      })
  );
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip external requests (CDN libraries, etc.)
  if (url.origin !== self.location.origin) {
    return;
  }

  // API requests - network first, cache fallback
  if (API_ROUTES.some(route => url.pathname.startsWith(route))) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Static assets - cache first, network fallback
  event.respondWith(cacheFirst(request));
});

/**
 * Cache-first strategy
 * Try cache, fall back to network, update cache
 */
async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);

  if (cachedResponse) {
    // Return cached version immediately
    // Optionally update cache in background
    updateCache(request);
    return cachedResponse;
  }

  // Not in cache, fetch from network
  try {
    const networkResponse = await fetch(request);

    // Cache the response for future
    if (networkResponse.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    // Network failed and not in cache - return offline page
    console.log('[SW] Network failed, returning offline fallback');
    return caches.match('/') || new Response('Offline', { status: 503 });
  }
}

/**
 * Network-first strategy
 * Try network, fall back to cache
 */
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);

    // Cache successful API responses
    if (networkResponse.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    // Network failed, try cache
    console.log('[SW] Network failed, trying cache for:', request.url);
    const cachedResponse = await caches.match(request);

    if (cachedResponse) {
      return cachedResponse;
    }

    // Return error response for API
    return new Response(
      JSON.stringify({ success: false, error: 'You are offline' }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

/**
 * Update cache in background (stale-while-revalidate pattern)
 */
async function updateCache(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse);
    }
  } catch (error) {
    // Silent fail - we already served from cache
  }
}

// Listen for messages from the main app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then((cacheNames) => {
      cacheNames.forEach((name) => caches.delete(name));
    });
  }
});

// Background sync for offline actions (future enhancement)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-posts') {
    console.log('[SW] Background sync triggered for posts');
    // event.waitUntil(syncOfflinePosts());
  }

  if (event.tag === 'sync-trust') {
    console.log('[SW] Background sync triggered for trust');
    // event.waitUntil(syncOfflineTrust());
  }
});
