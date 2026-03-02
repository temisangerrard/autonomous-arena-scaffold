import { describe, expect, it } from 'vitest';
import { resolveAuthSubjects } from './authSubjects.js';

describe('resolveAuthSubjects', () => {
  it('uses firebase localId as canonical subject for google-authenticated users when available', () => {
    const result = resolveAuthSubjects({
      provider: 'google',
      googleSub: 'google-sub-123',
      firebaseLocalId: 'firebase-local-456'
    });

    expect(result.canonical).toBe('firebase:firebase-local-456');
    expect(result.aliases).toContain('google:google-sub-123');
    expect(result.aliases).toContain('firebase:firebase-local-456');
  });

  it('falls back to google subject when no firebase localId is available', () => {
    const result = resolveAuthSubjects({
      provider: 'google',
      googleSub: 'google-sub-123'
    });

    expect(result.canonical).toBe('google:google-sub-123');
    expect(result.aliases).toEqual(['google:google-sub-123']);
  });

  it('uses firebase subject for firebase-authenticated users', () => {
    const result = resolveAuthSubjects({
      provider: 'firebase',
      firebaseLocalId: 'firebase-local-456'
    });

    expect(result.canonical).toBe('firebase:firebase-local-456');
    expect(result.aliases).toEqual(['firebase:firebase-local-456']);
  });
});
