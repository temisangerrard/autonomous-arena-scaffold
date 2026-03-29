import { describe, expect, it } from 'vitest';
import { applyCredentialedCors, buildAllowedOrigins, resolveCredentialedCorsOrigin } from './cors.js';

describe('cors helpers', () => {
  it('includes autobett apex and www in the allowed origins set', () => {
    const allowed = buildAllowedOrigins(undefined, [
      'https://autobett.xyz',
      'https://www.autobett.xyz'
    ]);

    expect(allowed.has('https://autobett.xyz')).toBe(true);
    expect(allowed.has('https://www.autobett.xyz')).toBe(true);
  });

  it('resolves a credentialed CORS origin from the Origin header', () => {
    const allowed = new Set(['https://www.autobett.xyz']);
    const origin = resolveCredentialedCorsOrigin({
      headers: {
        origin: 'https://www.autobett.xyz'
      }
    } as never, allowed);

    expect(origin).toBe('https://www.autobett.xyz');
  });

  it('applies credentialed CORS headers for an allowed origin', () => {
    const allowed = new Set(['https://www.autobett.xyz']);
    const headers = new Map<string, string>();
    const applied = applyCredentialedCors(
      {
        headers: {
          origin: 'https://www.autobett.xyz'
        }
      } as never,
      {
        setHeader(name: string, value: string) {
          headers.set(name, value);
        }
      } as never,
      allowed
    );

    expect(applied).toBe(true);
    expect(headers.get('access-control-allow-origin')).toBe('https://www.autobett.xyz');
    expect(headers.get('access-control-allow-credentials')).toBe('true');
    expect(headers.get('vary')).toBe('Origin');
  });
});
