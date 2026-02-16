import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { stat } from 'node:fs/promises';

function appendSetCookie(res: ServerResponse, cookieValue: string): void {
  const existing = res.getHeader('set-cookie');
  if (!existing) {
    res.setHeader('set-cookie', cookieValue);
    return;
  }
  if (Array.isArray(existing)) {
    res.setHeader('set-cookie', [...existing, cookieValue]);
    return;
  }
  res.setHeader('set-cookie', [String(existing), cookieValue]);
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie ?? '';
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) {
      continue;
    }
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) {
      out[key] = decodeURIComponent(value);
    }
  }
  return out;
}

export function setSessionCookie(res: ServerResponse, cookieName: string, sessionId: string, ttlMs: number): void {
  appendSetCookie(
    res,
    `${cookieName}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ttlMs / 1000)}`
  );
}

export function setSessionCookieWithOptions(
  res: ServerResponse,
  cookieName: string,
  sessionId: string,
  ttlMs: number,
  options?: { secure?: boolean }
): void {
  const secure = options?.secure ? '; Secure' : '';
  appendSetCookie(
    res,
    `${cookieName}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${Math.floor(ttlMs / 1000)}`
  );
}

export function clearSessionCookie(res: ServerResponse, cookieName: string): void {
  appendSetCookie(res, `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function setCookie(
  res: ServerResponse,
  cookieName: string,
  value: string,
  options?: {
    ttlSec?: number;
    httpOnly?: boolean;
    sameSite?: 'Lax' | 'Strict' | 'None';
    secure?: boolean;
    path?: string;
  }
): void {
  const parts = [`${cookieName}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options?.path ?? '/'}`);
  if (options?.httpOnly !== false) {
    parts.push('HttpOnly');
  }
  if (options?.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }
  if (options?.secure) {
    parts.push('Secure');
  }
  if (typeof options?.ttlSec === 'number') {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.ttlSec))}`);
  }
  appendSetCookie(res, parts.join('; '));
}

export function clearCookie(
  res: ServerResponse,
  cookieName: string,
  options?: { httpOnly?: boolean; sameSite?: 'Lax' | 'Strict' | 'None'; secure?: boolean; path?: string }
): void {
  setCookie(res, cookieName, '', {
    ttlSec: 0,
    httpOnly: options?.httpOnly,
    sameSite: options?.sameSite,
    secure: options?.secure,
    path: options?.path
  });
}

export function sendJson(res: ServerResponse, payload: unknown, statusCode = 200): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export function redirect(res: ServerResponse, location: string): void {
  res.statusCode = 302;
  res.setHeader('location', location);
  res.end();
}

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

export async function sendFile(res: ServerResponse, filePath: string, contentType: string): Promise<void> {
  try {
    const body = await readFile(filePath);
    res.setHeader('content-type', contentType);
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('Not Found');
  }
}

export async function sendFileCached(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
  contentType: string,
  options?: { cacheControl?: string }
): Promise<void> {
  try {
    const info = await stat(filePath);
    const etag = `"${info.size}-${Math.floor(info.mtimeMs)}"`;
    const ifNoneMatch = String(req.headers['if-none-match'] ?? '').trim();
    const ifModifiedSince = String(req.headers['if-modified-since'] ?? '').trim();

    res.setHeader('content-type', contentType);
    res.setHeader('etag', etag);
    res.setHeader('last-modified', info.mtime.toUTCString());
    if (options?.cacheControl) {
      res.setHeader('cache-control', options.cacheControl);
    }

    if (ifNoneMatch && ifNoneMatch === etag) {
      res.statusCode = 304;
      res.end();
      return;
    }

    if (ifModifiedSince) {
      const sinceAt = Date.parse(ifModifiedSince);
      if (Number.isFinite(sinceAt) && sinceAt >= info.mtimeMs) {
        res.statusCode = 304;
        res.end();
        return;
      }
    }

    // Stream large assets (world GLBs) to avoid buffering in memory.
    const stream = createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.statusCode = 404;
      }
      res.end('Not Found');
    });
    stream.pipe(res);
  } catch {
    res.statusCode = 404;
    res.end('Not Found');
  }
}
