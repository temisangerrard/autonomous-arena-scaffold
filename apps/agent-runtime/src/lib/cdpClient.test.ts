import { describe, expect, it, vi } from 'vitest';
import { initializeCdpClient } from './cdpClient.js';

describe('initializeCdpClient', () => {
  it('returns unavailable when any required env var is missing', async () => {
    const state = await initializeCdpClient({
      CDP_API_KEY_ID: 'id',
      CDP_API_KEY_SECRET: '',
      CDP_PROJECT_ID: 'project-id'
    });

    expect(state.available).toBe(false);
    expect(state.reason).toBe('cdp_env_missing');
    expect(state.configured.apiKeyId).toBe(true);
    expect(state.configured.apiKeySecret).toBe(false);
    expect(state.configured.projectId).toBe(true);
  });

  it('initializes once when all vars exist and sdk factory succeeds', async () => {
    const sdkFactory = vi.fn(async (params: { apiKeyId: string; apiKeySecret: string; projectId: string }) => ({
      tag: 'client',
      ...params
    }));

    const state = await initializeCdpClient(
      {
        CDP_API_KEY_ID: 'id',
        CDP_API_KEY_SECRET: 'secret',
        CDP_PROJECT_ID: 'project-id'
      },
      { sdkFactory }
    );

    expect(state.available).toBe(true);
    expect(state.client).toBeTruthy();
    expect(sdkFactory).toHaveBeenCalledTimes(1);
  });

  it('returns cdp_client_init_failed when default sdk constructor throws', async () => {
    vi.resetModules();
    vi.doMock('@coinbase/cdp-sdk', () => ({
      CdpClient: class {
        constructor() {
          throw new Error('boom');
        }
      }
    }));

    const { initializeCdpClient: initializeWithDefaultFactory } = await import('./cdpClient.js');
    const state = await initializeWithDefaultFactory({
      CDP_API_KEY_ID: 'id',
      CDP_API_KEY_SECRET: 'secret',
      CDP_PROJECT_ID: 'project-id'
    });

    expect(state.available).toBe(false);
    expect(state.reason).toBe('cdp_client_init_failed');

    vi.resetModules();
    vi.doUnmock('@coinbase/cdp-sdk');
  });
});
