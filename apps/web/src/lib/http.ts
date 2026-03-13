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
    res.setHeader('accept-ranges', 'bytes');

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

    const size = Number(info.size || 0);
    const range = String(req.headers.range || '').trim();
    let start = 0;
    let end = Math.max(0, size - 1);

    if (range.startsWith('bytes=')) {
      const [rawStart, rawEnd] = range.slice('bytes='.length).split('-', 2);
      const parsedStart = rawStart ? Number(rawStart) : Number.NaN;
      const parsedEnd = rawEnd ? Number(rawEnd) : Number.NaN;

      if (Number.isFinite(parsedStart)) {
        start = Math.max(0, Math.min(size - 1, parsedStart));
      }
      if (Number.isFinite(parsedEnd)) {
        end = Math.max(start, Math.min(size - 1, parsedEnd));
      }
      if (rawStart === '' && Number.isFinite(parsedEnd)) {
        const suffixLen = Math.max(0, parsedEnd);
        start = Math.max(0, size - suffixLen);
        end = Math.max(start, size - 1);
      }

      if (start > end || start >= size) {
        res.statusCode = 416;
        res.setHeader('content-range', `bytes */${size}`);
        res.end();
        return;
      }

      res.statusCode = 206;
      res.setHeader('content-range', `bytes ${start}-${end}/${size}`);
      res.setHeader('content-length', String(end - start + 1));
    } else {
      res.statusCode = 200;
      res.setHeader('content-length', String(size));
    }

    // Stream large assets (world GLBs) to avoid buffering in memory.
    const stream = createReadStream(filePath, { start, end });
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
