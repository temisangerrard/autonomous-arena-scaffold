/**
 * HTTP utilities for the agent runtime
 * Extracted from index.ts to improve modularity
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Set CORS headers for cross-origin requests
 * SECURITY: Uses explicit allowed origins list, never '*' with credentials
 */
export function setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const allowedOrigins = getAllowedCorsOrigins();
  const origin = req.headers.origin;

  // Check if origin is in allowed list
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('access-control-allow-origin', origin);
  } else if (allowedOrigins.length === 0 && process.env.NODE_ENV !== 'production') {
    // Development fallback only
    res.setHeader('access-control-allow-origin', '*');
  }

  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type,x-internal-token');
}

/**
 * Get allowed CORS origins from environment
 */
function getAllowedCorsOrigins(): string[] {
  const originsEnv = process.env.CORS_ALLOWED_ORIGINS?.trim();
  if (!originsEnv) {
    // Default to localhost for development
    if (process.env.NODE_ENV !== 'production') {
      return ['http://localhost:3000', 'http://localhost:4000', 'http://localhost:4100'];
    }
    return [];
  }
  return originsEnv.split(',').map(o => o.trim()).filter(Boolean);
}

/**
 * Read and parse JSON body from incoming request
 */
export async function readJsonBody<T>(req: IncomingMessage): Promise<T | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return null;
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * Send JSON response
 */
export function sendJson(res: ServerResponse, payload: unknown, statusCode = 200): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
}

/**
 * Simple router interface for HTTP handlers
 */
export type HttpHandler = (req: IncomingMessage, res: ServerResponse, params?: Record<string, string>) => Promise<void> | void;

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'OPTIONS';
  path: string;
  handler: HttpHandler;
}

/**
 * Simple router class for handling HTTP routes
 */
export class SimpleRouter {
  private routes: Route[] = [];

  get(path: string, handler: HttpHandler): void {
    this.routes.push({ method: 'GET', path, handler });
  }

  post(path: string, handler: HttpHandler): void {
    this.routes.push({ method: 'POST', path, handler });
  }

  put(path: string, handler: HttpHandler): void {
    this.routes.push({ method: 'PUT', path, handler });
  }

  delete(path: string, handler: HttpHandler): void {
    this.routes.push({ method: 'DELETE', path, handler });
  }

  /**
   * Match a request to a route and extract params
   */
  match(method: string, pathname: string): { handler: HttpHandler; params: Record<string, string> } | null {
    const normalizedMethod = String(method || '').toUpperCase();
    const rawPath = String(pathname || '');
    const withoutQuery = rawPath.split('?')[0] ?? '';
    const withoutHash = withoutQuery.split('#')[0] ?? '';
    const pathSegments = withoutHash.split('/').filter(Boolean);

    for (const route of this.routes) {
      if (route.method !== normalizedMethod) {
        continue;
      }

      const routeSegments = route.path.split('/').filter(Boolean);
      if (routeSegments.length !== pathSegments.length) {
        continue;
      }

      const params: Record<string, string> = {};
      let matched = true;

      for (let i = 0; i < routeSegments.length; i++) {
        const routePart = routeSegments[i] ?? '';
        const pathPart = pathSegments[i] ?? '';

        if (routePart.startsWith(':')) {
          const key = routePart.slice(1);
          if (!key) {
            matched = false;
            break;
          }
          params[key] = pathPart;
          continue;
        }

        if (routePart !== pathPart) {
          matched = false;
          break;
        }
      }

      if (matched) {
        return { handler: route.handler, params };
      }
    }

    return null;
  }

  /**
   * Get all registered routes
   */
  getRoutes(): Route[] {
    return [...this.routes];
  }
}
