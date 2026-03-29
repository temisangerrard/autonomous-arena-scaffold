const AUTH_KEY = 'arena_auth_user';

const ctaRoot = document.getElementById('welcome-session-cta');
const authError = document.getElementById('welcome-auth-error');
const adminToggle = document.getElementById('admin-toggle');
const adminPanel = document.getElementById('admin-panel');
const adminLoginBtn = document.getElementById('admin-login-btn');
const adminUsername = document.getElementById('admin-username');
const adminPassword = document.getElementById('admin-password');
const adminStatus = document.getElementById('admin-login-status');

let config = {
  authEnabled: false,
  emailAuthEnabled: false,
  googleAuthEnabled: false,
  googleClientId: '',
  firebaseGoogleAuthEnabled: false,
  firebaseWebApiKey: '',
  firebaseAuthDomain: '',
  firebaseProjectId: '',
  localAuthEnabled: true
};

let firebaseGoogleClientPromise = null;
let legacyGoogleInitInFlight = false;

function setStoredUser(user) {
  if (user) {
    localStorage.setItem(AUTH_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(AUTH_KEY);
  }
}

async function requestJson(path, init = {}) {
  const headers = new Headers(init.headers || {});
  let response;
  let fetchError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetch(path, {
        credentials: 'include',
        cache: init.cache || 'no-store',
        ...init,
        headers
      });
      fetchError = null;
      break;
    } catch (error) {
      fetchError = error;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }
  if (!response) {
    throw new Error(fetchError ? `network_unreachable:${String(fetchError.message || fetchError)}` : 'network_unreachable');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.reason || `status_${response.status}`);
  }
  return payload;
}

function showAuthError(message) {
  if (authError) {
    authError.textContent = message || '';
  }
}

function firebaseClientEnabled() {
  return Boolean(config.firebaseWebApiKey && config.firebaseAuthDomain);
}

function firebaseGoogleEnabled() {
  return Boolean(config.firebaseGoogleAuthEnabled) && firebaseClientEnabled();
}

function legacyGoogleEnabled() {
  return Boolean(config.googleAuthEnabled && config.googleClientId);
}

async function getFirebaseGoogleClient() {
  if (firebaseGoogleClientPromise) {
    return firebaseGoogleClientPromise;
  }
  firebaseGoogleClientPromise = (async () => {
    const firebase = await import('./lib/firebase-browser-auth.js');
    const { auth, provider, authMod } = await firebase.getFirebaseBrowserClient(config);
    return { auth, provider, signInWithPopup: authMod.signInWithPopup };
  })();
  return firebaseGoogleClientPromise;
}

async function loadLegacyGoogleScriptIfNeeded() {
  if (!legacyGoogleEnabled() || window.google?.accounts?.id) {
    return;
  }
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  }).catch(() => undefined);
}

async function logout() {
  try {
    await requestJson('/api/player/presence', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'offline' })
    });
  } catch {
    // best-effort
  }
  try {
    await requestJson('/api/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
  } catch {
    // best-effort
  }
  try {
    const firebase = await import('./lib/firebase-browser-auth.js');
    await firebase.signOutFirebaseBrowserSession(config);
  } catch {
    // best-effort
  }
  setStoredUser(null);
  await render();
}

function continueTarget() {
  return '/dashboard';
}

function renderSignedIn(user) {
  if (!ctaRoot) {
    return;
  }
  const initial = (user.name || user.email || '?')[0].toUpperCase();
  const displayName = user.name || user.email;
  ctaRoot.innerHTML = `
    <div class="auth-card auth-card--signed-in">
      <div class="auth-avatar">${initial}</div>
      <div class="auth-user-info">
        <p class="auth-user-name">${displayName}</p>
        <p class="auth-user-role">${user.role}</p>
      </div>
      <div class="auth-signed-in-actions">
        <a class="land-cta-primary" href="/play?world=mega">Enter Arena</a>
        <a class="land-cta-secondary" href="${continueTarget()}">Open Control Hub</a>
        <button id="welcome-logout" class="auth-logout-btn" type="button">Logout</button>
      </div>
    </div>
  `;
  ctaRoot.querySelector('#welcome-logout')?.addEventListener('click', () => {
    void logout();
  });
}

const GOOGLE_LOGO_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
</svg>`;

function renderSignedOut() {
  if (!ctaRoot) {
    return;
  }

  const emailEnabled = Boolean(config.emailAuthEnabled);
  const firebaseGoogle = firebaseGoogleEnabled();
  const legacyGoogle = legacyGoogleEnabled() && !firebaseGoogle;
  const googleEnabled = firebaseGoogle || legacyGoogle;

  if (!emailEnabled && !googleEnabled) {
    ctaRoot.innerHTML = `
      <div class="auth-card">
        <p class="auth-card__heading">Arena access offline</p>
        <p class="auth-card__label">Sign-in is not configured in this environment. You can still preview the world or jump into the public shell.</p>
        <div class="auth-unconfigured-actions">
          <a class="land-cta-primary" href="/play?world=mega">Enter Arena</a>
          <a class="land-cta-secondary" href="/viewer?world=mega">Preview World</a>
        </div>
      </div>
    `;
    return;
  }

  ctaRoot.innerHTML = `
    <div class="auth-card">
      <p class="auth-card__heading">Enter AutoBett</p>
      <p class="auth-card__label">Sign in to enter live dealer rounds, track onchain settlement, and manage your bot wallet.</p>

      ${emailEnabled ? `
        <div class="auth-tabs" role="tablist">
          <button class="auth-tab is-active" data-tab="login" role="tab" aria-selected="true">Login</button>
          <button class="auth-tab" data-tab="signup" role="tab" aria-selected="false">Sign Up</button>
        </div>
        <form class="auth-form" id="welcome-auth-form" novalidate>
          <div class="auth-field">
            <label class="auth-label" for="welcome-email">Email</label>
            <input id="welcome-email" class="form-input" type="email" placeholder="you@example.com" autocomplete="email" required>
          </div>
          <div class="auth-field">
            <label class="auth-label" for="welcome-password">Password</label>
            <input id="welcome-password" class="form-input" type="password" placeholder="••••••••" autocomplete="current-password" required>
          </div>
          <button class="auth-submit" type="submit" id="welcome-email-submit">Login</button>
        </form>
      ` : ''}

      ${googleEnabled ? `
        ${emailEnabled ? '<div class="auth-divider"><span>or</span></div>' : ''}
        ${firebaseGoogle ? `<button id="welcome-google-login" class="auth-google-btn" type="button">${GOOGLE_LOGO_SVG}Continue with Google</button>` : ''}
        ${legacyGoogle ? '<div id="google-signin-welcome"></div>' : ''}
      ` : ''}
    </div>
  `;

  if (emailEnabled) {
    ctaRoot.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        ctaRoot.querySelectorAll('.auth-tab').forEach(t => {
          t.classList.remove('is-active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('is-active');
        tab.setAttribute('aria-selected', 'true');
        const mode = tab.dataset.tab;
        const submitBtn = ctaRoot.querySelector('#welcome-email-submit');
        if (submitBtn) submitBtn.textContent = mode === 'login' ? 'Login' : 'Create Account';
        const pwdInput = ctaRoot.querySelector('#welcome-password');
        if (pwdInput) pwdInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
      });
    });

    ctaRoot.querySelector('#welcome-auth-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const activeTab = ctaRoot.querySelector('.auth-tab.is-active')?.dataset.tab || 'login';
      void handleEmailAuth(activeTab);
    });
  }

  if (firebaseGoogle) {
    ctaRoot.querySelector('#welcome-google-login')?.addEventListener('click', () => {
      void handleGoogleFirebaseAuth();
    });
  }

  if (legacyGoogle && window.google?.accounts?.id) {
    void renderLegacyGoogleButton();
  }
}

async function renderLegacyGoogleButton() {
  const mount = document.getElementById('google-signin-welcome');
  if (!mount || !window.google?.accounts?.id || !legacyGoogleEnabled() || legacyGoogleInitInFlight) {
    return;
  }
  legacyGoogleInitInFlight = true;
  try {
    window.google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: (response) => {
        void handleGoogleCredential(response?.credential || '');
      }
    });
    mount.innerHTML = '';
    window.google.accounts.id.renderButton(mount, {
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      width: 260
    });
  } finally {
    legacyGoogleInitInFlight = false;
  }
}

async function handleEmailAuth(mode) {
  showAuthError('');
  const email = String(ctaRoot?.querySelector('#welcome-email')?.value || '').trim().toLowerCase();
  const password = String(ctaRoot?.querySelector('#welcome-password')?.value || '').trim();
  if (!email || !password) {
    showAuthError('Enter email and password.');
    return;
  }
  try {
    const result = firebaseClientEnabled()
      ? await (async () => {
          const firebase = await import('./lib/firebase-browser-auth.js');
          const auth = await firebase.authenticateFirebaseEmail(config, { mode, email, password });
          return requestJson('/api/auth/firebase', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ idToken: auth.idToken })
          });
        })()
      : await requestJson('/api/auth/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password, mode })
        });
    setStoredUser(result.user || null);
    window.location.href = result.redirectTo || '/dashboard';
  } catch (error) {
    showAuthError(`Sign-in failed: ${String(error.message || error)}`);
  }
}

async function handleGoogleFirebaseAuth() {
  showAuthError('');
  try {
    const { auth, provider, signInWithPopup } = await getFirebaseGoogleClient();
    const credential = await signInWithPopup(auth, provider);
    const idToken = await credential.user.getIdToken();
    if (!idToken) {
      throw new Error('id_token_missing');
    }
    const result = await requestJson('/api/auth/firebase', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken })
    });
    setStoredUser(result.user || null);
    window.location.href = result.redirectTo || '/dashboard';
  } catch (error) {
    showAuthError(`Sign-in failed: ${String(error.message || error)}`);
  }
}

async function handleGoogleCredential(credential) {
  showAuthError('');
  try {
    const result = await requestJson('/api/auth/google', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credential })
    });
    setStoredUser(result.user || null);
    window.location.href = result.redirectTo || '/dashboard';
  } catch (error) {
    showAuthError(`Sign-in failed: ${String(error.message || error)}`);
  }
}

async function render() {
  showAuthError('');
  const session = await requestJson(`/api/player/me?optional=1&t=${Date.now()}`).catch(() => null);
  const user = session?.user || null;

  if (user) {
    setStoredUser(user);
    renderSignedIn(user);
  } else {
    setStoredUser(null);
    if (legacyGoogleEnabled()) {
      await loadLegacyGoogleScriptIfNeeded();
    }
    renderSignedOut();
  }
}

adminToggle?.addEventListener('click', () => {
  if (!adminPanel) {
    return;
  }
  const currentlyHidden = adminPanel.hasAttribute('hidden');
  if (currentlyHidden) {
    adminPanel.removeAttribute('hidden');
    adminToggle.textContent = 'Hide admin access';
  } else {
    adminPanel.setAttribute('hidden', 'true');
    adminToggle.textContent = 'Admin access';
  }
});

adminLoginBtn?.addEventListener('click', async () => {
  const username = String(adminUsername?.value || '').trim();
  const password = String(adminPassword?.value || '').trim();
  if (!username || !password) {
    if (adminStatus) {
      adminStatus.textContent = 'Username and password required.';
    }
    return;
  }

  try {
    if (adminStatus) {
      adminStatus.textContent = 'Signing in...';
    }
    const result = await requestJson('/api/auth/local', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    setStoredUser(result.user || null);
    window.location.href = result.redirectTo || '/dashboard';
  } catch (error) {
    if (adminStatus) {
      adminStatus.textContent = `Login failed: ${String(error.message || error)}`;
    }
  }
});

(async function init() {
  try {
    config = await requestJson(`/api/config?t=${Date.now()}`, { cache: 'no-store' });
    config.emailAuthEnabled = Boolean(config.emailAuthEnabled);
    config.googleAuthEnabled = Boolean(config.googleAuthEnabled);
    config.googleClientId = String(config.googleClientId || '');
    config.firebaseGoogleAuthEnabled = Boolean(config.firebaseGoogleAuthEnabled);
    config.firebaseWebApiKey = String(config.firebaseWebApiKey || '');
    config.firebaseAuthDomain = String(config.firebaseAuthDomain || '');
    config.firebaseProjectId = String(config.firebaseProjectId || '');
  } catch {
    config = {
      authEnabled: false,
      emailAuthEnabled: false,
      googleAuthEnabled: false,
      googleClientId: '',
      firebaseGoogleAuthEnabled: false,
      firebaseWebApiKey: '',
      firebaseAuthDomain: '',
      firebaseProjectId: '',
      localAuthEnabled: true
    };
  }

  if (!config.localAuthEnabled) {
    adminToggle?.setAttribute('hidden', 'true');
    adminPanel?.setAttribute('hidden', 'true');
  }

  await render();
})();
