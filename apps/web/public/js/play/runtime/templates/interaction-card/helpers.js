/** Shared button and timer helpers for interaction panels */

const _actionTimers = new Map();
export const DEALER_PREFLIGHT_TIMEOUT_MS = 20_000;
export const DEALER_PICK_TIMEOUT_MS = 45_000;

export function startTimer(key, onTimeout, ms) {
  clearTimer(key);
  _actionTimers.set(key, setTimeout(() => {
    _actionTimers.delete(key);
    onTimeout();
  }, ms));
}

export function clearTimer(key) {
  const id = _actionTimers.get(key);
  if (id !== undefined) {
    clearTimeout(id);
    _actionTimers.delete(key);
  }
}

/** Disable a button, store its current text, show pending label, add .is-pending */
export function setPendingBtn(el, pendingText) {
  if (!el) return;
  if (!el.dataset.origText) el.dataset.origText = el.textContent.trim();
  el.textContent = pendingText;
  el.classList.add('is-pending');
  el.disabled = true;
  el.setAttribute('aria-busy', 'true');
}

/** Re-enable a button, restore original text, remove feedback classes */
export function clearPendingBtn(el, fallback) {
  if (!el) return;
  const orig = el.dataset.origText;
  el.textContent = (orig && orig.length > 0) ? orig : (fallback || el.textContent);
  delete el.dataset.origText;
  el.classList.remove('is-pending', 'is-success', 'is-failed');
  el.disabled = false;
  el.removeAttribute('aria-busy');
}

/** Briefly flash .is-success or .is-failed on a button */
export function flashBtn(el, cls, ms = 700) {
  if (!el) return;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

export function showNpcInfoPanel(el) {
  if (!el) return;
  el.hidden = false;
  if (el.style) el.style.display = 'grid';
}

export function hideNpcInfoPanel(el) {
  if (!el) return;
  el.hidden = true;
  if (el.style) el.style.display = 'none';
}
