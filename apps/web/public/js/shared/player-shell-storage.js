import { mergePlayerShell } from './player-shell.js';

export const PLAYER_SHELL_STORAGE_KEY = 'arena_player_shell_v1';

export function loadStoredPlayerShell(storage) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  try {
    const raw = storage.getItem(PLAYER_SHELL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      storage.removeItem?.(PLAYER_SHELL_STORAGE_KEY);
      return null;
    }
    return mergePlayerShell({}, parsed);
  } catch {
    storage.removeItem?.(PLAYER_SHELL_STORAGE_KEY);
    return null;
  }
}

export function saveStoredPlayerShell(storage, shell) {
  if (!storage || typeof storage.setItem !== 'function' || !shell || typeof shell !== 'object') return;
  try {
    const normalized = mergePlayerShell({}, shell);
    storage.setItem(PLAYER_SHELL_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // ignore storage quota/privacy mode failures
  }
}

export function clearStoredPlayerShell(storage) {
  if (!storage || typeof storage.removeItem !== 'function') return;
  try {
    storage.removeItem(PLAYER_SHELL_STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
}
