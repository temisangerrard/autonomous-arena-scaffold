import { describe, expect, it, vi } from 'vitest';
import { initMenu } from '../public/js/play/menu.js';

function makeButton() {
  return {
    handlers: new Map(),
    classList: {
      contains: vi.fn(() => false),
      toggle: vi.fn()
    },
    setAttribute: vi.fn(),
    addEventListener(type, handler) {
      this.handlers.set(type, handler);
    },
    contains() {
      return false;
    }
  };
}

describe('play menu', () => {
  it('opens the player drawer instead of navigating to dashboard', () => {
    const topbarMenuPop = makeButton();
    const topbarMenu = makeButton();
    const menuDashboard = makeButton();
    const menuViewer = makeButton();
    const menuLogout = makeButton();
    const openPlayerDrawer = vi.fn();
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;

    globalThis.document = {
      addEventListener: vi.fn()
    };
    globalThis.window = {
      location: { href: '/play?world=mega' }
    };

    try {
      initMenu(
        {
          topbarMenuPop,
          topbarMenu,
          menuDashboard,
          menuViewer,
          menuLogout,
          onboardingOverlay: null
        },
        {
          queryParams: new URLSearchParams('world=mega'),
          openPlayerDrawer
        }
      );

      menuDashboard.handlers.get('click')?.();
    } finally {
      globalThis.document = originalDocument;
      globalThis.window = originalWindow;
    }

    expect(openPlayerDrawer).toHaveBeenCalledWith(true);
  });
});
