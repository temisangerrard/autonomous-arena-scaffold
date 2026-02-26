const AUTH_KEY = 'arena_auth_user';
const HIDE_SHELL_PATHS = new Set(['/welcome', '/']);
let firebaseGoogleClientPromise = null;

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

async function fetchJson(url, init = {}) {
  const headers = new Headers(init.headers || {});
  let response;
  let fetchError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetch(url, {
        credentials: 'include',
        ...init,
        headers
      });
      fetchError = null;
      break;
    } catch (error) {
      fetchError = error;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
    }
  }
  if (!response) {
    throw new Error(fetchError ? `network_unreachable:${String(fetchError.message || fetchError)}` : 'network_unreachable');
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.reason || `status_${response.status}`);
  }
  return response.json().catch(() => ({}));
}

function firebaseGoogleEnabled(config) {
  return Boolean(
    config?.firebaseGoogleAuthEnabled
    && config?.firebaseWebApiKey
    && config?.firebaseAuthDomain
  );
}

async function getFirebaseGoogleClient(config) {
  if (firebaseGoogleClientPromise) {
    return firebaseGoogleClientPromise;
  }
  firebaseGoogleClientPromise = (async () => {
    const appMod = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js');
    const authMod = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');
    const appName = 'arena-firebase-shell';
    const existing = appMod.getApps().find((item) => item.name === appName);
    const app = existing ?? appMod.initializeApp({
      apiKey: config.firebaseWebApiKey,
      authDomain: config.firebaseAuthDomain,
      projectId: config.firebaseProjectId || undefined
    }, appName);
    const auth = authMod.getAuth(app);
    const provider = new authMod.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return { auth, provider, signInWithPopup: authMod.signInWithPopup };
  })();
  return firebaseGoogleClientPromise;
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

async function handleEmailAuth(mode, config) {
  const authContainer = document.getElementById('global-shell-auth');
  if (!authContainer) {
    return;
  }
  const emailInput = authContainer.querySelector('#shell-email');
  const passwordInput = authContainer.querySelector('#shell-password');
  const statusEl = authContainer.querySelector('#shell-auth-status');
  const email = String(emailInput?.value || '').trim().toLowerCase();
  const password = String(passwordInput?.value || '').trim();

  if (!email || !password) {
    if (statusEl) {
      statusEl.textContent = 'Enter email and password.';
    }
    return;
  }

  if (statusEl) {
    statusEl.textContent = mode === 'signup' ? 'Creating account...' : 'Signing in...';
  }
  try {
    const payload = await fetchJson('/api/auth/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, mode })
    });
    if (!payload?.ok || !payload?.user) {
      throw new Error(payload?.reason || 'auth_failed');
    }
    writeUser(payload.user);
    renderAuthState(config, payload.user);
    if (statusEl) {
      statusEl.textContent = '';
    }
  } catch (error) {
    if (statusEl) {
      statusEl.textContent = `Sign-in failed: ${String(error?.message || error)}`;
    }
  }
}

async function handleGoogleAuth(config) {
  const authContainer = document.getElementById('global-shell-auth');
  const statusEl = authContainer?.querySelector('#shell-auth-status');
  if (statusEl) {
    statusEl.textContent = 'Opening Google...';
  }
  try {
    const { auth, provider, signInWithPopup } = await getFirebaseGoogleClient(config);
    const credential = await signInWithPopup(auth, provider);
    const idToken = await credential.user.getIdToken();
    if (!idToken) {
      throw new Error('id_token_missing');
    }
    const payload = await fetchJson('/api/auth/firebase', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken })
    });
    if (!payload?.ok || !payload?.user) {
      throw new Error(payload?.reason || 'auth_failed');
    }
    writeUser(payload.user);
    renderAuthState(config, payload.user);
    if (statusEl) {
      statusEl.textContent = '';
    }
  } catch (error) {
    if (statusEl) {
      statusEl.textContent = `Sign-in failed: ${String(error?.message || error)}`;
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
  renderAuthState(config, null);
  if (window.location.pathname !== '/welcome' && window.location.pathname !== '/viewer') {
    window.location.href = '/welcome';
  }
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

  const emailEnabled = Boolean(config?.emailAuthEnabled);
  const googleEnabled = firebaseGoogleEnabled(config);
  if (!emailEnabled && !googleEnabled) {
    authContainer.innerHTML = '<span class="global-shell__hint">Sign-in is not configured on this environment.</span>';
    return;
  }

  authContainer.innerHTML = `
    ${emailEnabled ? `
      <div class="global-shell__email-auth">
        <input id="shell-email" class="global-shell__input" type="email" placeholder="email" autocomplete="email">
        <input id="shell-password" class="global-shell__input" type="password" placeholder="password" autocomplete="current-password">
        <button id="shell-email-login" type="button">Email Login</button>
        <button id="shell-email-signup" type="button">Email Signup</button>
        <span id="shell-auth-status" class="global-shell__hint"></span>
      </div>
    ` : ''}
    ${googleEnabled ? '<button id="shell-google-login" type="button">Google Login</button>' : ''}
  `;

  if (emailEnabled) {
    authContainer.querySelector('#shell-email-login')?.addEventListener('click', () => {
      void handleEmailAuth('login', config);
    });
    authContainer.querySelector('#shell-email-signup')?.addEventListener('click', () => {
      void handleEmailAuth('signup', config);
    });
  }
  if (googleEnabled) {
    authContainer.querySelector('#shell-google-login')?.addEventListener('click', () => {
      void handleGoogleAuth(config);
    });
  }
}

async function loadConfig() {
  try {
    return await fetchJson(`/api/config?t=${Date.now()}`, { cache: 'no-store' });
  } catch {
    return {
      authEnabled: false,
      emailAuthEnabled: false,
      firebaseGoogleAuthEnabled: false,
      firebaseWebApiKey: '',
      firebaseAuthDomain: '',
      firebaseProjectId: ''
    };
  }
}

async function getSessionUser() {
  try {
    const response = await fetch('/api/session', { credentials: 'include' });
    if (response.status === 401 || response.status === 403) {
      return { user: null, source: 'server' };
    }
    if (!response.ok) {
      return { user: readUser(), source: 'cache' };
    }
    const data = await response.json().catch(() => null);
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
  const emailEnabled = Boolean(cfg.emailAuthEnabled);
  const googleEnabled = firebaseGoogleEnabled(cfg);
  const finalCfg = {
    ...cfg,
    emailAuthEnabled: emailEnabled,
    firebaseGoogleAuthEnabled: googleEnabled,
    firebaseWebApiKey: String(cfg.firebaseWebApiKey || ''),
    firebaseAuthDomain: String(cfg.firebaseAuthDomain || ''),
    firebaseProjectId: String(cfg.firebaseProjectId || ''),
    authEnabled: emailEnabled || googleEnabled
  };
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

  renderAuthState(finalCfg, readUser());
  window.addEventListener('arena-auth-updated', (event) => {
    renderAuthState(finalCfg, event.detail ?? readUser());
  });
}

if (!__skipAuthShell) {
  void boot();
}
