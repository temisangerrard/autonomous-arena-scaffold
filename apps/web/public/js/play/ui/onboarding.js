const ONBOARDING_KEY = 'arena_onboarding_completed';
const ONBOARDING_STEPS = 4;

export function initOnboarding(dom, { showToast, announce }) {
  const overlay = dom.onboardingOverlay;
  const progress = dom.onboardingProgress;
  if (!overlay) return;

  const completedAtInit = localStorage.getItem(ONBOARDING_KEY) === 'true';
  let onboardingStep = 0;

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
    const alreadyCompleted = localStorage.getItem(ONBOARDING_KEY) === 'true';
    localStorage.setItem(ONBOARDING_KEY, 'true');
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

  overlay.classList.add('visible');
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
  if (!completedAtInit) {
    overlay.classList.add('visible');
  }
}
