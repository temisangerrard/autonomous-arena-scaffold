export function createMovementSystem({ THREE, state, socketRef, inputSystem, cameraController }) {
  const moveVec = new THREE.Vector3();

  // De-dupe send similar to legacy behavior.
  let lastSignature = '';
  let lastSentAt = 0;

  function computeDesiredMove() {
    const axes = inputSystem.getAxes();
    if (!axes.active) return { moveX: 0, moveZ: 0 };

    const { forwardFlat, rightFlat } = cameraController.getMoveBasis();
    moveVec
      .set(0, 0, 0)
      .addScaledVector(rightFlat, axes.x)
      .addScaledVector(forwardFlat, axes.z);

    if (moveVec.lengthSq() < 1e-6) return { moveX: 0, moveZ: 0 };

    moveVec.normalize();
    return { moveX: moveVec.x, moveZ: moveVec.z };
  }

  function send(nowMs) {
    const socket = socketRef?.current || null;
    if (!state.wsConnected || !socket || socket.readyState !== WebSocket.OPEN) return;

    const desired = computeDesiredMove();
    const signature = `${desired.moveX.toFixed(2)}:${desired.moveZ.toFixed(2)}`;
    if (signature === lastSignature && nowMs - lastSentAt < 100) return;

    socket.send(JSON.stringify({ type: 'input', ...desired }));
    lastSignature = signature;
    lastSentAt = nowMs;
  }

  return { computeDesiredMove, send };
}

