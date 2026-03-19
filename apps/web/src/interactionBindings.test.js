import { describe, expect, it, vi } from 'vitest';
import { bindInteractionUi } from '../public/js/play/runtime/interaction-bindings.js';

function makeEvent(type) {
  return {
    type,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn()
  };
}

function makeTarget() {
  const handlers = new Map();
  return {
    addEventListener: vi.fn((type, handler) => {
      handlers.set(type, handler);
    }),
    dispatch(type, event) {
      const handler = handlers.get(type);
      if (handler) handler(event);
    }
  };
}

describe('interaction bindings', () => {
  it('closes once for mobile pointerup and suppresses bubbling', () => {
    const interactionPrompt = makeTarget();
    const interactionClose = makeTarget();
    const interactionHelpToggle = makeTarget();
    const interactionHelp = { hidden: true };
    const setInteractOpen = vi.fn();

    bindInteractionUi({
      interactionPrompt,
      interactionClose,
      interactionHelpToggle,
      interactionHelp,
      getUiTargetId: () => 'station_npc_host_5',
      setInteractOpen
    });

    const pointerEvent = makeEvent('pointerup');
    interactionClose.dispatch('pointerup', pointerEvent);
    const clickEvent = makeEvent('click');
    interactionClose.dispatch('click', clickEvent);

    expect(setInteractOpen).toHaveBeenCalledTimes(1);
    expect(setInteractOpen).toHaveBeenCalledWith(false);
    expect(pointerEvent.preventDefault).toHaveBeenCalledOnce();
    expect(pointerEvent.stopPropagation).toHaveBeenCalledOnce();
    expect(clickEvent.preventDefault).toHaveBeenCalledOnce();
    expect(clickEvent.stopPropagation).toHaveBeenCalledOnce();
  });
});
