export function resolveOnboardingCompleted({ serverCompleted, localCompleted }) {
  if (typeof serverCompleted === 'boolean') {
    return serverCompleted;
  }
  return Boolean(localCompleted);
}

