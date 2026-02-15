export function createInputSystem({
  state,
  dom,
  actions
}) {
  const { canvas } = dom;
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Missing #scene canvas');
  }

  const keyMap = {
    KeyW: 'forward',
    KeyS: 'backward',
    KeyA: 'left',
    KeyD: 'right',
    ArrowUp: 'forward',
    ArrowDown: 'backward',
    ArrowLeft: 'left',
    ArrowRight: 'right'
  };

  function onKeyDown(event) {
    const target = event.target;
    const editing =
      target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || (target instanceof HTMLElement && target.isContentEditable);
    const allowDuringEditing =
      event.code === 'KeyY'
      || event.code === 'KeyN'
      || event.code === 'KeyO'
      || event.code === 'Digit1'
      || event.code === 'Digit2'
      || event.code === 'Digit3'
      || event.code === 'KeyH'
      || event.code === 'KeyT'
      || event.code === 'Escape'
      || event.code === 'KeyE'
      || event.code === 'Tab';
    if (editing && !allowDuringEditing) {
      return;
    }
    const action = keyMap[event.code];
    if (action) {
      state.input[action] = true;
      event.preventDefault();
    }

    if (event.code === 'KeyF') {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => undefined);
      } else {
        document.exitFullscreen().catch(() => undefined);
      }
    }

    if (event.code === 'KeyR') {
      actions.resetCameraBehindPlayer?.();
    }

    if (event.code === 'KeyC') {
      if (state.ui?.interactOpen) actions.sendChallenge?.();
      else actions.setInteractOpen?.(true);
    }

    if (event.code === 'KeyE') {
      if (!actions.getUiTargetId?.()) return;
      event.preventDefault();
      actions.setInteractOpen?.(!state.ui.interactOpen);
    }

    if (event.code === 'Tab') {
      event.preventDefault();
      actions.cycleNearbyTarget?.(!event.shiftKey);
    }

    if (event.code === 'Escape') {
      actions.setInteractOpen?.(false);
    }

    if (event.code === 'KeyY') actions.respondToIncoming?.(true);
    if (event.code === 'KeyN') actions.respondToIncoming?.(false);
    if (event.code === 'KeyO') actions.sendCounterOffer?.();

    if (event.code === 'Digit1') {
      event.preventDefault();
      actions.sendGameMove?.('rock');
    }
    if (event.code === 'Digit2') {
      event.preventDefault();
      actions.sendGameMove?.('paper');
    }
    if (event.code === 'Digit3') {
      event.preventDefault();
      actions.sendGameMove?.('scissors');
    }
    if (event.code === 'KeyH') {
      event.preventDefault();
      actions.sendGameMove?.('heads');
    }
    if (event.code === 'KeyT') {
      event.preventDefault();
      actions.sendGameMove?.('tails');
    }
  }

  function onKeyUp(event) {
    const target = event.target;
    const editing =
      target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || (target instanceof HTMLElement && target.isContentEditable);
    if (editing) return;
    const action = keyMap[event.code];
    if (action) {
      state.input[action] = false;
      event.preventDefault();
    }
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // Orbit drag
  let dragging = false;
  let dragPointerId = null;
  let lastPointerX = 0;
  let lastPointerY = 0;

  function onPointerDown(event) {
    const isTouch = event.pointerType === 'touch';
    const isRightMouse = event.pointerType === 'mouse' && (event.button === 2 || (event.buttons & 2) === 2);
    const isLeftMouseWithShift = event.pointerType === 'mouse' && event.button === 0 && event.shiftKey;
    const allowMouseOrbit = isRightMouse || isLeftMouseWithShift;
    if (isTouch && state.touch?.stickActive) return;
    if (!isTouch && !allowMouseOrbit) return;

    dragging = true;
    dragPointerId = event.pointerId;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    canvas.setPointerCapture?.(event.pointerId);
  }

  function onContextMenu(event) {
    event.preventDefault();
  }

  function onPointerUp(event) {
    if (dragPointerId !== null && event.pointerId !== dragPointerId) return;
    dragging = false;
    dragPointerId = null;
  }

  function onPointerLeave() {
    dragging = false;
    dragPointerId = null;
  }

  function onPointerMove(event) {
    if (!dragging) return;
    if (dragPointerId !== null && event.pointerId !== dragPointerId) return;

    const dx = event.clientX - lastPointerX;
    const dy = event.clientY - lastPointerY;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;

    state.cameraYaw += dx * 0.006;
    if (Number.isFinite(state.cameraYaw)) {
      const twoPi = Math.PI * 2;
      state.cameraYaw = ((state.cameraYaw % twoPi) + twoPi) % twoPi;
    }
    state.cameraPitch = Math.min(0.85, Math.max(0.1, state.cameraPitch - dy * 0.004));
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('pointermove', onPointerMove);

  // Wheel zoom
  const MIN_CAMERA_DISTANCE = 2;
  const MAX_CAMERA_DISTANCE = 15;
  function onWheel(event) {
    event.preventDefault();
    const delta = event.deltaY > 0 ? 0.5 : -0.5;
    state.cameraDistance = Math.max(
      MIN_CAMERA_DISTANCE,
      Math.min(MAX_CAMERA_DISTANCE, state.cameraDistance + delta)
    );
  }
  canvas.addEventListener('wheel', onWheel, { passive: false });

  // Mobile controls
  function setStickKnob(dx, dy) {
    if (!dom.mobileStickKnob) return;
    dom.mobileStickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  function resetMobileStick() {
    state.touch.stickActive = false;
    state.touch.pointerId = null;
    state.touch.moveX = 0;
    state.touch.moveZ = 0;
    setStickKnob(0, 0);
  }

  function initMobileControls() {
    if (!dom.mobileControls || !dom.mobileStick) return;
    const isCoarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    if (!isCoarse) {
      dom.mobileControls.setAttribute('aria-hidden', 'true');
      return;
    }
    dom.mobileControls.setAttribute('aria-hidden', 'false');

    dom.mobileStick.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = dom.mobileStick.getBoundingClientRect();
      state.touch.stickActive = true;
      state.touch.pointerId = event.pointerId;
      state.touch.startX = event.clientX - rect.left - rect.width / 2;
      state.touch.startY = event.clientY - rect.top - rect.height / 2;
      dom.mobileStick.setPointerCapture?.(event.pointerId);
    });

    dom.mobileStick.addEventListener('pointermove', (event) => {
      if (!state.touch.stickActive || state.touch.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = dom.mobileStick.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = event.clientX - cx;
      const dy = event.clientY - cy;

      const radius = 44;
      const len = Math.max(0.0001, Math.hypot(dx, dy));
      const clampedLen = Math.min(radius, len);
      const nx = (dx / len) * clampedLen;
      const ny = (dy / len) * clampedLen;
      setStickKnob(nx, ny);

      const moveX = nx / radius;
      const moveZ = -ny / radius;
      state.touch.moveX = Math.max(-1, Math.min(1, moveX));
      state.touch.moveZ = Math.max(-1, Math.min(1, moveZ));
    });

    const end = (event) => {
      if (!state.touch.stickActive) return;
      if (state.touch.pointerId !== null && event.pointerId !== state.touch.pointerId) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      resetMobileStick();
    };

    dom.mobileStick.addEventListener('pointerup', end);
    dom.mobileStick.addEventListener('pointercancel', end);
    window.addEventListener('blur', () => resetMobileStick());

    dom.mobileInteract?.addEventListener('click', () => {
      if (!actions.getUiTargetId?.()) return;
      actions.setInteractOpen?.(true);
    });
    dom.mobileSend?.addEventListener('click', () => {
      if (!state.ui.interactOpen) actions.setInteractOpen?.(true);
      actions.sendChallenge?.();
    });
    dom.mobileAccept?.addEventListener('click', () => actions.respondToIncoming?.(true));
    dom.mobileDecline?.addEventListener('click', () => actions.respondToIncoming?.(false));
    dom.mobileCounter?.addEventListener('click', () => actions.sendCounterOffer?.());

    dom.mobileMove1?.addEventListener('click', () => actions.sendGameMove?.('rock'));
    dom.mobileMove2?.addEventListener('click', () => actions.sendGameMove?.('paper'));
    dom.mobileMove3?.addEventListener('click', () => actions.sendGameMove?.('scissors'));
    dom.mobileMoveH?.addEventListener('click', () => actions.sendGameMove?.('heads'));
    dom.mobileMoveT?.addEventListener('click', () => actions.sendGameMove?.('tails'));
  }

  initMobileControls();

  function getAxes() {
    const keyboardRight = (state.input.right ? 1 : 0) - (state.input.left ? 1 : 0);
    const keyboardForward = (state.input.forward ? 1 : 0) - (state.input.backward ? 1 : 0);
    const touchRight = Number(state.touch?.moveX ?? 0);
    const touchForward = Number(state.touch?.moveZ ?? 0);
    const inputRight = Math.max(-1, Math.min(1, keyboardRight + touchRight));
    const inputForward = Math.max(-1, Math.min(1, keyboardForward + touchForward));
    const length = Math.hypot(inputRight, inputForward);

    return {
      x: length < 0.001 ? 0 : inputRight / length,
      z: length < 0.001 ? 0 : inputForward / length,
      active: length >= 0.001
    };
  }

  function dispose() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('contextmenu', onContextMenu);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('wheel', onWheel);
  }

  return { getAxes, dispose };
}
