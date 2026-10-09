export function createControls(canvas, joystick, stick, onLook) {
  const keys = new Set();
  let touchX = 0,
    touchY = 0,
    joystickPointer = null,
    lookPointer = null,
    lastX = 0;
  const blocked = () => Boolean(document.querySelector('dialog[open]'));
  function reset() {
    keys.clear();
    touchX = touchY = 0;
    joystickPointer = lookPointer = null;
    stick.style.transform = '';
  }
  window.addEventListener('keydown', (e) => {
    if (blocked() || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code))
      e.preventDefault();
    keys.add(e.code);
    if (e.code === 'KeyF' && !e.repeat) {
      if (document.fullscreenElement)
        document.exitFullscreen?.().catch(() => {});
      else document.documentElement.requestFullscreen?.().catch(() => {});
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', reset);
  canvas.addEventListener('pointerdown', (e) => {
    if (blocked() || lookPointer !== null) return;
    lookPointer = e.pointerId;
    lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookPointer) return;
    onLook((e.clientX - lastX) * 0.006);
    lastX = e.clientX;
  });
  const stopLook = (e) => {
    if (e.pointerId === lookPointer) lookPointer = null;
  };
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((type) =>
    canvas.addEventListener(type, stopLook)
  );
  function moveStick(e) {
    const r = joystick.getBoundingClientRect(),
      radius = r.width * 0.3;
    let x = e.clientX - r.left - r.width / 2,
      y = e.clientY - r.top - r.height / 2;
    const length = Math.hypot(x, y);
    if (length > radius) {
      x *= radius / length;
      y *= radius / length;
    }
    touchX = x / radius;
    touchY = y / radius;
    stick.style.transform = `translate(${x}px,${y}px)`;
  }
  joystick.addEventListener('pointerdown', (e) => {
    if (blocked() || joystickPointer !== null) return;
    e.preventDefault();
    joystickPointer = e.pointerId;
    joystick.setPointerCapture(e.pointerId);
    moveStick(e);
  });
  joystick.addEventListener('pointermove', (e) => {
    if (e.pointerId === joystickPointer) moveStick(e);
  });
  const stopStick = (e) => {
    if (e.pointerId !== joystickPointer) return;
    joystickPointer = null;
    touchX = touchY = 0;
    stick.style.transform = '';
  };
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((type) =>
    joystick.addEventListener(type, stopStick)
  );
  return {
    reset,
    read() {
      if (blocked()) return { x: 0, z: 0, run: false };
      let x =
        touchX +
        Number(keys.has('KeyD') || keys.has('ArrowRight')) -
        Number(keys.has('KeyA') || keys.has('ArrowLeft'));
      let z =
        touchY +
        Number(keys.has('KeyS') || keys.has('ArrowDown')) -
        Number(keys.has('KeyW') || keys.has('ArrowUp'));
      const len = Math.hypot(x, z);
      if (len > 1) {
        x /= len;
        z /= len;
      }
      return { x, z, run: keys.has('ShiftLeft') || keys.has('ShiftRight') };
    },
  };
}
