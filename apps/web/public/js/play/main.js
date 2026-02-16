// Refactor entrypoint: keep /js/play.js stable while we decompose the old monolith.
import './legacy.js';

function shouldRegisterWorldCacheSw() {
  if (!('serviceWorker' in navigator)) return false;
  if (!window.isSecureContext) return false;
  const path = String(window.location.pathname || '');
  return path === '/play' || path.endsWith('/play.html');
}

async function registerWorldCacheSw() {
  if (!shouldRegisterWorldCacheSw()) {
    return;
  }
  try {
    const registration = await navigator.serviceWorker.register('/sw-world-cache.js');
    console.debug('[world-cache] sw_registered', registration.scope);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.debug('[world-cache] sw_controller_changed');
    });
  } catch (error) {
    console.error('[world-cache] sw_register_error', String(error || 'unknown'));
  }
}

void registerWorldCacheSw();
