/**
 * BrowserUserData - Client-side storage for the Dark Social Graph
 *
 * ALL user data is stored locally in the browser's IndexedDB.
 * The server NEVER sees:
 * - Who you trust
 * - What nicknames you give people
 * - Who you've muted
 * - Your bookmarks
 * - Your tags/groups
 *
 * This keeps the social graph truly dark - only you can see your connections.
 */

const DB_NAME = 'clout-user-data';
const DB_VERSION = 3;

// Ghost timeout for pending trust requests (7 days in ms)
const TRUST_REQUEST_GHOST_TIMEOUT = 7 * 24 * 60 * 60 * 1000;

// Default reaction palette - 6 quick-access emojis
const DEFAULT_REACTION_PALETTE = ['👍', '❤️', '🔥', '😂', '😮', '🙏'];

/**
 * Open the IndexedDB database
 */
async function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Store for user profile and settings
      if (!db.objectStoreNames.contains('profile')) {
        db.createObjectStore('profile', { keyPath: 'publicKey' });
      }

      // Store for trust graph (who you trust)
      if (!db.objectStoreNames.contains('trust')) {
        const trustStore = db.createObjectStore('trust', { keyPath: 'trustedKey' });
        trustStore.createIndex('by_weight', 'weight');
      }

      // Store for nicknames
      if (!db.objectStoreNames.contains('nicknames')) {
        db.createObjectStore('nicknames', { keyPath: 'publicKey' });
      }

      // Store for tags (groups)
      if (!db.objectStoreNames.contains('tags')) {
        const tagStore = db.createObjectStore('tags', { keyPath: 'id', autoIncrement: true });
        tagStore.createIndex('by_tag', 'tag');
        tagStore.createIndex('by_publicKey', 'publicKey');
      }

      // Store for muted users
      if (!db.objectStoreNames.contains('muted')) {
        db.createObjectStore('muted', { keyPath: 'publicKey' });
      }

      // Store for bookmarks
      if (!db.objectStoreNames.contains('bookmarks')) {
        const bookmarkStore = db.createObjectStore('bookmarks', { keyPath: 'postId' });
        bookmarkStore.createIndex('by_timestamp', 'timestamp');
      }

      // Store for notification state
      if (!db.objectStoreNames.contains('notifications')) {
        db.createObjectStore('notifications', { keyPath: 'type' });
      }

      // Store for user preferences (reaction palette, etc.)
      if (!db.objectStoreNames.contains('preferences')) {
        db.createObjectStore('preferences', { keyPath: 'key' });
      }

      // Store for outgoing trust requests (requests I've sent)
      if (!db.objectStoreNames.contains('trust_requests_outgoing')) {
        const outgoingStore = db.createObjectStore('trust_requests_outgoing', { keyPath: 'id' });
        outgoingStore.createIndex('by_recipient', 'recipient');
        outgoingStore.createIndex('by_status', 'status');
        outgoingStore.createIndex('by_createdAt', 'createdAt');
      }

      // Store for incoming trust requests (requests I've received)
      if (!db.objectStoreNames.contains('trust_requests_incoming')) {
        const incomingStore = db.createObjectStore('trust_requests_incoming', { keyPath: 'id' });
        incomingStore.createIndex('by_requester', 'requester');
        incomingStore.createIndex('by_status', 'status');
        incomingStore.createIndex('by_createdAt', 'createdAt');
      }
    };
  });
}

/**
 * BrowserUserData - All user data stored locally
 */
export class BrowserUserData {
  constructor() {
    this.db = null;
  }

  /**
   * Initialize the database
   */
  async init() {
    this.db = await openDatabase();
    console.log('[BrowserUserData] Database initialized');
  }

  /**
   * Ensure database is open
   */
  async ensureDb() {
    if (!this.db) {
      await this.init();
    }
    return this.db;
  }

  // =========================================================================
  //  PROFILE
  // =========================================================================

  async getProfile(publicKey) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('profile', 'readonly');
      const store = tx.objectStore('profile');
      const request = store.get(publicKey);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async saveProfile(profile) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('profile', 'readwrite');
      const store = tx.objectStore('profile');
      const request = store.put({
        ...profile,
        lastUpdated: Date.now()
      });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // =========================================================================
  //  TRUST GRAPH (Dark Social Graph)
  // =========================================================================

  async getTrustGraph() {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('trust', 'readonly');
      const store = tx.objectStore('trust');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async trust(trustedKey, weight = 1.0) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('trust', 'readwrite');
      const store = tx.objectStore('trust');
      const request = store.put({
        trustedKey,
        weight: Math.max(0.1, Math.min(1.0, weight)),
        created: Date.now()
      });
      request.onsuccess = () => {
        console.log(`[BrowserUserData] Trusted ${trustedKey.slice(0, 12)}... (weight: ${weight})`);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async untrust(trustedKey) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('trust', 'readwrite');
      const store = tx.objectStore('trust');
      const request = store.delete(trustedKey);
      request.onsuccess = () => {
        console.log(`[BrowserUserData] Untrusted ${trustedKey.slice(0, 12)}...`);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async isTrusted(trustedKey) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('trust', 'readonly');
      const store = tx.objectStore('trust');
      const request = store.get(trustedKey);
      request.onsuccess = () => resolve(!!request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getTrustWeight(trustedKey) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('trust', 'readonly');
      const store = tx.objectStore('trust');
      const request = store.get(trustedKey);
      request.onsuccess = () => resolve(request.result?.weight ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get list of all trusted public keys
   */
  async getTrustedUsers() {
    const trustGraph = await this.getTrustGraph();
    return trustGraph.map(entry => entry.trustedKey);
  }

  /**
   * Get full trust data for a specific user
   */
  async getTrustData(trustedKey) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('trust', 'readonly');
      const store = tx.objectStore('trust');
      const request = store.get(trustedKey);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  // =========================================================================
  //  TRUST REQUESTS (Consent-based trust)
  // =========================================================================

  /**
   * Create an outgoing trust request
   * Includes requester's profile info so recipient knows who's asking
   */
  async createTrustRequest(recipient, weight = 1.0, message = null) {
    const db = await this.ensureDb();
    const now = Date.now();

    // Load identity properly via CloutIdentity module
    let requester = 'unknown';
    if (window.CloutIdentity) {
      const identity = await window.CloutIdentity.load();
      requester = identity?.publicKeyHex || 'unknown';
    }

    if (requester === 'unknown') {
      throw new Error('Cannot create trust request without a valid identity');
    }

    const id = `${requester}-${recipient}-${now}`;

    // Get requester's profile info to attach to the request
    const myProfile = await this.getProfile(requester);

    const request = {
      id,
      requester,
      requesterDisplayName: myProfile?.displayName || null,
      requesterAvatar: myProfile?.avatar || null,
      recipient,
      weight: Math.max(0.1, Math.min(1.0, weight)),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      retryCount: 0,
      message
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction('trust_requests_outgoing', 'readwrite');
      const store = tx.objectStore('trust_requests_outgoing');
      const putReq = store.put(request);
      putReq.onsuccess = () => {
        console.log(`[BrowserUserData] Created trust request to ${recipient.slice(0, 12)}...`);
        resolve(request);
      };
      putReq.onerror = () => reject(putReq.error);
    });
  }

  /**
   * Store an incoming trust request
   */
  async storeIncomingTrustRequest(requestData) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('trust_requests_incoming', 'readwrite');
      const store = tx.objectStore('trust_requests_incoming');
      const request = store.put({
        ...requestData,
        receivedAt: Date.now()
      });
      request.onsuccess = () => {
        console.log(`[BrowserUserData] Stored incoming request from ${requestData.requester.slice(0, 12)}...`);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all outgoing trust requests
   * Automatically updates status to 'ghosted' for requests older than 7 days
   */
  async getOutgoingTrustRequests() {
    const db = await this.ensureDb();
    const now = Date.now();

    return new Promise((resolve, reject) => {
      const tx = db.transaction('trust_requests_outgoing', 'readwrite');
      const store = tx.objectStore('trust_requests_outgoing');
      const request = store.getAll();

      request.onsuccess = () => {
        const requests = request.result || [];
        const updated = [];

        for (const req of requests) {
          // Auto-ghost after 7 days if still pending
          if (req.status === 'pending' && (now - req.createdAt) > TRUST_REQUEST_GHOST_TIMEOUT) {
            req.status = 'ghosted';
            req.updatedAt = now;
            store.put(req);
          }
          updated.push(req);
        }

        resolve(updated);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all incoming trust requests (pending only by default)
   */
  async getIncomingTrustRequests(includeAll = false) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('trust_requests_incoming', 'readonly');
      const store = tx.objectStore('trust_requests_incoming');
      const request = store.getAll();

      request.onsuccess = () => {
        let requests = request.result || [];
        if (!includeAll) {
          requests = requests.filter(r => r.status === 'pending');
        }
        resolve(requests);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get pending incoming request count (for badge)
   */
  async getPendingIncomingCount() {
    const requests = await this.getIncomingTrustRequests(false);
    return requests.length;
  }

  /**
   * Get pending outgoing count (for enforcing limit)
   */
  async getPendingOutgoingCount() {
    const requests = await this.getOutgoingTrustRequests();
    return requests.filter(r => r.status === 'pending' || r.status === 'ghosted').length;
  }

  /**
   * Check if a request to this recipient already exists
   */
  async hasOutgoingRequestTo(recipient) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('trust_requests_outgoing', 'readonly');
      const store = tx.objectStore('trust_requests_outgoing');
      const index = store.index('by_recipient');
      const request = index.getAll(IDBKeyRange.only(recipient));

      request.onsuccess = () => {
        const existing = (request.result || []).find(r =>
          r.status === 'pending' || r.status === 'ghosted'
        );
        resolve(existing || null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Check if we've been rejected by this recipient (blocks re-request for 30 days)
   */
  async isBlockedFromRequesting(recipient) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('trust_requests_outgoing', 'readonly');
      const store = tx.objectStore('trust_requests_outgoing');
      const index = store.index('by_recipient');
      const request = index.getAll(IDBKeyRange.only(recipient));

      request.onsuccess = () => {
        const rejected = (request.result || []).find(r => r.status === 'rejected');
        if (!rejected) {
          resolve(false);
          return;
        }
        // Check if 30-day block period has passed
        const thirtyDays = 30 * 24 * 60 * 60 * 1000;
        const blockedUntil = rejected.updatedAt + thirtyDays;
        resolve(Date.now() < blockedUntil);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Accept an incoming trust request
   */
  async acceptTrustRequest(requestId) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('trust_requests_incoming', 'readwrite');
      const store = tx.objectStore('trust_requests_incoming');
      const getReq = store.get(requestId);

      getReq.onsuccess = () => {
        const request = getReq.result;
        if (!request) {
          reject(new Error('Request not found'));
          return;
        }

        request.status = 'accepted';
        request.updatedAt = Date.now();
        const putReq = store.put(request);

        putReq.onsuccess = () => {
          console.log(`[BrowserUserData] Accepted trust request ${requestId}`);
          resolve(request);
        };
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  /**
   * Reject an incoming trust request (silently - requester sees it as pending/ghosted)
   */
  async rejectTrustRequest(requestId) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('trust_requests_incoming', 'readwrite');
      const store = tx.objectStore('trust_requests_incoming');
      const getReq = store.get(requestId);

      getReq.onsuccess = () => {
        const request = getReq.result;
        if (!request) {
          reject(new Error('Request not found'));
          return;
        }

        request.status = 'rejected';
        request.updatedAt = Date.now();
        const putReq = store.put(request);

        putReq.onsuccess = () => {
          console.log(`[BrowserUserData] Rejected trust request ${requestId}`);
          resolve(request);
        };
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  /**
   * Withdraw an outgoing trust request
   */
  async withdrawTrustRequest(requestId) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('trust_requests_outgoing', 'readwrite');
      const store = tx.objectStore('trust_requests_outgoing');
      const request = store.delete(requestId);
      request.onsuccess = () => {
        console.log(`[BrowserUserData] Withdrew trust request ${requestId}`);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Update outgoing request status (called when we get a response)
   */
  async updateOutgoingRequestStatus(recipient, status) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('trust_requests_outgoing', 'readwrite');
      const store = tx.objectStore('trust_requests_outgoing');
      const index = store.index('by_recipient');
      const request = index.getAll(IDBKeyRange.only(recipient));

      request.onsuccess = () => {
        const existing = (request.result || []).find(r =>
          r.status === 'pending' || r.status === 'ghosted'
        );
        if (existing) {
          existing.status = status;
          existing.updatedAt = Date.now();
          store.put(existing);
        }
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Retry a ghosted request (allowed once)
   */
  async retryTrustRequest(requestId) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('trust_requests_outgoing', 'readwrite');
      const store = tx.objectStore('trust_requests_outgoing');
      const getReq = store.get(requestId);

      getReq.onsuccess = () => {
        const request = getReq.result;
        if (!request) {
          reject(new Error('Request not found'));
          return;
        }
        if (request.status !== 'ghosted') {
          reject(new Error('Can only retry ghosted requests'));
          return;
        }
        if (request.retryCount >= 1) {
          reject(new Error('Maximum retries exceeded'));
          return;
        }

        request.status = 'pending';
        request.createdAt = Date.now(); // Reset the clock
        request.updatedAt = Date.now();
        request.retryCount += 1;
        const putReq = store.put(request);

        putReq.onsuccess = () => {
          console.log(`[BrowserUserData] Retried trust request ${requestId}`);
          resolve(request);
        };
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  // =========================================================================
  //  NICKNAMES
  // =========================================================================

  async getNickname(publicKey) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('nicknames', 'readonly');
      const store = tx.objectStore('nicknames');
      const request = store.get(publicKey);
      request.onsuccess = () => resolve(request.result?.nickname || null);
      request.onerror = () => reject(request.error);
    });
  }

  async setNickname(publicKey, nickname) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('nicknames', 'readwrite');
      const store = tx.objectStore('nicknames');

      if (nickname && nickname.trim()) {
        const request = store.put({
          publicKey,
          nickname: nickname.trim(),
          updated: Date.now()
        });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      } else {
        const request = store.delete(publicKey);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }
    });
  }

  async getAllNicknames() {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('nicknames', 'readonly');
      const store = tx.objectStore('nicknames');
      const request = store.getAll();
      request.onsuccess = () => {
        const nicknames = new Map();
        for (const item of request.result || []) {
          nicknames.set(item.publicKey, item.nickname);
        }
        resolve(nicknames);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getDisplayName(publicKey) {
    const nickname = await this.getNickname(publicKey);
    return nickname || publicKey.slice(0, 12) + '...';
  }

  // =========================================================================
  //  TAGS (Groups)
  // =========================================================================

  async addTag(publicKey, tag) {
    const db = await this.ensureDb();
    const normalizedTag = tag.toLowerCase().trim();

    // Check if tag already exists
    const existing = await this.getTagsForUser(publicKey);
    if (existing.includes(normalizedTag)) {
      return;
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction('tags', 'readwrite');
      const store = tx.objectStore('tags');
      const request = store.add({
        publicKey,
        tag: normalizedTag,
        created: Date.now()
      });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async removeTag(publicKey, tag) {
    const db = await this.ensureDb();
    const normalizedTag = tag.toLowerCase().trim();

    return new Promise((resolve, reject) => {
      const tx = db.transaction('tags', 'readwrite');
      const store = tx.objectStore('tags');
      const index = store.index('by_publicKey');
      const request = index.openCursor(IDBKeyRange.only(publicKey));

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          if (cursor.value.tag === normalizedTag) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getTagsForUser(publicKey) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('tags', 'readonly');
      const store = tx.objectStore('tags');
      const index = store.index('by_publicKey');
      const request = index.getAll(IDBKeyRange.only(publicKey));
      request.onsuccess = () => {
        const tags = (request.result || []).map(item => item.tag);
        resolve(tags);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getUsersByTag(tag) {
    const db = await this.ensureDb();
    const normalizedTag = tag.toLowerCase().trim();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('tags', 'readonly');
      const store = tx.objectStore('tags');
      const index = store.index('by_tag');
      const request = index.getAll(IDBKeyRange.only(normalizedTag));
      request.onsuccess = () => {
        const users = (request.result || []).map(item => item.publicKey);
        resolve(users);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getAllTags() {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('tags', 'readonly');
      const store = tx.objectStore('tags');
      const request = store.getAll();
      request.onsuccess = () => {
        const tagCounts = new Map();
        for (const item of request.result || []) {
          const count = tagCounts.get(item.tag) || 0;
          tagCounts.set(item.tag, count + 1);
        }
        resolve(tagCounts);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // =========================================================================
  //  MUTED USERS
  // =========================================================================

  async mute(publicKey) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('muted', 'readwrite');
      const store = tx.objectStore('muted');
      const request = store.put({
        publicKey,
        mutedAt: Date.now()
      });
      request.onsuccess = () => {
        console.log(`[BrowserUserData] Muted ${publicKey.slice(0, 12)}...`);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async unmute(publicKey) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('muted', 'readwrite');
      const store = tx.objectStore('muted');
      const request = store.delete(publicKey);
      request.onsuccess = () => {
        console.log(`[BrowserUserData] Unmuted ${publicKey.slice(0, 12)}...`);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async isMuted(publicKey) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('muted', 'readonly');
      const store = tx.objectStore('muted');
      const request = store.get(publicKey);
      request.onsuccess = () => resolve(!!request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getMutedUsers() {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('muted', 'readonly');
      const store = tx.objectStore('muted');
      const request = store.getAll();
      request.onsuccess = () => {
        const muted = (request.result || []).map(item => item.publicKey);
        resolve(muted);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // =========================================================================
  //  BOOKMARKS
  // =========================================================================

  async bookmark(postId) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('bookmarks', 'readwrite');
      const store = tx.objectStore('bookmarks');
      const request = store.put({
        postId,
        timestamp: Date.now()
      });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async unbookmark(postId) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('bookmarks', 'readwrite');
      const store = tx.objectStore('bookmarks');
      const request = store.delete(postId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async isBookmarked(postId) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('bookmarks', 'readonly');
      const store = tx.objectStore('bookmarks');
      const request = store.get(postId);
      request.onsuccess = () => resolve(!!request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getBookmarks() {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('bookmarks', 'readonly');
      const store = tx.objectStore('bookmarks');
      const index = store.index('by_timestamp');
      const request = index.getAll();
      request.onsuccess = () => {
        const bookmarks = (request.result || []).map(item => item.postId);
        resolve(bookmarks.reverse()); // Most recent first
      };
      request.onerror = () => reject(request.error);
    });
  }

  // =========================================================================
  //  NOTIFICATIONS
  // =========================================================================

  async getNotificationState() {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('notifications', 'readonly');
      const store = tx.objectStore('notifications');
      const request = store.getAll();
      request.onsuccess = () => {
        const state = {
          lastSeenSlides: 0,
          lastSeenReplies: 0,
          lastSeenMentions: 0
        };
        for (const item of request.result || []) {
          if (item.type === 'slides') state.lastSeenSlides = item.timestamp;
          if (item.type === 'replies') state.lastSeenReplies = item.timestamp;
          if (item.type === 'mentions') state.lastSeenMentions = item.timestamp;
        }
        resolve(state);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async markSeen(type) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('notifications', 'readwrite');
      const store = tx.objectStore('notifications');
      const request = store.put({
        type,
        timestamp: Date.now()
      });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // =========================================================================
  //  PREFERENCES (Reaction Palette, etc.)
  // =========================================================================

  async getReactionPalette() {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('preferences', 'readonly');
      const store = tx.objectStore('preferences');
      const request = store.get('reactionPalette');
      request.onsuccess = () => {
        const result = request.result?.value;
        resolve(result && result.length > 0 ? result : DEFAULT_REACTION_PALETTE);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async setReactionPalette(emojis) {
    if (!Array.isArray(emojis) || emojis.length === 0) {
      throw new Error('Reaction palette must be a non-empty array of emojis');
    }
    // Limit to 6 emojis
    const palette = emojis.slice(0, 6);

    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('preferences', 'readwrite');
      const store = tx.objectStore('preferences');
      const request = store.put({
        key: 'reactionPalette',
        value: palette,
        updated: Date.now()
      });
      request.onsuccess = () => {
        console.log('[BrowserUserData] Reaction palette updated:', palette);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getPreference(key, defaultValue = null) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('preferences', 'readonly');
      const store = tx.objectStore('preferences');
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result?.value ?? defaultValue);
      request.onerror = () => reject(request.error);
    });
  }

  async setPreference(key, value) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('preferences', 'readwrite');
      const store = tx.objectStore('preferences');
      const request = store.put({
        key,
        value,
        updated: Date.now()
      });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // =========================================================================
  //  EXPORT / IMPORT (for backup)
  // =========================================================================

  async exportAll() {
    // Load identity properly via CloutIdentity module
    let publicKeyHex = null;
    if (window.CloutIdentity) {
      const identity = await window.CloutIdentity.load();
      publicKeyHex = identity?.publicKeyHex || null;
    }

    const [
      profile,
      trustGraph,
      nicknames,
      tags,
      muted,
      bookmarks,
      notifications,
      reactionPalette
    ] = await Promise.all([
      publicKeyHex ? this.getProfile(publicKeyHex) : Promise.resolve(null),
      this.getTrustGraph(),
      this.getAllNicknames(),
      this.getAllTagsWithUsers(),
      this.getMutedUsers(),
      this.getBookmarks(),
      this.getNotificationState(),
      this.getReactionPalette()
    ]);

    return {
      version: '1.1',
      exportedAt: Date.now(),
      profile,
      trustGraph,
      nicknames: Object.fromEntries(nicknames),
      tags,
      muted,
      bookmarks,
      notifications,
      reactionPalette
    };
  }

  async getAllTagsWithUsers() {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('tags', 'readonly');
      const store = tx.objectStore('tags');
      const request = store.getAll();
      request.onsuccess = () => {
        const tagMap = {};
        for (const item of request.result || []) {
          if (!tagMap[item.tag]) {
            tagMap[item.tag] = [];
          }
          tagMap[item.tag].push(item.publicKey);
        }
        resolve(tagMap);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async importAll(data) {
    if (!data || !data.version) {
      throw new Error('Invalid backup data');
    }

    // Import profile
    if (data.profile) {
      await this.saveProfile(data.profile);
    }

    // Import trust graph
    if (data.trustGraph && Array.isArray(data.trustGraph)) {
      for (const entry of data.trustGraph) {
        await this.trust(entry.trustedKey, entry.weight);
      }
    }

    // Import nicknames
    if (data.nicknames) {
      for (const [publicKey, nickname] of Object.entries(data.nicknames)) {
        await this.setNickname(publicKey, nickname);
      }
    }

    // Import tags
    if (data.tags) {
      for (const [tag, users] of Object.entries(data.tags)) {
        for (const publicKey of users) {
          await this.addTag(publicKey, tag);
        }
      }
    }

    // Import muted
    if (data.muted && Array.isArray(data.muted)) {
      for (const publicKey of data.muted) {
        await this.mute(publicKey);
      }
    }

    // Import bookmarks
    if (data.bookmarks && Array.isArray(data.bookmarks)) {
      for (const postId of data.bookmarks) {
        await this.bookmark(postId);
      }
    }

    // Import reaction palette
    if (data.reactionPalette && Array.isArray(data.reactionPalette)) {
      await this.setReactionPalette(data.reactionPalette);
    }

    console.log('[BrowserUserData] Import complete');
  }

  // =========================================================================
  //  CLEAR ALL DATA
  // =========================================================================

  async clearAll() {
    const db = await this.ensureDb();
    const stores = ['profile', 'trust', 'nicknames', 'tags', 'muted', 'bookmarks', 'notifications', 'preferences', 'trust_requests_outgoing', 'trust_requests_incoming'];

    for (const storeName of stores) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }

    console.log('[BrowserUserData] All data cleared');
  }
}

// Create singleton instance
const userData = new BrowserUserData();

// Export for use
export default userData;
