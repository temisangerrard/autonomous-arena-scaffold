import { resolveOnboardingCompleted } from './onboarding-state.js';

const ONBOARDING_KEY = 'arena_onboarding_completed';
const ONBOARDING_STEPS = 4;

export function initOnboarding(dom, { showToast, announce }) {
  const overlay = dom.onboardingOverlay;
  const progress = dom.onboardingProgress;
  if (!overlay) return;

  let onboardingStep = 0;
  let completed = false;

  function readLocalCompleted() {
    try {
      return localStorage.getItem(ONBOARDING_KEY) === 'true';
    } catch {
      return false;
    }
  }

  function writeLocalCompleted(value) {
    try {
      if (value) {
        localStorage.setItem(ONBOARDING_KEY, 'true');
      } else {
        localStorage.removeItem(ONBOARDING_KEY);
      }
    } catch {
      // ignore storage failure
    }
  }

  async function readServerCompleted() {
    try {
      const response = await fetch('/api/player/onboarding', {
        method: 'GET',
        credentials: 'include'
      });
      if (!response.ok) {
        return { completed: null };
      }
      const payload = await response.json();
      if (!payload || payload.ok !== true || typeof payload.completed !== 'boolean') {
        return { completed: null };
      }
      return { completed: payload.completed };
    } catch {
      return { completed: null };
    }
  }

  async function markServerCompleted() {
    try {
      await fetch('/api/player/onboarding/complete', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ completedAt: Date.now() })
      });
    } catch {
      // best effort
    }
  }

  function updateProgress() {
    if (!progress) return;
    document.querySelectorAll('.onboarding__dot').forEach((dot, index) => {
      dot.classList.remove('active', 'completed');
      if (index < onboardingStep) dot.classList.add('completed');
      else if (index === onboardingStep) dot.classList.add('active');
    });
  }

  function showStep(step) {
    const clamped = Math.max(0, Math.min(ONBOARDING_STEPS - 1, Number(step) || 0));
    onboardingStep = clamped;
    document.querySelectorAll('.onboarding__step').forEach((el) => {
      el.style.display = 'none';
    });
    const current = document.querySelector(`.onboarding__step[data-step="${onboardingStep}"]`);
    if (current) current.style.display = 'block';
    updateProgress();
    const title = current?.querySelector('.onboarding__title')?.textContent || '';
    announce?.(`Step ${onboardingStep + 1}: ${title}`);
  }

  function complete() {
    const alreadyCompleted = completed || readLocalCompleted();
    completed = true;
    writeLocalCompleted(true);
    void markServerCompleted();
    overlay.classList.remove('visible');
    if (!alreadyCompleted) {
      showToast?.('Welcome to the Arena! Good luck!', 'success');
    }
  }

  function openOnboarding(step = 0) {
    showStep(step);
    overlay.classList.add('visible');
  }

  function handleAction(event) {
    const action = event.target?.dataset?.action;
    if (action === 'next') {
      if (onboardingStep < ONBOARDING_STEPS - 1) {
        showStep(onboardingStep + 1);
      }
      return;
    }
    if (action === 'prev') {
      if (onboardingStep > 0) {
        showStep(onboardingStep - 1);
      }
      return;
    }
    if (action === 'start') {
      complete();
    }
  }

  document.querySelectorAll('.onboarding__btn').forEach((btn) => {
    btn.addEventListener('click', handleAction);
  });
  const skip = document.getElementById('skip-tutorial');
  skip?.addEventListener('click', (e) => {
    e.preventDefault();
    complete();
  });

  dom.openOnboarding = (step = 0) => openOnboarding(step);
  dom.closeOnboarding = () => overlay.classList.remove('visible');

  showStep(0);
  overlay.classList.remove('visible');

  void (async () => {
    const localCompleted = readLocalCompleted();
    const serverState = await readServerCompleted();
    completed = resolveOnboardingCompleted({
      serverCompleted: serverState.completed,
      localCompleted
    });
    // One-time migration path for legacy local completion into account-backed state.
    if (!completed && serverState.completed === false && localCompleted) {
      completed = true;
      void markServerCompleted();
    }
    if (!completed) {
      overlay.classList.add('visible');
    }
  })();
}
