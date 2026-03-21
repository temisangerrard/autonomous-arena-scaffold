import { describe, expect, it, vi } from 'vitest';
import { handleAuthRoutes } from './auth.js';
import type { ServerContext } from '../types.js';
import { createTestRequest, createTestResponse } from '../testUtils.js';

function createContext(overrides: Partial<ServerContext> = {}): ServerContext {
  return {
    config: {
      localAuthEnabled: false,
      localAdminPassword: '',
      emailAuthEnabled: false,
      allowedAuthOrigins: new Set(['http://localhost:3000']),
      isProduction: false
    },
    isSameOriginRequest: vi.fn(() => false),
    ...overrides
  } as unknown as ServerContext;
}

describe('handleAuthRoutes', () => {
  it('rejects local auth when the feature is disabled', async () => {
    const req = createTestRequest({
      method: 'POST',
      url: '/api/auth/local',
      body: { username: 'admin', password: 'secret' }
    });
    const res = createTestResponse();
    const handled = await handleAuthRoutes(req, res, new URL('http://localhost:3000/api/auth/local'), createContext());

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.bodyText)).toEqual({ ok: false, reason: 'local_auth_disabled' });
  });

  it('rejects email auth on same-origin mismatch', async () => {
    const req = createTestRequest({
      method: 'POST',
      url: '/api/auth/email',
      body: { email: 'dev@example.com', password: 'secret', mode: 'login' }
    });
    const res = createTestResponse();
    const context = createContext({
      config: {
        localAuthEnabled: false,
        localAdminPassword: '',
        allowedAuthOrigins: new Set(['http://localhost:3000']),
        isProduction: false,
        emailAuthEnabled: true
      } as ServerContext['config'],
      isSameOriginRequest: vi.fn(() => false)
    });

    const handled = await handleAuthRoutes(req, res, new URL('http://localhost:3000/api/auth/email'), context);

    expect(handled).toBe(true);
    expect(context.isSameOriginRequest).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.bodyText)).toEqual({ ok: false, reason: 'origin_mismatch' });
  });
});
