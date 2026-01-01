/**
 * Web API Authentication
 *
 * Token-based authentication for protecting API endpoints.
 * Uses a cryptographically secure session token generated at login.
 */

import { Request, Response, NextFunction } from 'express';
import { randomBytes, timingSafeEqual } from 'crypto';

/**
 * Session token store
 * Maps token hash to expiry timestamp
 */
interface Session {
  tokenHash: Uint8Array;
  expiresAt: number;
  createdAt: number;
}

/**
 * Authentication configuration
 */
export interface AuthConfig {
  /** Session duration in milliseconds (default: 24 hours) */
  sessionDurationMs?: number;
  /** Maximum concurrent sessions (default: 5) */
  maxSessions?: number;
  /** Whether auth is required (default: true in production, false in dev) */
  requireAuth?: boolean;
}

/**
 * Auth manager for web API
 */
export class AuthManager {
  private sessions = new Map<string, Session>();
  private readonly sessionDurationMs: number;
  private readonly maxSessions: number;
  private readonly requireAuth: boolean;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(config: AuthConfig = {}) {
    this.sessionDurationMs = config.sessionDurationMs ?? 24 * 60 * 60 * 1000; // 24 hours
    this.maxSessions = config.maxSessions ?? 5;
    this.requireAuth = config.requireAuth ?? false; // Disabled by default for local-first use

    // Cleanup expired sessions every 5 minutes
    this.cleanupTimer = setInterval(() => this.cleanupExpiredSessions(), 5 * 60 * 1000);
  }

  /**
   * Generate a new session token
   *
   * @returns The session token (32 bytes, hex encoded = 64 chars)
   */
  createSession(): string {
    // Generate cryptographically secure random token
    const tokenBytes = randomBytes(32);
    const token = tokenBytes.toString('hex');

    // Store hash of token (don't store plaintext token)
    const tokenHash = this.hashToken(token);

    const session: Session = {
      tokenHash,
      expiresAt: Date.now() + this.sessionDurationMs,
      createdAt: Date.now()
    };

    // Enforce max sessions (remove oldest if exceeded)
    if (this.sessions.size >= this.maxSessions) {
      this.removeOldestSession();
    }

    // Store session
    const sessionId = randomBytes(16).toString('hex');
    this.sessions.set(sessionId, session);

    console.log(`[Auth] Created new session (${this.sessions.size}/${this.maxSessions} active)`);

    return token;
  }

  /**
   * Verify a session token
   *
   * @param token - The token to verify
   * @returns true if valid, false otherwise
   */
  verifyToken(token: string): boolean {
    if (!token) return false;

    const tokenHash = this.hashToken(token);
    const now = Date.now();

    for (const [sessionId, session] of this.sessions.entries()) {
      // Check expiry
      if (session.expiresAt < now) {
        this.sessions.delete(sessionId);
        continue;
      }

      // Timing-safe comparison
      if (session.tokenHash.length === tokenHash.length) {
        if (timingSafeEqual(session.tokenHash, tokenHash)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Invalidate a session token
   */
  revokeToken(token: string): void {
    const tokenHash = this.hashToken(token);

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.tokenHash.length === tokenHash.length) {
        if (timingSafeEqual(session.tokenHash, tokenHash)) {
          this.sessions.delete(sessionId);
          console.log(`[Auth] Session revoked (${this.sessions.size} active)`);
          return;
        }
      }
    }
  }

  /**
   * Revoke all sessions
   */
  revokeAllSessions(): void {
    const count = this.sessions.size;
    this.sessions.clear();
    console.log(`[Auth] All ${count} sessions revoked`);
  }

  /**
   * Check if authentication is required
   */
  isAuthRequired(): boolean {
    return this.requireAuth;
  }

  /**
   * Get active session count
   */
  getActiveSessionCount(): number {
    this.cleanupExpiredSessions();
    return this.sessions.size;
  }

  /**
   * Create Express middleware for authentication
   */
  createMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, res: Response, next: NextFunction) => {
      // Skip auth if not required
      if (!this.requireAuth) {
        return next();
      }

      // Extract token from header or query
      const authHeader = req.headers.authorization;
      let token: string | undefined;

      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      } else if (typeof req.query.token === 'string') {
        token = req.query.token;
      }

      if (!token) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required. Use Authorization: Bearer <token> header.'
        });
      }

      if (!this.verifyToken(token)) {
        return res.status(401).json({
          success: false,
          error: 'Invalid or expired authentication token.'
        });
      }

      next();
    };
  }

  /**
   * Hash a token using simple hash (not for password storage, just for lookup)
   */
  private hashToken(token: string): Uint8Array {
    const { createHash } = require('crypto');
    return createHash('sha256').update(token).digest();
  }

  /**
   * Remove the oldest session
   */
  private removeOldestSession(): void {
    let oldestId: string | null = null;
    let oldestTime = Infinity;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.createdAt < oldestTime) {
        oldestTime = session.createdAt;
        oldestId = sessionId;
      }
    }

    if (oldestId) {
      this.sessions.delete(oldestId);
      console.log(`[Auth] Removed oldest session to make room for new one`);
    }
  }

  /**
   * Clean up expired sessions
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    let removed = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt < now) {
        this.sessions.delete(sessionId);
        removed++;
      }
    }

    if (removed > 0) {
      console.log(`[Auth] Cleaned up ${removed} expired sessions`);
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.sessions.clear();
  }
}

/**
 * Public routes that don't require authentication
 * These routes are accessible to visitors without an identity
 */
export const PUBLIC_ROUTES = [
  '/api/health',
  '/api/auth/login',
  '/api/auth/status',
  '/api/feed',           // Visitors can view the public feed
  '/api/thread',         // Visitors can view threads
  '/api/reactions/emojis', // Visitors can see available reactions
  '/api/freebird',       // Browser VOPRF proxy (new users need tokens)
  '/api/daypass'         // Day Pass status/minting (new users need this)
  // Note: /api/freebird/federation/* is covered by /api/freebird prefix
  // Federation endpoints allow cross-community token exchange
];

/**
 * Check if a route is public (doesn't require auth)
 */
export function isPublicRoute(path: string): boolean {
  return PUBLIC_ROUTES.some(route => path === route || path.startsWith(route + '/'));
}
