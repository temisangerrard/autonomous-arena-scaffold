import { describe, expect, it, vi } from 'vitest';
import { dispatchRequest, type RouteHandler } from './dispatcher.js';
import type { ServerContext } from './types.js';
import { createTestRequest, createTestResponse } from './testUtils.js';

function createContext(): ServerContext {
  return {
    config: {
      allowedAuthOrigins: new Set(['http://localhost:3000'])
    }
  } as ServerContext;
}

describe('dispatchRequest', () => {
  it('stops at the first matching route handler', async () => {
    const first = vi.fn<RouteHandler>().mockResolvedValue(true);
    const second = vi.fn<RouteHandler>().mockResolvedValue(true);
    const req = createTestRequest({ url: '/health' });
    const res = createTestResponse();
    const requestUrl = new URL('http://localhost:3000/health');

    await dispatchRequest(req, res, requestUrl, createContext(), [first, second]);

    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });

  it('returns 404 when no route handler matches', async () => {
    const req = createTestRequest({ url: '/missing' });
    const res = createTestResponse();
    const requestUrl = new URL('http://localhost:3000/missing');

    await dispatchRequest(req, res, requestUrl, createContext(), []);

    expect(res.statusCode).toBe(404);
    expect(res.bodyText).toBe('Not Found');
  });
});

