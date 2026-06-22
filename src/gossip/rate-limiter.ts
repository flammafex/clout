/**
 * PeerRateLimiter - Rate limiting for P2P gossip messages
 *
 * Uses a sliding window rate limiter with temporary bans for abuse.
 * Protects against message flooding attacks.
 */

export interface RateLimiterConfig {
  /** Maximum messages per peer per window (default: 100) */
  readonly maxMessagesPerWindow?: number;
  /** Time window in milliseconds (default: 60000 = 1 minute) */
  readonly windowMs?: number;
  /** Ban duration in milliseconds when limit exceeded (default: 300000 = 5 minutes) */
  readonly banDurationMs?: number;
  /**
   * Maximum invalid messages per peer per window before ban (default: 10).
   * A circuit breaker: peers sending too much garbage (invalid signatures,
   * bad hashes, oversized content) get banned even if under the volume limit.
   */
  readonly maxInvalidPerWindow?: number;
}

/**
 * Per-peer rate limiting tracker
 */
interface PeerRateLimit {
  messageCount: number;
  windowStart: number;
  bannedUntil?: number;
  /** Count of invalid messages (failed validation) in current window */
  invalidCount: number;
}

export class PeerRateLimiter {
  private readonly maxMessages: number;
  private readonly windowMs: number;
  private readonly banDurationMs: number;
  private readonly maxInvalid: number;
  private readonly peerLimits = new Map<string, PeerRateLimit>();

  constructor(config: RateLimiterConfig = {}) {
    this.maxMessages = config.maxMessagesPerWindow ?? 100;
    this.windowMs = config.windowMs ?? 60_000; // 1 minute
    this.banDurationMs = config.banDurationMs ?? 300_000; // 5 minutes
    this.maxInvalid = config.maxInvalidPerWindow ?? 10;
  }

  /**
   * Check if a peer has exceeded rate limits
   *
   * Returns true if the message should be processed, false if rate limited.
   *
   * @param peerId - The peer's identifier
   * @returns true if within limits, false if rate limited
   */
  checkLimit(peerId: string): boolean {
    const now = Date.now();
    let peerLimit = this.peerLimits.get(peerId);

    // Initialize if first message from this peer
    if (!peerLimit) {
      peerLimit = { messageCount: 0, invalidCount: 0, windowStart: now };
      this.peerLimits.set(peerId, peerLimit);
    }

    // Check if currently banned
    if (peerLimit.bannedUntil && now < peerLimit.bannedUntil) {
      console.warn(
        `[RateLimiter] ⛔ Rate limited peer ${peerId.slice(0, 8)} ` +
        `(banned until ${new Date(peerLimit.bannedUntil).toISOString()})`
      );
      return false;
    }

    // Clear ban if expired
    if (peerLimit.bannedUntil && now >= peerLimit.bannedUntil) {
      peerLimit.bannedUntil = undefined;
      peerLimit.messageCount = 0;
      peerLimit.invalidCount = 0;
      peerLimit.windowStart = now;
    }

    // Reset window if expired
    if (now - peerLimit.windowStart >= this.windowMs) {
      peerLimit.messageCount = 0;
      peerLimit.invalidCount = 0;
      peerLimit.windowStart = now;
    }

    // Increment message count
    peerLimit.messageCount++;

    // Check if limit exceeded
    if (peerLimit.messageCount > this.maxMessages) {
      peerLimit.bannedUntil = now + this.banDurationMs;
      console.warn(
        `[RateLimiter] ⛔ Peer ${peerId.slice(0, 8)} exceeded rate limit ` +
        `(${peerLimit.messageCount}/${this.maxMessages} in ${this.windowMs}ms). ` +
        `Banned for ${this.banDurationMs}ms`
      );
      return false;
    }

    return true;
  }

  /**
   * Record an invalid message from a peer (circuit breaker).
   *
   * Called when a peer's message fails validation (invalid signature, bad hash,
   * oversized content, etc.). If the peer exceeds maxInvalid in a window, they
   * are banned for banDurationMs — even if under the volume rate limit.
   *
   * @param peerId - The peer's identifier
   * @returns true if the peer was just banned, false otherwise
   */
  recordInvalid(peerId: string): boolean {
    const now = Date.now();
    let peerLimit = this.peerLimits.get(peerId);

    if (!peerLimit) {
      peerLimit = { messageCount: 0, invalidCount: 0, windowStart: now };
      this.peerLimits.set(peerId, peerLimit);
    }

    // Reset window if expired
    if (now - peerLimit.windowStart >= this.windowMs) {
      peerLimit.invalidCount = 0;
      peerLimit.windowStart = now;
    }

    peerLimit.invalidCount++;

    if (peerLimit.invalidCount >= this.maxInvalid) {
      peerLimit.bannedUntil = now + this.banDurationMs;
      console.warn(
        `[RateLimiter] ⛔ Peer ${peerId.slice(0, 8)} tripped circuit breaker ` +
        `(${peerLimit.invalidCount} invalid messages in ${this.windowMs}ms). ` +
        `Banned for ${this.banDurationMs}ms`
      );
      return true;
    }

    return false;
  }

  /**
   * Check if a peer is currently rate-limited (banned)
   */
  isPeerBanned(peerId: string): boolean {
    const limit = this.peerLimits.get(peerId);
    if (!limit || !limit.bannedUntil) return false;
    return Date.now() < limit.bannedUntil;
  }

  /**
   * Manually unban a peer (for administrative use)
   */
  unbanPeer(peerId: string): void {
    const limit = this.peerLimits.get(peerId);
    if (limit) {
      limit.bannedUntil = undefined;
      limit.messageCount = 0;
      limit.windowStart = Date.now();
    }
  }

  /**
   * Cleanup stale rate limit entries
   * @returns Number of entries cleaned up
   */
  cleanup(): number {
    const now = Date.now();
    const cutoff = now - (this.windowMs * 2);
    let cleanedUp = 0;

    for (const [peerId, limit] of this.peerLimits.entries()) {
      const isStale = limit.windowStart < cutoff;
      const notBanned = !limit.bannedUntil || now >= limit.bannedUntil;
      if (isStale && notBanned) {
        this.peerLimits.delete(peerId);
        cleanedUp++;
      }
    }

    return cleanedUp;
  }

  /**
   * Get statistics about rate limiting
   */
  getStats(): { trackedPeers: number; bannedPeers: number } {
    const now = Date.now();
    let bannedPeers = 0;

    for (const limit of this.peerLimits.values()) {
      if (limit.bannedUntil && now < limit.bannedUntil) {
        bannedPeers++;
      }
    }

    return {
      trackedPeers: this.peerLimits.size,
      bannedPeers
    };
  }
}
