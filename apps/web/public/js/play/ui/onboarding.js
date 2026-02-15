const ONBOARDING_KEY = 'arena_onboarding_completed';
const ONBOARDING_STEPS = 5;

export function initOnboarding(dom, { showToast, announce }) {
  const overlay = dom.onboardingOverlay;
  const progress = dom.onboardingProgress;
  if (!overlay) return;

  const completed = localStorage.getItem(ONBOARDING_KEY) === 'true';
  if (completed) return;

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
    document.querySelectorAll('.onboarding__step').forEach((el) => {
      el.style.display = 'none';
    });
    const current = document.querySelector(`.onboarding__step[data-step="${step}"]`);
    if (current) current.style.display = 'block';
    updateProgress();
    const title = current?.querySelector('.onboarding__title')?.textContent || '';
    announce?.(`Step ${step + 1}: ${title}`);
  }

  function complete() {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    overlay.classList.remove('visible');
    showToast?.('Welcome to the Arena! Good luck!', 'success');
  }

  function handleAction(event) {
    const action = event.target?.dataset?.action;
    if (action === 'next') {
      if (onboardingStep < ONBOARDING_STEPS - 1) {
        onboardingStep += 1;
        showStep(onboardingStep);
      }
      return;
    }
    if (action === 'prev') {
      if (onboardingStep > 0) {
        onboardingStep -= 1;
        showStep(onboardingStep);
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
  updateProgress();
  showStep(0);
}

