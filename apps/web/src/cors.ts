import type { IncomingMessage, ServerResponse } from 'node:http';

export function buildAllowedOrigins(input: string | undefined, defaults: string[]): Set<string> {
  const raw = String(input || '').trim();
  const candidates = raw
    ? raw.split(',').map((value) => value.trim()).filter(Boolean)
    : defaults;
  return new Set(
    candidates
      .map((value) => {
        try {
          return new URL(value).origin.toLowerCase();
        } catch {
          return '';
        }
      })
      .filter(Boolean)
  );
}

export function resolveCredentialedCorsOrigin(
  req: IncomingMessage,
  allowedOrigins: Set<string>
): string {
  const origin = String(req.headers.origin || '').trim();
  if (origin) {
    try {
      const normalized = new URL(origin).origin.toLowerCase();
      if (allowedOrigins.has(normalized)) {
        return normalized;
      }
    } catch {
      return '';
    }
  }

  const referer = String(req.headers.referer || '').trim();
  if (referer) {
    try {
      const normalized = new URL(referer).origin.toLowerCase();
      if (allowedOrigins.has(normalized)) {
        return normalized;
      }
    } catch {
      return '';
    }
  }

  return '';
}

export function applyCredentialedCors(
  req: IncomingMessage,
  res: ServerResponse,
  allowedOrigins: Set<string>
): boolean {
  const allowedOrigin = resolveCredentialedCorsOrigin(req, allowedOrigins);
  if (!allowedOrigin) {
    return false;
  }
  res.setHeader('access-control-allow-origin', allowedOrigin);
  res.setHeader('access-control-allow-credentials', 'true');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, authorization');
  res.setHeader('vary', 'Origin');
  return true;
}
