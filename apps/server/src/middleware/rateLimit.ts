/**
 * Rate Limiting Middleware
 * 
 * Provides configurable rate limiting with:
 * - IP-based and user-based limits
 * - Configurable windows and limits
 * - Graceful degradation when database unavailable
 * - Rate limit headers in responses
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { log as rootLog } from '../logger.js';
import type { Database } from '../Database.js';

const log = rootLog.child({ module: 'rate-limit' });

export type RateLimitConfig = {
  windowMs: number;
  limit: number;
  keyGenerator?: (req: IncomingMessage) => string;
  skip?: (req: IncomingMessage) => boolean;
  onLimited?: (req: IncomingMessage, res: ServerResponse) => void;
};

export type RateLimitPreset = {
  windowMs: number;
  limit: number;
};

export const RATE_LIMIT_PRESETS = {
  // General API endpoints
  api: { windowMs: 60_000, limit: 100 },
  // Authentication endpoints (stricter)
  auth: { windowMs: 60_000, limit: 10 },
  // Challenge creation
  challenge: { windowMs: 60_000, limit: 30 },
  // Wallet operations
  wallet: { windowMs: 60_000, limit: 20 },
  // WebSocket connections
  websocket: { windowMs: 60_000, limit: 30 },
  // Health checks (very permissive)
  health: { windowMs: 60_000, limit: 300 },
} as const;

/**
 * Default key generator - uses X-Forwarded-For or remote address
 */
function defaultKeyGenerator(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = Array.isArray(forwarded) 
    ? forwarded[0] 
    : forwarded?.split(',')[0]?.trim() 
      || req.socket?.remoteAddress 
      || 'unknown';
  return `ip:${ip}`;
}

/**
 * Create rate limit middleware
 */
export function createRateLimiter(
  database: Database,
  config: RateLimitConfig
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const {
    windowMs,
    limit,
    keyGenerator = defaultKeyGenerator,
    skip,
    onLimited
  } = config;

  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    // Skip if configured
    if (skip?.(req)) {
      return true;
    }

    const key = keyGenerator(req);
    
    try {
      const result = await database.checkRateLimit({
        key: `ratelimit:${key}`,
        limit,
        windowMs
      });

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', limit);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - result.count));
      res.setHeader('X-RateLimit-Reset', new Date(result.resetAt).toISOString());

      if (!result.allowed) {
        log.warn({ key, count: result.count, limit }, 'rate limit exceeded');
        
        if (onLimited) {
          onLimited(req, res);
        } else {
          res.statusCode = 429;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Retry-After', Math.ceil((result.resetAt - Date.now()) / 1000).toString());
          res.end(JSON.stringify({
            error: 'rate_limit_exceeded',
            message: 'Too many requests. Please try again later.',
            retryAfter: result.resetAt
          }));
        }
        return false;
      }

      return true;
    } catch (error) {
      log.error({ error, key }, 'rate limit check failed - allowing request');
      // On error, allow the request through (fail open)
      return true;
    }
  };
}

/**
 * In-memory rate limiter fallback for when database is unavailable
 */
export class InMemoryRateLimiter {
  private counts = new Map<string, { count: number; resetAt: number }>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(
    private config: RateLimitConfig
  ) {
    // Cleanup expired entries every minute
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, value] of this.counts.entries()) {
        if (value.resetAt < now) {
          this.counts.delete(key);
        }
      }
    }, 60_000);
    this.cleanupInterval.unref();
  }

  check(req: IncomingMessage): { allowed: boolean; count: number; resetAt: number } {
    const key = this.config.keyGenerator?.(req) ?? defaultKeyGenerator(req);
    const now = Date.now();
    const resetAt = now + this.config.windowMs;

    const existing = this.counts.get(key);
    
    if (!existing || existing.resetAt < now) {
      this.counts.set(key, { count: 1, resetAt });
      return { allowed: true, count: 1, resetAt };
    }

    const newCount = existing.count + 1;
    this.counts.set(key, { count: newCount, resetAt: existing.resetAt });

    return {
      allowed: newCount <= this.config.limit,
      count: newCount,
      resetAt: existing.resetAt
    };
  }

  middleware(): (req: IncomingMessage, res: ServerResponse) => boolean {
    return (req: IncomingMessage, res: ServerResponse): boolean => {
      if (this.config.skip?.(req)) {
        return true;
      }

      const result = this.check(req);

      res.setHeader('X-RateLimit-Limit', this.config.limit);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, this.config.limit - result.count));
      res.setHeader('X-RateLimit-Reset', new Date(result.resetAt).toISOString());

      if (!result.allowed) {
        res.statusCode = 429;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Retry-After', Math.ceil((result.resetAt - Date.now()) / 1000).toString());
        res.end(JSON.stringify({
          error: 'rate_limit_exceeded',
          message: 'Too many requests. Please try again later.',
          retryAfter: result.resetAt
        }));
        return false;
      }

      return true;
    };
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
  }
}

/**
 * Combined rate limiter that uses database when available, falls back to memory
 */
export class HybridRateLimiter {
  private memoryLimiter: InMemoryRateLimiter;

  constructor(
    private database: Database,
    private config: RateLimitConfig
  ) {
    this.memoryLimiter = new InMemoryRateLimiter(config);
  }

  async middleware(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (this.config.skip?.(req)) {
      return true;
    }

    // Use database if connected
    if (this.database.connected) {
      const limiter = createRateLimiter(this.database, this.config);
      return limiter(req, res);
    }

    // Fall back to in-memory
    return this.memoryLimiter.middleware()(req, res);
  }

  destroy(): void {
    this.memoryLimiter.destroy();
  }
}

/**
 * Apply rate limiting to specific routes
 */
export function applyRateLimit(
  req: IncomingMessage,
  res: ServerResponse,
  limiter: HybridRateLimiter
): Promise<boolean> {
  return limiter.middleware(req, res);
}
