const FIREBASE_APP_NAME = 'arena-firebase-web';

let firebaseClientPromise = null;

export function firebaseClientEnabled(config) {
  return Boolean(config?.firebaseWebApiKey && config?.firebaseAuthDomain);
}

export async function getFirebaseBrowserClient(config) {
  if (!firebaseClientEnabled(config)) {
    throw new Error('firebase_client_auth_disabled');
  }
  if (firebaseClientPromise) {
    return firebaseClientPromise;
  }
  firebaseClientPromise = (async () => {
    const appMod = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js');
    const authMod = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');
    const existing = appMod.getApps().find((item) => item.name === FIREBASE_APP_NAME);
    const app = existing ?? appMod.initializeApp({
      apiKey: String(config.firebaseWebApiKey || ''),
      authDomain: String(config.firebaseAuthDomain || ''),
      projectId: config.firebaseProjectId ? String(config.firebaseProjectId) : undefined
    }, FIREBASE_APP_NAME);
    const auth = authMod.getAuth(app);
    const provider = new authMod.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return { authMod, auth, provider };
  })();
  return firebaseClientPromise;
}

export async function getFirebaseIdToken(config, options = {}) {
  const { forceRefresh = false } = options;
  const { auth } = await getFirebaseBrowserClient(config);
  if (!auth.currentUser) {
    throw new Error('firebase_user_not_signed_in');
  }
  const idToken = await auth.currentUser.getIdToken(forceRefresh);
  if (!idToken) {
    throw new Error('firebase_id_token_missing');
  }
  return idToken;
}

export async function authenticateFirebaseEmail(config, options) {
  const { mode, email, password, displayName = '' } = options;
  const { authMod, auth } = await getFirebaseBrowserClient(config);
  let credential;
  if (mode === 'signup') {
    try {
      credential = await authMod.createUserWithEmailAndPassword(auth, email, password);
      if (displayName.trim()) {
        await authMod.updateProfile(credential.user, { displayName: displayName.trim() });
      }
    } catch (err) {
      if (err?.code === 'auth/email-already-in-use') {
        // Account already exists — sign in instead of surfacing a confusing error
        credential = await authMod.signInWithEmailAndPassword(auth, email, password);
      } else {
        throw err;
      }
    }
  } else {
    credential = await authMod.signInWithEmailAndPassword(auth, email, password);
  }
  const idToken = await credential.user.getIdToken(true);
  if (!idToken) {
    throw new Error('firebase_id_token_missing');
  }
  return {
    idToken,
    user: credential.user
  };
}

export async function authenticateFirebaseGoogle(config) {
  const { auth, provider, authMod } = await getFirebaseBrowserClient(config);
  const credential = await authMod.signInWithPopup(auth, provider);
  const idToken = await credential.user.getIdToken();
  if (!idToken) {
    throw new Error('firebase_id_token_missing');
  }
  return {
    idToken,
    user: credential.user
  };
}

export async function signOutFirebaseBrowserSession(config) {
  if (!firebaseClientEnabled(config)) {
    return;
  }
  const { auth, authMod } = await getFirebaseBrowserClient(config);
  await authMod.signOut(auth);
}
