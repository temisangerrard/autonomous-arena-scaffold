/**
 * Caching Middleware for Static Assets
 * 
 * Provides:
 * - Long-term caching for versioned assets
 * - Short-term caching for HTML
 * - Cache invalidation strategies
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';

export type CacheConfig = {
  // Max age for static assets (in seconds)
  staticMaxAge: number;
  // Max age for HTML pages (in seconds)
  htmlMaxAge: number;
  // Max age for API responses that can be cached
  apiMaxAge: number;
  // Whether to enable immutable caching for versioned assets
  immutableAssets: boolean;
};

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  staticMaxAge: 31536000, // 1 year
  htmlMaxAge: 0, // No caching for HTML (always fresh)
  apiMaxAge: 0, // No caching for API by default
  immutableAssets: true
};

/**
 * Check if a path is a versioned/static asset
 */
function isStaticAsset(pathname: string): boolean {
  // Check for content-hashed filenames (e.g., app.abc123.js)
  if (/\.[a-f0-9]{8,}\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|glb|gltf)$/i.test(pathname)) {
    return true;
  }
  
  // Check for common static asset extensions
  if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|glb|gltf|webp|mp4|webm)$/i.test(pathname)) {
    return true;
  }
  
  return false;
}

/**
 * Check if a path is an HTML page
 */
function isHtmlPage(pathname: string): boolean {
  return pathname === '/' || pathname.endsWith('.html') || !pathname.includes('.');
}

/**
 * Apply cache headers based on content type
 */
export function applyCacheHeaders(
  req: IncomingMessage,
  res: ServerResponse,
  config: Partial<CacheConfig> = {}
): void {
  const finalConfig = { ...DEFAULT_CACHE_CONFIG, ...config };
  const pathname = req.url?.split('?')[0] || '/';
  
  if (isStaticAsset(pathname)) {
    // Static assets: long-term caching
    res.setHeader('Cache-Control', `public, max-age=${finalConfig.staticMaxAge}${finalConfig.immutableAssets ? ', immutable' : ''}`);
    res.setHeader('Vary', 'Accept-Encoding');
  } else if (isHtmlPage(pathname)) {
    // HTML: no caching or very short cache
    res.setHeader('Cache-Control', `public, max-age=${finalConfig.htmlMaxAge}, must-revalidate`);
    res.setHeader('Vary', 'Accept-Encoding');
  } else if (pathname.startsWith('/api/')) {
    // API: configurable caching
    res.setHeader('Cache-Control', `private, max-age=${finalConfig.apiMaxAge}`);
  }
}

/**
 * Create ETag for cache validation
 */
export function createEtag(content: string | Buffer): string {
  const hash = createHash('md5');
  hash.update(content);
  return `"${hash.digest('hex')}"`;
}

/**
 * Check if client has fresh content (If-None-Match / If-Modified-Since)
 */
export function isClientCacheFresh(
  req: IncomingMessage,
  etag?: string,
  lastModified?: Date
): boolean {
  // Check ETag
  if (etag) {
    const clientEtag = req.headers['if-none-match'];
    if (clientEtag === etag) {
      return true;
    }
  }
  
  // Check Last-Modified
  if (lastModified) {
    const clientDate = req.headers['if-modified-since'];
    if (clientDate) {
      const clientTime = new Date(clientDate).getTime();
      const serverTime = lastModified.getTime();
      if (clientTime >= serverTime) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Send 304 Not Modified if client cache is fresh
 */
export function sendNotModifiedIfFresh(
  req: IncomingMessage,
  res: ServerResponse,
  etag?: string,
  lastModified?: Date
): boolean {
  if (isClientCacheFresh(req, etag, lastModified)) {
    res.statusCode = 304;
    res.end();
    return true;
  }
  return false;
}

/**
 * Middleware factory for caching
 */
export function createCacheMiddleware(config: Partial<CacheConfig> = {}) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    applyCacheHeaders(req, res, config);
    next();
  };
}

/**
 * Cacheable API response helper
 */
export function sendCacheableJson(
  req: IncomingMessage,
  res: ServerResponse,
  data: unknown,
  maxAge: number = 60
): void {
  const content = JSON.stringify(data);
  const etag = createEtag(content);
  
  // Set cache headers
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', `public, max-age=${maxAge}`);
  res.setHeader('ETag', etag);
  res.setHeader('Vary', 'Accept-Encoding');
  
  // Check if client has fresh content
  if (sendNotModifiedIfFresh(req, res, etag)) {
    return;
  }
  
  res.end(content);
}
