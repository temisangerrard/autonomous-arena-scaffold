import { describe, expect, it } from 'vitest';
import { resolveOnboardingCompleted } from '../public/js/play/ui/onboarding-state.js';

describe('resolveOnboardingCompleted', () => {
  it('prefers server-completed when available', () => {
    expect(resolveOnboardingCompleted({ serverCompleted: true, localCompleted: false })).toBe(true);
    expect(resolveOnboardingCompleted({ serverCompleted: false, localCompleted: true })).toBe(false);
  });

  it('falls back to local completion when server state is unavailable', () => {
    expect(resolveOnboardingCompleted({ serverCompleted: null, localCompleted: true })).toBe(true);
    expect(resolveOnboardingCompleted({ serverCompleted: undefined, localCompleted: false })).toBe(false);
  });
});
