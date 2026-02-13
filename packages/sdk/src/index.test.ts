import { describe, expect, it, vi } from 'vitest';
import { fetchHealth } from './index.js';

describe('fetchHealth', () => {
  it('returns parsed health payload when response is valid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: true, service: 'server', timestamp: new Date().toISOString() })
      }))
    );

    const payload = await fetchHealth('http://localhost:4000', 'server');

    expect(payload.ok).toBe(true);
    expect(payload.service).toBe('server');
  });
});
