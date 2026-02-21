import { describe, expect, it } from 'vitest';
import { config } from '../config.js';
import { verifyWsAuth } from './auth.js';

describe('verifyWsAuth', () => {
  it('rejects auth when ws secret is not configured', () => {
    const originalSecret = config.wsAuthSecret;
    (config as { wsAuthSecret: string }).wsAuthSecret = '';
    try {
      const result = verifyWsAuth('token', 'human');
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('ws_auth_not_configured');
    } finally {
      (config as { wsAuthSecret: string }).wsAuthSecret = originalSecret;
    }
  });
});
