export const MOVEMENT_KEY_MAP = {
  KeyW: 'forward',
  KeyS: 'backward',
  KeyA: 'left',
  KeyD: 'right',
  ArrowUp: 'forward',
  ArrowDown: 'backward',
  ArrowLeft: 'left',
  ArrowRight: 'right'
};

export function isMovementKey(code) {
  return Object.prototype.hasOwnProperty.call(MOVEMENT_KEY_MAP, code);
}

export function applyMovementKey(state, code, value) {
  const action = MOVEMENT_KEY_MAP[code];
  if (action) {
    state.input[action] = value;
    return true;
  }
  return false;
}

export function resetKeyboardInput(state) {
  state.input.forward = false;
  state.input.backward = false;
  state.input.left = false;
  state.input.right = false;
}
