import { describe, expect, it } from 'vitest';
import {
  loadStoredPlayerShell,
  saveStoredPlayerShell,
  clearStoredPlayerShell,
  PLAYER_SHELL_STORAGE_KEY
} from '../public/js/shared/player-shell-storage.js';

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

describe('player shell storage', () => {
  it('round-trips a normalized player shell through shared storage', () => {
    const storage = createStorage();
    const shell = {
      player: { id: 'profile_1', displayName: 'Temisan' },
      walletSummary: { onchain: { tokenBalance: 5.5 } },
      loadedAt: 123
    };

    saveStoredPlayerShell(storage, shell);

    expect(storage.getItem(PLAYER_SHELL_STORAGE_KEY)).toBeTruthy();
    expect(loadStoredPlayerShell(storage)).toMatchObject({
      player: { id: 'profile_1', displayName: 'Temisan' },
      walletSummary: { onchain: { tokenBalance: 5.5 } },
      loadedAt: 123
    });
  });

  it('drops malformed cached payloads cleanly', () => {
    const storage = createStorage();
    storage.setItem(PLAYER_SHELL_STORAGE_KEY, '{bad json');

    expect(loadStoredPlayerShell(storage)).toBeNull();
    expect(storage.getItem(PLAYER_SHELL_STORAGE_KEY)).toBeNull();
  });

  it('can clear stored state explicitly', () => {
    const storage = createStorage();
    saveStoredPlayerShell(storage, { loadedAt: 1 });
    clearStoredPlayerShell(storage);
    expect(storage.getItem(PLAYER_SHELL_STORAGE_KEY)).toBeNull();
  });
});
