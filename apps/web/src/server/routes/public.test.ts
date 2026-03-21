import { describe, expect, it, vi } from 'vitest';
import { handlePublicRoutes } from './public.js';
import type { ServerContext } from '../types.js';
import { createTestRequest, createTestResponse } from '../testUtils.js';

function createContext(): ServerContext {
  return {
    config: {
      emailAuthEnabled: true,
      firebaseGoogleAuthEnabled: false,
      googleAuthEnabled: false,
      googleClientId: '',
      firebaseClientAuthEnabled: false,
      firebaseWebApiKey: 'firebase-key',
      firebaseAuthDomain: 'example.firebaseapp.com',
      firebaseProjectId: 'example',
      cdpProjectId: 'cdp-id',
      localAuthEnabled: false,
      publicGameWsUrl: 'wss://example.test/game',
      publicWorldAssetBaseUrl: 'https://cdn.example.test',
      defaultWorldAssetBaseUrl: 'https://cdn.example.test',
      escrowApprovalChainId: null,
      escrowApprovalChainHint: '',
      escrowApprovalModeSepolia: 'auto',
      escrowApprovalModeMainnet: 'manual',
      escrowApprovalDefaultMode: 'manual',
      escrowAutoApproveMaxWager: null,
      escrowAutoApproveDailyCap: null,
      escrowApprovalResolved: { mode: 'manual' },
      publicDir: '/tmp/public',
      availableWorldAliases: [],
      worldFilenameByAlias: {},
      worldVersionByAlias: {},
      worldBundlesByAlias: {}
    },
    sessionStore: { ping: vi.fn(async () => true) },
    runtimeStatusOk: vi.fn(async () => true),
    serverHealthOk: vi.fn(async () => true)
  } as unknown as ServerContext;
}

describe('handlePublicRoutes', () => {
  it('returns health with dependency status', async () => {
    const req = createTestRequest({ url: '/health' });
    const res = createTestResponse();

    const handled = await handlePublicRoutes(req, res, new URL('http://localhost:3000/health'), createContext());

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.bodyText)).toMatchObject({
      ok: true,
      deps: {
        redis: true,
        runtime: true,
        server: true
      }
    });
  });
});
