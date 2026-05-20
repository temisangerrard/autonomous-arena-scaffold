export function initMenu(dom, { queryParams, openPlayerDrawer }) {
  const { topbarMenuPop, topbarMenu, menuDashboard, menuViewer, menuLogout, topbarLogout } = dom;

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
    setMenuOpen(false);
    if (typeof openPlayerDrawer === 'function') {
      openPlayerDrawer(true);
      return;
    }
    window.location.href = '/dashboard';
  });

  menuViewer?.addEventListener('click', () => {
    const world = queryParams.get('world') || 'mega';
    window.location.href = `/viewer?world=${encodeURIComponent(world)}`;
  });

  async function logout() {
    try {
      await fetch('/api/player/presence', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: 'offline' })
      });
    } catch {
      // best effort
    }
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
  }

  menuLogout?.addEventListener('click', () => {
    void logout();
  });
  topbarLogout?.addEventListener('click', () => {
    setMenuOpen(false);
    void logout();
  });

  document.addEventListener('click', (event) => {
    if (!topbarMenuPop || !topbarMenu) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (topbarMenuPop.contains(target) || topbarMenu.contains(target)) return;
    setMenuOpen(false);
  });
}
