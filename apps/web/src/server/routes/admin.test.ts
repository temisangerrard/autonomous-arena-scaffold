import { describe, expect, it, vi } from 'vitest';
import { handleAdminRoutes } from './admin.js';
import type { ServerContext } from '../types.js';
import { createTestRequest, createTestResponse } from '../testUtils.js';

function createContext(): ServerContext {
  return {
    requireRole: vi.fn(async () => ({ ok: true, identity: { role: 'admin', sub: 'admin:1' } })),
    runtimeGet: vi.fn(async () => ({ ok: true }))
  } as unknown as ServerContext;
}

describe('handleAdminRoutes', () => {
  it('rejects runtime proxy subpaths outside the allowlist', async () => {
    const req = createTestRequest({ method: 'GET', url: '/api/admin/runtime/nope' });
    const res = createTestResponse();

    const handled = await handleAdminRoutes(req, res, new URL('http://localhost:3000/api/admin/runtime/nope'), createContext());

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.bodyText)).toEqual({ ok: false, reason: 'admin_proxy_not_allowed' });
  });
});

