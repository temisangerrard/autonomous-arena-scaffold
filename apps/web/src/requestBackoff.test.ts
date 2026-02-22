import { describe, expect, test } from 'vitest';
import {
  clearRequestBackoff,
  isRequestBackoffActive,
  setRequestBackoffFromError
} from '../public/js/shared/request-backoff.js';

type MemoryStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function makeStorage(): MemoryStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    }
  };
}

describe('request backoff', () => {
  test('activates backoff from 429 error default window', () => {
    const storage = makeStorage();
    const now = 1_000;
    const until = setRequestBackoffFromError(storage, 'wallet', { status: 429 }, now);
    expect(until).toBe(now + 60_000);
    expect(isRequestBackoffActive(storage, 'wallet', now + 59_000)).toBe(true);
    expect(isRequestBackoffActive(storage, 'wallet', now + 60_001)).toBe(false);
  });

  test('respects retryAfterMs when present', () => {
    const storage = makeStorage();
    const now = 2_000;
    const until = setRequestBackoffFromError(storage, 'wallet', { status: 429, retryAfterMs: 12_000 }, now);
    expect(until).toBe(now + 12_000);
  });

  test('clears active backoff', () => {
    const storage = makeStorage();
    const now = 3_000;
    setRequestBackoffFromError(storage, 'wallet', { status: 503 }, now);
    expect(isRequestBackoffActive(storage, 'wallet', now + 1_000)).toBe(true);
    clearRequestBackoff(storage, 'wallet');
    expect(isRequestBackoffActive(storage, 'wallet', now + 1_000)).toBe(false);
  });
});
