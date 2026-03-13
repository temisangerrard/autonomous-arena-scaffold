import { describe, expect, it } from 'vitest';
import { buildCoinbaseEndUserIdentity, isExistingEndUserConflict } from './cdpEndUserIdentity.js';

describe('buildCoinbaseEndUserIdentity', () => {
  it('uses the canonical email as the stable CDP identity seed', () => {
    const first = buildCoinbaseEndUserIdentity({
      profileId: 'profile_1',
      externalSubject: 'firebase:user-123',
      email: 'Player@One.com'
    });
    const second = buildCoinbaseEndUserIdentity({
      profileId: 'profile_99',
      externalSubject: 'firebase:user-123',
      email: 'player@one.com'
    });

    expect(first.userId).toBe(second.userId);
    expect(first.authenticationMethods).toEqual([{ type: 'email', email: 'player@one.com' }]);
    expect(first.userId).toMatch(/^[A-Za-z0-9-]{1,100}$/);
  });

  it('falls back to the external subject when no email is available', () => {
    const result = buildCoinbaseEndUserIdentity({
      profileId: 'profile_1',
      externalSubject: 'local:codex-admin',
      email: ''
    });

    expect(result.authenticationMethods).toEqual([{ type: 'jwt', kid: 'arena-runtime', sub: 'local:codex-admin' }]);
    expect(result.userId).toMatch(/^local-codex-admin-/);
  });

  it('keeps the generated user id within the CDP format limit', () => {
    const result = buildCoinbaseEndUserIdentity({
      profileId: 'profile_1',
      externalSubject: 'firebase:' + 'x'.repeat(200),
      email: ''
    });

    expect(result.userId.length).toBeLessThanOrEqual(100);
    expect(result.userId).toMatch(/^[A-Za-z0-9-]{1,100}$/);
  });
});

describe('isExistingEndUserConflict', () => {
  it('detects duplicate end-user errors from CDP', () => {
    expect(isExistingEndUserConflict(new Error('End user with the given user ID already exists.'))).toBe(true);
    expect(isExistingEndUserConflict(new Error('something else'))).toBe(false);
  });
});
