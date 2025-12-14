/**
 * OpenGraph Routes - Fetch and parse OpenGraph metadata from URLs
 *
 * Provides a server-side proxy for fetching OG metadata since browsers
 * cannot make cross-origin requests to arbitrary URLs.
 */

import { Router } from 'express';
import type { OpenGraphMetadata } from '../../clout-types.js';

// Timeout for fetching URLs (5 seconds)
const FETCH_TIMEOUT_MS = 5000;

// Maximum response size to parse (1MB)
const MAX_RESPONSE_SIZE = 1024 * 1024;

// Blocklist of private/internal IP ranges
const BLOCKED_HOSTS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^0\./,
  /^169\.254\./,
  /^\[::1\]$/,
  /^\[fe80:/i,
  /^\[fc00:/i,
  /^\[fd00:/i,
];

/**
 * Check if a hostname is blocked (private/internal)
 */
function isBlockedHost(hostname: string): boolean {
  return BLOCKED_HOSTS.some(pattern => pattern.test(hostname));
}

/**
 * Validate and sanitize a URL
 */
function validateUrl(urlString: string): URL | null {
  try {
    const url = new URL(urlString);

    // Only allow http/https
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    // Block internal/private hosts
    if (isBlockedHost(url.hostname)) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

/**
 * Raw OpenGraph data (mutable) before converting to readonly interface
 */
interface RawOpenGraphData {
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
  type?: string;
}

/**
 * Extract OpenGraph metadata from HTML
 */
function extractOpenGraphMetadata(html: string, url: string): RawOpenGraphData {
  const result: RawOpenGraphData = { url };

  // Helper to extract content from meta tags
  const getMetaContent = (property: string): string | undefined => {
    // Try og: property first
    const ogMatch = html.match(new RegExp(`<meta[^>]+property=["']og:${property}["'][^>]+content=["']([^"']+)["']`, 'i'))
      || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${property}["']`, 'i'));
    if (ogMatch) return decodeHtmlEntities(ogMatch[1]);

    // Try twitter: property
    const twitterMatch = html.match(new RegExp(`<meta[^>]+name=["']twitter:${property}["'][^>]+content=["']([^"']+)["']`, 'i'))
      || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:${property}["']`, 'i'));
    if (twitterMatch) return decodeHtmlEntities(twitterMatch[1]);

    return undefined;
  };

  // Extract og:title or fallback to <title>
  result.title = getMetaContent('title');
  if (!result.title) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) result.title = decodeHtmlEntities(titleMatch[1].trim());
  }

  // Extract og:description or fallback to meta description
  result.description = getMetaContent('description');
  if (!result.description) {
    const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
    if (descMatch) result.description = decodeHtmlEntities(descMatch[1]);
  }

  // Note: og:image intentionally not fetched to avoid console errors from blocked images

  // Extract og:site_name
  result.siteName = getMetaContent('site_name');

  // Extract og:type
  result.type = getMetaContent('type');

  return result;
}

/**
 * Decode HTML entities
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

/**
 * Truncate string to max length
 */
function truncate(str: string | undefined, maxLength: number): string | undefined {
  if (!str) return str;
  return str.length > maxLength ? str.slice(0, maxLength - 3) + '...' : str;
}

export function createOpenGraphRoutes(): Router {
  const router = Router();

  /**
   * Fetch OpenGraph metadata from a URL
   *
   * GET /api/opengraph/fetch?url=https://example.com
   *
   * Returns:
   * - 200: { success: true, data: OpenGraphMetadata }
   * - 400: Invalid URL or blocked host
   * - 500: Fetch error or timeout
   */
  router.get('/fetch', async (req, res) => {
    try {
      const urlParam = req.query.url as string;

      if (!urlParam) {
        return res.status(400).json({
          success: false,
          error: 'URL parameter is required'
        });
      }

      // Validate URL
      const url = validateUrl(urlParam);
      if (!url) {
        return res.status(400).json({
          success: false,
          error: 'Invalid URL. Must be http/https and not a private/internal address.'
        });
      }

      // Fetch the URL with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(url.href, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Clout/1.0 OpenGraph Fetcher',
            'Accept': 'text/html,application/xhtml+xml',
          },
          redirect: 'follow',
        });
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        if (fetchError.name === 'AbortError') {
          return res.status(504).json({
            success: false,
            error: 'Request timed out'
          });
        }
        throw fetchError;
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        return res.status(response.status).json({
          success: false,
          error: `Failed to fetch URL: ${response.status} ${response.statusText}`
        });
      }

      // Check content type
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        return res.status(400).json({
          success: false,
          error: 'URL does not return HTML content'
        });
      }

      // Read response body with size limit
      const reader = response.body?.getReader();
      if (!reader) {
        return res.status(500).json({
          success: false,
          error: 'Could not read response body'
        });
      }

      const chunks: Uint8Array[] = [];
      let totalSize = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        totalSize += value.length;
        if (totalSize > MAX_RESPONSE_SIZE) {
          reader.cancel();
          break;
        }
        chunks.push(value);
      }

      const html = new TextDecoder().decode(Buffer.concat(chunks));

      // Extract OpenGraph metadata
      const ogData = extractOpenGraphMetadata(html, url.href);

      // Sanitize and truncate values
      const metadata: OpenGraphMetadata = {
        url: ogData.url,
        title: truncate(ogData.title, 200),
        description: truncate(ogData.description, 500),
        siteName: truncate(ogData.siteName, 100),
        type: truncate(ogData.type, 50),
        fetchedAt: Date.now(),
      };

      // Check if we got any useful data
      if (!metadata.title && !metadata.description) {
        return res.status(404).json({
          success: false,
          error: 'No OpenGraph metadata found on this page'
        });
      }

      console.log(`[OpenGraph] Fetched metadata for ${url.hostname}: "${metadata.title || 'untitled'}"`);

      res.json({
        success: true,
        data: metadata
      });
    } catch (error: any) {
      console.error('[OpenGraph] Fetch error:', error.message);
      res.status(500).json({
        success: false,
        error: `Failed to fetch OpenGraph data: ${error.message}`
      });
    }
  });

  return router;
}
