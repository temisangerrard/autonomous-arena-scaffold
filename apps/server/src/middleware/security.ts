/**
 * Security Middleware
 * 
 * Provides security hardening including:
 * - Security headers (CSP, HSTS, X-Frame-Options, etc.)
 * - Production startup validation
 * - Request validation
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { log as rootLog } from '../logger.js';

const log = rootLog.child({ module: 'security' });

export type SecurityConfig = {
  // Content Security Policy
  csp?: string | false;
  // HTTP Strict Transport Security
  hsts?: {
    maxAge: number;
    includeSubDomains?: boolean;
    preload?: boolean;
  } | false;
  // X-Frame-Options
  frameOptions?: 'DENY' | 'SAMEORIGIN' | false;
  // X-Content-Type-Options
  contentTypeOptions?: 'nosniff' | false;
  // X-XSS-Protection (legacy, but still useful for older browsers)
  xssProtection?: boolean;
  // Referrer-Policy
  referrerPolicy?: string;
  // Permissions-Policy
  permissionsPolicy?: string | false;
  // CORS settings
  cors?: {
    origins: string[];
    methods?: string[];
    credentials?: boolean;
  };
};

/**
 * Get allowed CORS origins from environment
 * SECURITY: Never use '*' with credentials in production
 */
function getAllowedCorsOrigins(): string[] {
  const originsEnv = process.env.CORS_ALLOWED_ORIGINS?.trim();
  if (!originsEnv) {
    // Default to localhost for development
    if (process.env.NODE_ENV !== 'production') {
      return ['http://localhost:3000', 'http://localhost:4000', 'http://localhost:4100'];
    }
    // Production must explicitly configure origins
    log.warn('CORS_ALLOWED_ORIGINS not set in production. CORS will deny all origins.');
    return [];
  }
  return originsEnv.split(',').map(o => o.trim()).filter(Boolean);
}

const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  csp: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' wss: https:; media-src 'self' blob:; object-src 'none'; frame-ancestors 'self';",
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  frameOptions: 'SAMEORIGIN',
  contentTypeOptions: 'nosniff',
  xssProtection: true,
  referrerPolicy: 'strict-origin-when-cross-origin',
  permissionsPolicy: 'geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
  cors: {
    origins: getAllowedCorsOrigins(),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true
  }
};

/**
 * Apply security headers to response
 */
export function applySecurityHeaders(
  res: ServerResponse,
  config: SecurityConfig = DEFAULT_SECURITY_CONFIG
): void {
  // Content Security Policy
  if (config.csp !== false && config.csp) {
    res.setHeader('Content-Security-Policy', config.csp);
  }

  // HTTP Strict Transport Security
  if (config.hsts !== false && config.hsts) {
    const hstsValue = [
      `max-age=${config.hsts.maxAge}`,
      config.hsts.includeSubDomains ? 'includeSubDomains' : '',
      config.hsts.preload ? 'preload' : ''
    ].filter(Boolean).join('; ');
    res.setHeader('Strict-Transport-Security', hstsValue);
  }

  // X-Frame-Options
  if (config.frameOptions !== false && config.frameOptions) {
    res.setHeader('X-Frame-Options', config.frameOptions);
  }

  // X-Content-Type-Options
  if (config.contentTypeOptions !== false && config.contentTypeOptions) {
    res.setHeader('X-Content-Type-Options', config.contentTypeOptions);
  }

  // X-XSS-Protection
  if (config.xssProtection) {
    res.setHeader('X-XSS-Protection', '1; mode=block');
  }

  // Referrer-Policy
  if (config.referrerPolicy) {
    res.setHeader('Referrer-Policy', config.referrerPolicy);
  }

  // Permissions-Policy
  if (config.permissionsPolicy !== false && config.permissionsPolicy) {
    res.setHeader('Permissions-Policy', config.permissionsPolicy);
  }

  // Cache-Control for API responses
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
}

/**
 * CORS middleware
 */
export function handleCors(
  req: IncomingMessage,
  res: ServerResponse,
  config: SecurityConfig['cors'] = DEFAULT_SECURITY_CONFIG.cors
): boolean {
  if (!config) return false;

  const origin = req.headers.origin;
  const allowedOrigins = config.origins;

  // Check if origin is allowed
  const allowOrigin = allowedOrigins.includes('*') 
    ? '*'
    : origin && allowedOrigins.includes(origin)
      ? origin
      : null;

  if (allowOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    
    if (config.credentials) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    if (config.methods) {
      res.setHeader('Access-Control-Allow-Methods', config.methods.join(', '));
    }

    // Allow common headers
    res.setHeader('Access-Control-Allow-Headers', 
      'Content-Type, Authorization, X-Requested-With, X-Internal-Token, X-Request-ID');
    
    // Expose useful headers to client
    res.setHeader('Access-Control-Expose-Headers',
      'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Request-ID');
  }

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
    return true;
  }

  return false;
}

/**
 * Production startup validation
 */
export type StartupValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export function validateProductionStartup(env: NodeJS.ProcessEnv): StartupValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Critical: Local auth must be disabled in production
  if (env.LOCAL_AUTH_ENABLED === 'true') {
    errors.push('LOCAL_AUTH_ENABLED=true is not allowed in production. Disable local auth escape hatch.');
  }

  // Critical: Must have admin emails configured
  if (!env.ADMIN_EMAILS?.trim()) {
    errors.push('ADMIN_EMAILS must be set in production for admin access control.');
  }

  // Critical: WebSocket auth secret must be set
  if (!env.GAME_WS_AUTH_SECRET?.trim()) {
    errors.push('GAME_WS_AUTH_SECRET must be set in production for WebSocket authentication.');
  }

  // Critical: Internal service token must be set
  if (!env.INTERNAL_SERVICE_TOKEN?.trim()) {
    errors.push('INTERNAL_SERVICE_TOKEN must be set in production for internal service authentication.');
  }

  // Critical: Redis URL must be set for distributed multiplayer
  if (!env.REDIS_URL?.trim()) {
    errors.push('REDIS_URL must be set in production for distributed presence/multiplayer.');
  }

  // Critical: Database URL must be set
  if (!env.DATABASE_URL?.trim()) {
    errors.push('DATABASE_URL must be set in production for persistent storage.');
  }

  // Critical: Wallet encryption key must be set and secure in production
  if (!env.WALLET_ENCRYPTION_KEY?.trim()) {
    errors.push('WALLET_ENCRYPTION_KEY is required in production. Generate with: openssl rand -hex 32');
  } else if (env.WALLET_ENCRYPTION_KEY === 'arena-dev-wallet-key') {
    errors.push('WALLET_ENCRYPTION_KEY is using the default development value. Generate a secure key for production: openssl rand -hex 32');
  } else if (env.WALLET_ENCRYPTION_KEY.length < 32) {
    errors.push('WALLET_ENCRYPTION_KEY must be at least 32 characters. Generate with: openssl rand -hex 32');
  }

  // Warning: Check for secure cookie settings if using sessions
  if (env.NODE_ENV === 'production') {
    if (!env.GOOGLE_CLIENT_ID?.trim() && !env.LOCAL_AUTH_ENABLED) {
      warnings.push('GOOGLE_CLIENT_ID is not set. Google OAuth will not work.');
    }
  }

  // Warning: Check game server URL for production
  if (env.GAME_WS_URL?.includes('localhost') || env.GAME_WS_URL?.includes('127.0.0.1')) {
    warnings.push('GAME_WS_URL points to localhost. This may not work in deployed environments.');
  }

  // Warning: Check for test/development values in production
  const suspiciousValues = [
    { key: 'ADMIN_PASSWORD', value: 'password' },
    { key: 'ADMIN_PASSWORD', value: '12345' },
    { key: 'ADMIN_PASSWORD', value: 'admin' },
    { key: 'ADMIN_USERNAME', value: 'admin' },
  ];

  for (const { key, value } of suspiciousValues) {
    if (env[key]?.toLowerCase() === value) {
      warnings.push(`${key} is set to a common default value "${value}". Use a strong unique value.`);
    }
  }

  // Info: Check optional but recommended settings
  if (!env.OPENROUTER_API_KEY?.trim()) {
    warnings.push('OPENROUTER_API_KEY is not set. Super Agent LLM features will be disabled.');
  }

  const requestedEscrowMode = String(env.ESCROW_EXECUTION_MODE ?? 'onchain').trim().toLowerCase();
  if (requestedEscrowMode !== 'onchain') {
    errors.push('ESCROW_EXECUTION_MODE must be "onchain"; runtime escrow mode is no longer supported');
  }
  if (!env.CHAIN_RPC_URL?.trim()) {
    errors.push('CHAIN_RPC_URL must be set when ESCROW_EXECUTION_MODE=onchain');
  }
  if (!env.ESCROW_CONTRACT_ADDRESS?.trim()) {
    errors.push('ESCROW_CONTRACT_ADDRESS must be set when ESCROW_EXECUTION_MODE=onchain');
  }
  if (!env.ESCROW_RESOLVER_PRIVATE_KEY?.trim()) {
    errors.push('ESCROW_RESOLVER_PRIVATE_KEY must be set when ESCROW_EXECUTION_MODE=onchain');
  }
  const runtimeUrl = (env.AGENT_RUNTIME_URL ?? env.WEB_AGENT_RUNTIME_BASE_URL ?? '').trim();
  if (!runtimeUrl) {
    errors.push('AGENT_RUNTIME_URL must be set when ESCROW_EXECUTION_MODE=onchain');
  } else {
    const lower = runtimeUrl.toLowerCase();
    const isLocalhost = lower.includes('://localhost')
      || lower.includes('://127.0.0.1')
      || lower.startsWith('localhost:')
      || lower.startsWith('127.0.0.1:');
    if (isLocalhost && env.NODE_ENV === 'production') {
      errors.push('AGENT_RUNTIME_URL must not point to localhost in production when ESCROW_EXECUTION_MODE=onchain');
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Run startup validation and log results
 */
export function runStartupValidation(env: NodeJS.ProcessEnv): void {
  const result = validateProductionStartup(env);

  if (result.warnings.length > 0) {
    for (const warning of result.warnings) {
      log.warn({ warning }, 'startup validation warning');
    }
  }

  if (!result.ok) {
    for (const error of result.errors) {
      log.fatal({ error }, 'startup validation error');
    }
    
    if (env.NODE_ENV === 'production') {
      log.fatal('Production startup validation failed. Refusing to start.');
      process.exit(1);
    } else {
      log.warn('Startup validation failed but continuing in development mode.');
    }
  } else {
    log.info('Startup validation passed');
  }
}

/**
 * Request ID middleware for tracing
 */
export function addRequestId(
  req: IncomingMessage & { requestId?: string },
  res: ServerResponse
): string {
  const existingId = req.headers['x-request-id'];
  const requestId = typeof existingId === 'string' && existingId 
    ? existingId 
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  
  return requestId;
}

/**
 * Request size limiter
 */
export function createRequestSizeLimiter(maxBytes: number = 1024 * 1024) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const contentLength = req.headers['content-length'];
    
    if (contentLength) {
      const length = parseInt(contentLength, 10);
      if (length > maxBytes) {
        res.statusCode = 413;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          error: 'request_too_large',
          message: `Request body exceeds maximum size of ${maxBytes} bytes`
        }));
        return false;
      }
    }
    
    return true;
  };
}

/**
 * IP allowlist middleware for admin endpoints
 */
export function createIpAllowlistMiddleware(allowedIps: string[]) {
  const allowed = new Set(allowedIps.map(ip => ip.trim()).filter(Boolean));
  
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    if (allowed.size === 0) {
      return true; // No allowlist configured, allow all
    }

    const forwarded = req.headers['x-forwarded-for'];
    const rawIp = Array.isArray(forwarded)
      ? forwarded[0]
      : forwarded?.split(',')[0]?.trim()
        || req.socket?.remoteAddress
        || '';
    const ip = rawIp || 'unknown';

    // Handle IPv6 loopback and IPv4-mapped IPv6
    const normalizedIp = ip.replace(/^::ffff:/, '');

    if (!allowed.has(normalizedIp) && !allowed.has(ip)) {
      log.warn({ ip, normalizedIp }, 'IP not in allowlist');
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        error: 'forbidden',
        message: 'Access denied'
      }));
      return false;
    }

    return true;
  };
}
