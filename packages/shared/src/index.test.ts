import { describe, expect, it } from 'vitest';
import { SERVICE_NAMES } from './index.js';

describe('SERVICE_NAMES', () => {
  it('defines core service names used by health endpoints', () => {
    expect(SERVICE_NAMES).toEqual(['server', 'agent-runtime', 'web']);
  });
});
