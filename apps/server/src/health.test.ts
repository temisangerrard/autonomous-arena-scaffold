import { describe, expect, it } from 'vitest';
import { createHealthStatus } from './health.js';

describe('createHealthStatus', () => {
  it('returns an ok health payload for server', () => {
    const health = createHealthStatus();

    expect(health.ok).toBe(true);
    expect(health.service).toBe('server');
    expect(Number.isNaN(Date.parse(health.timestamp))).toBe(false);
  });
});
