export function initMenu(dom, { queryParams }) {
  const { topbarMenuPop, topbarMenu, menuDashboard, menuViewer, menuHowToPlay, menuLogout, onboardingOverlay } = dom;

  function setMenuOpen(nextOpen) {
    if (!topbarMenuPop) return;
    topbarMenuPop.classList.toggle('open', nextOpen);
    topbarMenuPop.setAttribute('aria-hidden', nextOpen ? 'false' : 'true');
  }

  topbarMenu?.addEventListener('click', (event) => {
    event.stopPropagation();
    const isOpen = Boolean(topbarMenuPop?.classList.contains('open'));
    setMenuOpen(!isOpen);
  });

  menuDashboard?.addEventListener('click', () => {
    window.location.href = '/dashboard';
  });

  menuViewer?.addEventListener('click', () => {
    const world = queryParams.get('world') || 'mega';
    window.location.href = `/viewer?world=${encodeURIComponent(world)}`;
  });

  menuHowToPlay?.addEventListener('click', () => {
    setMenuOpen(false);
    if (onboardingOverlay) {
      // Reset to step 0 and show
      document.querySelectorAll('.onboarding__step').forEach((el) => { el.style.display = 'none'; });
      const step0 = document.querySelector('.onboarding__step[data-step="0"]');
      if (step0) step0.style.display = 'block';
      document.querySelectorAll('.onboarding__dot').forEach((dot, i) => {
        dot.classList.toggle('active', i === 0);
        dot.classList.remove('completed');
      });
      onboardingOverlay.classList.add('visible');
    }
  });

  menuLogout?.addEventListener('click', async () => {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      });
    } catch {
      // best effort
    }
    window.location.href = '/welcome';
  });

  document.addEventListener('click', (event) => {
    if (!topbarMenuPop || !topbarMenu) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (topbarMenuPop.contains(target) || topbarMenu.contains(target)) return;
    setMenuOpen(false);
  });
}

