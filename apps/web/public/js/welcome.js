const AUTH_KEY = 'arena_auth_user';

const ctaRoot = document.getElementById('welcome-session-cta');
const hint = document.getElementById('welcome-hint');
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
  firebaseGoogleAuthEnabled: false,
  firebaseWebApiKey: '',
  firebaseAuthDomain: '',
  firebaseProjectId: '',
  localAuthEnabled: true
};
let firebaseGoogleClientPromise = null;

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
        continue;
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

function firebaseGoogleEnabled() {
  return Boolean(
    config.firebaseGoogleAuthEnabled
    && config.firebaseWebApiKey
    && config.firebaseAuthDomain
  );
}

async function getFirebaseGoogleClient() {
  if (firebaseGoogleClientPromise) {
    return firebaseGoogleClientPromise;
  }
  firebaseGoogleClientPromise = (async () => {
    const appMod = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js');
    const authMod = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');
    const appName = 'arena-firebase-welcome';
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

async function logout() {
  try {
    await requestJson('/api/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
  } catch {
    // best-effort
  }
  setStoredUser(null);
  await render();
}

function continueTarget(user) {
  // Always go to dashboard; admin tools can be opened from there.
  return '/dashboard';
}

function renderSignedIn(user) {
  if (!ctaRoot || !hint) {
    return;
  }
  hint.textContent = `Signed in as ${user.name || user.email} (${user.role}).`;
  ctaRoot.innerHTML = `
    <a class="btn btn--primary" href="/play?world=mega">Enter Arena</a>
    <a class="btn btn--secondary" href="${continueTarget(user)}">Open Dashboard</a>
    <button id="welcome-logout" class="btn btn--ghost" type="button">Logout</button>
  `;
  ctaRoot.querySelector('#welcome-logout')?.addEventListener('click', () => {
    void logout();
  });
}

function renderSignedOut() {
  if (!ctaRoot || !hint) {
    return;
  }

  const emailEnabled = Boolean(config.emailAuthEnabled);
  const googleEnabled = firebaseGoogleEnabled();
  if (!emailEnabled && !googleEnabled) {
    hint.textContent = 'Sign-in is not configured in this environment.';
    ctaRoot.innerHTML = '<a class="btn btn--primary" href="/play?world=mega">Enter Arena</a><a class="btn btn--secondary" href="/viewer?world=mega">Explore Viewer</a>';
    return;
  }

  hint.textContent = 'Sign in to create your player bot and wallet.';
  ctaRoot.innerHTML = `
    <a class="btn btn--primary" href="/play?world=mega">Enter Arena</a>
    ${emailEnabled ? `
      <div class="welcome-email-auth">
        <input id="welcome-email" class="form-input" type="email" placeholder="Email" autocomplete="email">
        <input id="welcome-password" class="form-input" type="password" placeholder="Password" autocomplete="current-password">
        <div class="welcome-email-auth__actions">
          <button id="welcome-email-login" class="btn btn--secondary" type="button">Email Login</button>
          <button id="welcome-email-signup" class="btn btn--secondary" type="button">Email Signup</button>
        </div>
      </div>
    ` : ''}
    ${googleEnabled ? '<button id="welcome-google-login" class="btn btn--secondary" type="button">Continue with Google</button>' : ''}
  `;
  if (emailEnabled) {
    ctaRoot.querySelector('#welcome-email-login')?.addEventListener('click', () => {
      void handleEmailAuth('login');
    });
    ctaRoot.querySelector('#welcome-email-signup')?.addEventListener('click', () => {
      void handleEmailAuth('signup');
    });
  }
  if (googleEnabled) {
    ctaRoot.querySelector('#welcome-google-login')?.addEventListener('click', () => {
      void handleGoogleFirebaseAuth();
    });
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
    const result = await requestJson('/api/auth/email', {
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

async function render() {
  showAuthError('');
  const session = await requestJson(`/api/session?optional=1&t=${Date.now()}`).catch(() => null);
  const user = session?.user || null;

  if (user) {
    setStoredUser(user);
    renderSignedIn(user);
  } else {
    setStoredUser(null);
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
    config.firebaseGoogleAuthEnabled = Boolean(config.firebaseGoogleAuthEnabled);
    config.firebaseWebApiKey = String(config.firebaseWebApiKey || '');
    config.firebaseAuthDomain = String(config.firebaseAuthDomain || '');
    config.firebaseProjectId = String(config.firebaseProjectId || '');
  } catch {
    config = {
      authEnabled: false,
      emailAuthEnabled: false,
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
