const AUTH_KEY = 'arena_auth_user';
const CLIENT_KEY = 'arena_google_client_id';
const SID_KEY = 'arena_sid_fallback';
const HIDE_SHELL_PATHS = new Set(['/welcome', '/']);

// Test harness can load pages without going through auth.
// Skip auth-shell behavior (including Google scripts) to avoid noisy console errors.
const __authParams = new URL(window.location.href).searchParams;
const __skipAuthShell = __authParams.get('test') === '1';
if (__skipAuthShell) {
  // Ensure we don't leave a stale nav visible from previous pages.
  document.getElementById('global-shell-nav')?.remove();
}

function shouldHideShell(pathname) {
  if (HIDE_SHELL_PATHS.has(pathname)) {
    return true;
  }
  return pathname === '/play' || pathname === '/play/' || pathname === '/viewer' || pathname === '/viewer/' || pathname === '/dashboard' || pathname === '/dashboard/';
}

function readUser() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeUser(user) {
  if (user) {
    localStorage.setItem(AUTH_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(AUTH_KEY);
  }
  window.dispatchEvent(new CustomEvent('arena-auth-updated', { detail: user }));
}

function getSid() {
  return String(localStorage.getItem(SID_KEY) || '').trim();
}

function writeSid(sid) {
  const value = String(sid || '').trim();
  if (value) {
    localStorage.setItem(SID_KEY, value);
  } else {
    localStorage.removeItem(SID_KEY);
  }
}

async function fetchJson(url, init = {}) {
  const headers = new Headers(init.headers || {});
  const sid = getSid();
  if (sid) {
    headers.set('x-arena-sid', sid);
  }
  const response = await fetch(url, {
    credentials: 'include',
    ...init,
    headers
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    if (payload?.sessionId) {
      writeSid(payload.sessionId);
    }
    throw new Error(payload?.reason || `status_${response.status}`);
  }
  const payload = await response.json().catch(() => ({}));
  if (payload?.sessionId) {
    writeSid(payload.sessionId);
  }
  return payload;
}

function currentPath() {
  return window.location.pathname;
}

function ensureShell() {
  if (shouldHideShell(window.location.pathname)) {
    const staleShell = document.getElementById('global-shell-nav');
    staleShell?.remove();
    return null;
  }
  let shell = document.getElementById('global-shell-nav');
  if (shell) {
    return shell;
  }

  shell = document.createElement('div');
  shell.id = 'global-shell-nav';
  shell.className = 'global-shell';
  shell.innerHTML = `
    <div class="global-shell__links" id="global-shell-links"></div>
    <div class="global-shell__auth" id="global-shell-auth"></div>
  `;
  document.body.appendChild(shell);
  return shell;
}

function buildNav(user) {
  const links = [
    { key: 'welcome', href: '/welcome', label: 'Welcome' },
    { key: 'dashboard', href: '/dashboard', label: 'Dashboard' },
    { key: 'play', href: '/play?world=mega', label: 'Play' },
    { key: 'viewer', href: '/viewer?world=mega', label: 'Viewer' }
  ];

  if (user?.role === 'admin') {
    links.push({ key: 'users', href: '/users', label: 'Users' });
    links.push({ key: 'admin', href: '/admin', label: 'Admin' });
  }

  return links;
}

function markActiveLink(user) {
  const linksWrap = document.getElementById('global-shell-links');
  if (!linksWrap) {
    return;
  }

  const links = buildNav(user);
  linksWrap.innerHTML = links
    .map((entry) => `<a data-link="${entry.key}" href="${entry.href}">${entry.label}</a>`)
    .join('');

  const path = currentPath();
  for (const link of linksWrap.querySelectorAll('[data-link]')) {
    if (!(link instanceof HTMLAnchorElement)) {
      continue;
    }
    link.classList.remove('active');
    const key = link.dataset.link;
    if (
      (key === 'welcome' && path === '/welcome') ||
      (key === 'dashboard' && path === '/dashboard') ||
      (key === 'play' && path === '/play') ||
      (key === 'viewer' && path === '/viewer') ||
      (key === 'users' && path === '/users') ||
      (key === 'admin' && (path === '/admin' || path === '/agents'))
    ) {
      link.classList.add('active');
    }
  }
}

async function handleGoogleCredential(response, config) {
  try {
    const payload = await fetchJson('/api/auth/google', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credential: response.credential || '' })
    });
    if (!payload?.ok || !payload?.user) {
      throw new Error(payload?.reason || 'auth_failed');
    }
    writeSid(payload.sessionId || '');
    writeUser(payload.user);
    renderAuthState(config, payload.user);
    if (window.location.pathname === '/welcome' && payload.redirectTo) {
      window.location.href = payload.redirectTo;
    }
  } catch (error) {
    const authContainer = document.getElementById('global-shell-auth');
    if (authContainer) {
      authContainer.innerHTML = `<span class="global-shell__hint">Sign-in failed: ${String((error).message || error)}</span>`;
    }
  }
}

async function handleLogout(config) {
  try {
    await fetchJson('/api/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
  } catch {
    // best effort: clear client state even if request fails
  }
  writeUser(null);
  writeSid('');
  renderAuthState(config, null);
  if (window.location.pathname !== '/welcome' && window.location.pathname !== '/viewer') {
    window.location.href = '/welcome';
  }
}

function renderGoogleButton(config) {
  const authContainer = document.getElementById('global-shell-auth');
  if (!authContainer) {
    return;
  }

  if (!config?.authEnabled || !config?.googleClientId) {
    authContainer.innerHTML = '<span class="global-shell__hint">Set GOOGLE_CLIENT_ID to enable Google login</span>';
    return;
  }

  authContainer.innerHTML = '<div id="google-signin-shell"></div>';
  if (!window.google?.accounts?.id) {
    return;
  }
  window.google.accounts.id.initialize({
    client_id: config.googleClientId,
    callback: (response) => {
      void handleGoogleCredential(response, config);
    }
  });
  window.google.accounts.id.renderButton(document.getElementById('google-signin-shell'), {
    theme: 'outline',
    size: 'small',
    type: 'standard',
    text: 'signin_with'
  });
}

function renderAuthState(config, user) {
  const authContainer = document.getElementById('global-shell-auth');
  if (!authContainer) {
    return;
  }

  markActiveLink(user);

  if (user) {
    authContainer.innerHTML = `
      <span class="global-shell__user">${user.name || user.email || 'Signed in'} · ${user.role || 'player'}</span>
      <button id="shell-logout" type="button">Logout</button>
    `;
    authContainer.querySelector('#shell-logout')?.addEventListener('click', () => {
      void handleLogout(config);
    });
    return;
  }

  renderGoogleButton(config);
}

async function loadConfig() {
  try {
    const cfg = await fetchJson('/api/config');
    if (cfg.googleClientId) {
      localStorage.setItem(CLIENT_KEY, cfg.googleClientId);
    }
    return cfg;
  } catch {
    return { authEnabled: false, googleClientId: '' };
  }
}

async function getSessionUser() {
  try {
    const headers = new Headers();
    const sid = getSid();
    if (sid) {
      headers.set('x-arena-sid', sid);
    }
    const response = await fetch('/api/session', { credentials: 'include', headers });
    if (response.status === 401 || response.status === 403) {
      writeSid('');
      return { user: null, source: 'server' };
    }
    if (!response.ok) {
      return { user: readUser(), source: 'cache' };
    }
    const data = await response.json().catch(() => null);
    if (data?.sessionId) {
      writeSid(data.sessionId);
    }
    return { user: data?.user ?? null, source: 'server' };
  } catch {
    return { user: readUser(), source: 'cache' };
  }
}

async function boot() {
  const shell = ensureShell();
  if (!shell) {
    return;
  }
  const cfg = await loadConfig();
  const clientId = cfg.googleClientId || localStorage.getItem(CLIENT_KEY) || '';
  const finalCfg = { ...cfg, googleClientId: clientId, authEnabled: Boolean(clientId) };
  const session = await getSessionUser();
  if (session.source === 'server') {
    if (session.user) {
      writeUser(session.user);
    } else {
      writeUser(null);
    }
  } else if (!session.user) {
    writeUser(null);
  }

  if (finalCfg.authEnabled && !window.google?.accounts?.id) {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => renderAuthState(finalCfg, readUser());
    document.head.appendChild(script);
  }

  renderAuthState(finalCfg, readUser());
  window.addEventListener('arena-auth-updated', (event) => {
    renderAuthState(finalCfg, event.detail ?? readUser());
  });
}

if (!__skipAuthShell) {
  void boot();
}
