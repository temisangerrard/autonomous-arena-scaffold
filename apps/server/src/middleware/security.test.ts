import { describe, expect, it } from 'vitest';
import { validateProductionStartup } from './security.js';

function baseEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    ADMIN_EMAILS: 'ops@example.com',
    GAME_WS_AUTH_SECRET: 'secret',
    INTERNAL_SERVICE_TOKEN: 'internal_secret',
    REDIS_URL: 'redis://localhost:6379',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/app'
  };
}

describe('validateProductionStartup', () => {
  it('fails when escrow mode is set to runtime', () => {
    const result = validateProductionStartup({
      ...baseEnv(),
      ESCROW_EXECUTION_MODE: 'runtime'
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('ESCROW_EXECUTION_MODE must be "onchain"; runtime escrow mode is no longer supported');
  });

  it('fails when onchain escrow mode has no runtime URL configured', () => {
    const result = validateProductionStartup({
      ...baseEnv(),
      ESCROW_EXECUTION_MODE: 'onchain'
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('AGENT_RUNTIME_URL must be set when ESCROW_EXECUTION_MODE=onchain');
  });

  it('fails when onchain escrow mode points runtime URL to localhost', () => {
    const result = validateProductionStartup({
      ...baseEnv(),
      ESCROW_EXECUTION_MODE: 'onchain',
      AGENT_RUNTIME_URL: 'http://localhost:4100'
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('AGENT_RUNTIME_URL must not point to localhost in production when ESCROW_EXECUTION_MODE=onchain');
  });
});
