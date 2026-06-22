/**
 * Middleware setup for the Clout web server.
 *
 * Extracted from CloutWebServer as part of Tier 3 Phase 8.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { isPublicRoute } from './auth.js';
import type { AuthManager } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface MiddlewareConfig {
  readonly authManager: AuthManager;
}

/**
 * Install all Express middleware: security headers, CORS, rate limiters,
 * body parsers, static file serving, auth middleware, and error handler.
 */
export function setupMiddleware(app: express.Application, config: MiddlewareConfig): void {
  // Trust proxy - required when running behind nginx/reverse proxy
  if (process.env.TRUST_PROXY === 'true' || process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  // Security headers - protect against common attacks
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  // CORS - restrict to allowed origins
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (process.env.NODE_ENV !== 'production') {
        if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
          return callback(null, true);
        }
      }
      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error('CORS not allowed'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  }));

  // Rate limiting - protect against brute force and DoS
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, error: 'Too many attempts, please try again later' },
    standardHeaders: true,
    legacyHeaders: false
  });
  const postLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { success: false, error: 'Too many posts, please slow down' },
    standardHeaders: true,
    legacyHeaders: false
  });
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: { success: false, error: 'Too many requests, please slow down' },
    standardHeaders: true,
    legacyHeaders: false
  });
  const mediaUploadLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5, // Media uploads are large, so limit them more strictly
    message: { success: false, error: 'Too many uploads, please slow down' },
    standardHeaders: true,
    legacyHeaders: false
  });

  // Apply rate limiters to specific paths
  app.use('/api/auth/', authLimiter);
  app.use('/api/invitation/', authLimiter);
  app.use('/api/post/', postLimiter);
  app.use('/api/media/upload', mediaUploadLimiter);
  app.use('/api/', apiLimiter);

  app.use(express.json());
  // Support raw binary uploads for media (up to 100MB)
  app.use('/api/media/upload', express.raw({
    type: ['image/*', 'video/*', 'audio/*', 'application/pdf'],
    limit: '100mb'
  }));
  app.use(express.static(join(__dirname, 'public')));

  // Authentication middleware - skip public routes
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const fullPath = '/api' + req.path;
    if (isPublicRoute(fullPath)) {
      return next();
    }
    return config.authManager.createMiddleware()(req, res, next);
  });

  // Error handler - don't expose internal details in production
  app.use((err: Error, _req: Request, res: Response, _next: any) => {
    console.error('Error:', err);
    const message = process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message;
    res.status(500).json({ success: false, error: message });
  });
}
