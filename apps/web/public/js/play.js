import { THREE, installResizeHandler, loadWorld, makeCamera, makeRenderer, makeScene, pickWorldAlias } from './world-common.js';

const canvas = document.getElementById('scene');
const hud = document.getElementById('hud');
const renderer = makeRenderer(canvas);
const scene = makeScene();
const camera = makeCamera();
installResizeHandler(camera, renderer);

function createAvatar(color) {
  const avatar = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.52, 4, 8), new THREE.MeshStandardMaterial({ color, roughness: 0.75 }));
  torso.position.y = 0.55;
  const head = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.24, 0),
    new THREE.MeshStandardMaterial({ color: 0xffd7b3, roughness: 0.95 })
  );
  head.position.y = 1.16;

  const legMaterial = new THREE.MeshStandardMaterial({ color: 0x2c3d4a, roughness: 0.9 });
  const leftLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.48, 4, 8), legMaterial);
  const rightLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.48, 4, 8), legMaterial);
  leftLeg.position.set(-0.14, -0.02, 0);
  rightLeg.position.set(0.14, -0.02, 0);

  avatar.add(torso, head, leftLeg, rightLeg);
  return { avatar, head, leftLeg, rightLeg };
}

const localAvatarParts = createAvatar(0x3a7bff);
scene.add(localAvatarParts.avatar);

const remoteAvatars = new Map();

const state = {
  worldAlias: pickWorldAlias(),
  worldLoaded: false,
  wsConnected: false,
  playerId: null,
  tick: 0,
  players: new Map(),
  input: {
    forward: false,
    backward: false,
    left: false,
    right: false
  },
  nearbyIds: new Set(),
  incomingChallengeId: null,
  outgoingChallengeId: null,
  challengeStatus: 'none',
  challengeMessage: '',
  challengeFeed: [],
  cameraYawOffset: 0,
  cameraPitch: 0.27
};

const wsUrl = new URL(window.location.href).searchParams.get('ws') ?? `ws://${window.location.hostname}:4000/ws`;
const socket = new WebSocket(wsUrl);

socket.addEventListener('open', () => {
  state.wsConnected = true;
});

socket.addEventListener('close', () => {
  state.wsConnected = false;
});

socket.addEventListener('message', (event) => {
  const payload = JSON.parse(event.data);

  if (payload.type === 'welcome') {
    state.playerId = payload.playerId;
    return;
  }

  if (payload.type === 'snapshot') {
    state.tick = payload.tick;

    const seen = new Set();
    for (const player of payload.players) {
      seen.add(player.id);
      const existing = state.players.get(player.id);
      if (!existing) {
        state.players.set(player.id, {
          id: player.id,
          x: player.x,
          y: player.y,
          z: player.z,
          yaw: player.yaw,
          speed: player.speed,
          role: player.role ?? 'human',
          displayX: player.x,
          displayY: player.y,
          displayZ: player.z,
          displayYaw: player.yaw
        });
      } else {
        existing.x = player.x;
        existing.y = player.y;
        existing.z = player.z;
        existing.yaw = player.yaw;
        existing.speed = player.speed;
        existing.role = player.role ?? 'human';
      }
    }

    for (const id of [...state.players.keys()]) {
      if (!seen.has(id)) {
        state.players.delete(id);
        const remote = remoteAvatars.get(id);
        if (remote) {
          scene.remove(remote.avatar);
          remoteAvatars.delete(id);
        }
      }
    }
  }

  if (payload.type === 'proximity' && typeof payload.otherId === 'string') {
    if (payload.event === 'enter') {
      state.nearbyIds.add(payload.otherId);
    }
    if (payload.event === 'exit') {
      state.nearbyIds.delete(payload.otherId);
    }
    return;
  }

  if (payload.type === 'challenge') {
    if (payload.event === 'created' && payload.challenge) {
      if (payload.challenge.opponentId === state.playerId) {
        state.incomingChallengeId = payload.challenge.id;
        state.challengeStatus = 'incoming';
        state.challengeMessage = `Incoming challenge from ${payload.challenge.challengerId}. Press Y to accept or N to decline.`;
      }
      if (payload.challenge.challengerId === state.playerId) {
        state.outgoingChallengeId = payload.challenge.id;
        state.challengeStatus = 'sent';
        state.challengeMessage = `Challenge sent to ${payload.challenge.opponentId}. Waiting for response...`;
      }
    }

    if (payload.event === 'accepted' && payload.challenge) {
      state.incomingChallengeId = null;
      state.outgoingChallengeId = null;
      state.challengeStatus = 'active';
      state.challengeMessage = `Challenge active: ${payload.challenge.challengerId} vs ${payload.challenge.opponentId}`;
    }

    if (payload.event === 'declined' && payload.challenge) {
      state.incomingChallengeId = null;
      state.outgoingChallengeId = null;
      state.challengeStatus = 'declined';
      state.challengeMessage = `Challenge declined (${payload.challenge.id})`;
    }

    if (payload.event === 'expired' && payload.challenge) {
      state.incomingChallengeId = null;
      state.outgoingChallengeId = null;
      state.challengeStatus = 'expired';
      state.challengeMessage = `Challenge expired (${payload.challenge.id})`;
    }

    if (payload.event === 'resolved' && payload.challenge) {
      state.incomingChallengeId = null;
      state.outgoingChallengeId = null;
      state.challengeStatus = 'resolved';
      const winner = payload.challenge.winnerId ?? 'unknown';
      state.challengeMessage = `Challenge resolved. Winner: ${winner}`;
    }

    if (payload.event === 'invalid' || payload.event === 'busy') {
      state.challengeMessage = payload.reason ?? 'Challenge action rejected';
    }
    return;
  }

  if (payload.type === 'challenge_feed' && payload.event) {
    const line = payload.challenge
      ? `${payload.event}: ${payload.challenge.challengerId} vs ${payload.challenge.opponentId}${payload.challenge.winnerId ? ` (winner ${payload.challenge.winnerId})` : ''}`
      : `${payload.event}${payload.reason ? ` (${payload.reason})` : ''}`;
    state.challengeFeed.unshift(line);
    if (state.challengeFeed.length > 4) {
      state.challengeFeed.pop();
    }
  }
});

loadWorld(scene, state.worldAlias)
  .then(() => {
    state.worldLoaded = true;
  })
  .catch((err) => {
    console.error('Failed to load world', err);
  });

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

window.addEventListener('keydown', (event) => {
  const action = keyMap[event.code];
  if (action) {
    state.input[action] = true;
  }
  if (event.code === 'KeyF') {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => undefined);
    } else {
      document.exitFullscreen().catch(() => undefined);
    }
  }

  if (event.code === 'KeyC') {
    const nearest = [...state.nearbyIds][0];
    if (nearest && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'challenge_send', targetId: nearest }));
    } else {
      state.challengeMessage = 'No nearby player to challenge.';
    }
  }

  if (event.code === 'KeyY' && state.incomingChallengeId && socket.readyState === WebSocket.OPEN) {
    socket.send(
      JSON.stringify({
        type: 'challenge_response',
        challengeId: state.incomingChallengeId,
        accept: true
      })
    );
  }

  if (event.code === 'KeyN' && state.incomingChallengeId && socket.readyState === WebSocket.OPEN) {
    socket.send(
      JSON.stringify({
        type: 'challenge_response',
        challengeId: state.incomingChallengeId,
        accept: false
      })
    );
  }
});

window.addEventListener('keyup', (event) => {
  const action = keyMap[event.code];
  if (action) {
    state.input[action] = false;
  }
});

let dragging = false;
let lastPointerX = 0;
let lastPointerY = 0;

canvas.addEventListener('pointerdown', (event) => {
  dragging = true;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
});

canvas.addEventListener('pointerup', () => {
  dragging = false;
});

canvas.addEventListener('pointerleave', () => {
  dragging = false;
});

canvas.addEventListener('pointermove', (event) => {
  if (!dragging) {
    return;
  }

  const dx = event.clientX - lastPointerX;
  const dy = event.clientY - lastPointerY;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;

  state.cameraYawOffset -= dx * 0.006;
  state.cameraPitch = Math.min(0.85, Math.max(0.1, state.cameraPitch - dy * 0.004));
});

let lastInputSignature = '';
let lastInputSentAt = 0;
const AVATAR_GROUND_OFFSET = -0.7;
const cameraForwardFlat = new THREE.Vector3(0, 0, 1);
const cameraRightFlat = new THREE.Vector3(1, 0, 0);
const moveVector = new THREE.Vector3();

function computeInputVector() {
  const inputRight = (state.input.right ? 1 : 0) - (state.input.left ? 1 : 0);
  const inputForward = (state.input.forward ? 1 : 0) - (state.input.backward ? 1 : 0);
  const length = Math.hypot(inputRight, inputForward);

  if (length < 0.001) {
    return { moveX: 0, moveZ: 0 };
  }

  camera.getWorldDirection(cameraForwardFlat);
  cameraForwardFlat.y = 0;
  if (cameraForwardFlat.lengthSq() < 0.0001) {
    cameraForwardFlat.set(0, 0, 1);
  } else {
    cameraForwardFlat.normalize();
  }

  cameraRightFlat.set(cameraForwardFlat.z, 0, -cameraForwardFlat.x).normalize();
  moveVector
    .set(0, 0, 0)
    .addScaledVector(cameraRightFlat, inputRight / length)
    .addScaledVector(cameraForwardFlat, inputForward / length);

  if (moveVector.lengthSq() < 0.0001) {
    return { moveX: 0, moveZ: 0 };
  }

  moveVector.normalize();
  return {
    moveX: moveVector.x,
    moveZ: moveVector.z
  };
}

function sendInput(nowMs) {
  if (!state.wsConnected || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  const input = computeInputVector();
  const signature = `${input.moveX.toFixed(2)}:${input.moveZ.toFixed(2)}`;
  if (signature === lastInputSignature && nowMs - lastInputSentAt < 100) {
    return;
  }

  socket.send(JSON.stringify({ type: 'input', ...input }));
  lastInputSignature = signature;
  lastInputSentAt = nowMs;
}

function syncRemoteAvatars(playerId) {
  for (const player of state.players.values()) {
    if (player.id === playerId) {
      continue;
    }

    let remote = remoteAvatars.get(player.id);
    if (!remote) {
      const color = player.role === 'agent' ? 0xc8813f : 0x6f8f72;
      remote = createAvatar(color);
      remote.avatar.position.y = 1.2;
      remoteAvatars.set(player.id, remote);
      scene.add(remote.avatar);
    }

    player.displayX += (player.x - player.displayX) * 0.28;
    player.displayY += (player.y - player.displayY) * 0.28;
    player.displayZ += (player.z - player.displayZ) * 0.28;
    player.displayYaw += (player.yaw - player.displayYaw) * 0.25;

    remote.avatar.position.set(player.displayX, player.displayY + AVATAR_GROUND_OFFSET, player.displayZ);
    remote.avatar.rotation.y = player.displayYaw;

    animateAvatar(remote, player.speed, performance.now() * 0.004, player.id.length * 0.61);
  }
}

function animateAvatar(parts, speed, t, phaseOffset = 0) {
  const gait = Math.min(1, speed / 5);
  const gaitPhase = t * 8 + phaseOffset;
  parts.head.position.y = 1.16 + Math.sin(gaitPhase * 0.5) * 0.05 * gait;
  parts.leftLeg.rotation.x = Math.sin(gaitPhase) * 0.55 * gait;
  parts.rightLeg.rotation.x = Math.sin(gaitPhase + Math.PI) * 0.55 * gait;
}

function updateLocalAvatar() {
  if (!state.playerId) {
    return;
  }

  const local = state.players.get(state.playerId);
  if (!local) {
    return;
  }

  local.displayX += (local.x - local.displayX) * 0.36;
  local.displayY += (local.y - local.displayY) * 0.36;
  local.displayZ += (local.z - local.displayZ) * 0.36;
  local.displayYaw += (local.yaw - local.displayYaw) * 0.32;

  localAvatarParts.avatar.position.set(local.displayX, local.displayY + AVATAR_GROUND_OFFSET, local.displayZ);
  localAvatarParts.avatar.rotation.y = local.displayYaw;

  animateAvatar(localAvatarParts, local.speed, performance.now() * 0.004);

  const yaw = local.displayYaw + state.cameraYawOffset;
  const forwardX = Math.sin(yaw);
  const forwardZ = Math.cos(yaw);

  const followDistance = 5;
  const followHeight = 1.8 + state.cameraPitch * 2.6;

  const desired = new THREE.Vector3(
    local.displayX - forwardX * followDistance,
    local.displayY + AVATAR_GROUND_OFFSET + followHeight,
    local.displayZ - forwardZ * followDistance
  );

  camera.position.lerp(desired, 0.14);
  camera.lookAt(local.displayX, local.displayY + AVATAR_GROUND_OFFSET + 1.15, local.displayZ);
}

function update(nowMs) {
  sendInput(nowMs);
  updateLocalAvatar();
  syncRemoteAvatars(state.playerId);
  if (hud) {
    const nearbyCount = state.nearbyIds.size;
    const totalPlayers = state.players.size;
    const agents = [...state.players.values()].filter((entry) => entry.role === 'agent').length;
    const challengeHint = state.challengeMessage
      ? ` | Challenge: ${state.challengeMessage}`
      : ' | Challenge: Press C near player, Y/N for incoming';
    const feed = state.challengeFeed.length > 0 ? ` | Feed: ${state.challengeFeed.join(' ; ')}` : '';
    hud.textContent = `Play mode. WASD/Arrows move by camera. Mouse drag rotates. F fullscreen. Nearby: ${nearbyCount} | Players: ${totalPlayers} | Agents: ${agents}${challengeHint}${feed}`;
  }
}

function render() {
  renderer.render(scene, camera);
}

function frame(nowMs) {
  update(nowMs);
  render();
  requestAnimationFrame(frame);
}

window.advanceTime = (ms) => {
  const steps = Math.max(1, Math.round(ms / (1000 / 60)));
  for (let i = 0; i < steps; i += 1) {
    update(performance.now());
  }
  render();
};

window.render_game_to_text = () => {
  const local = state.playerId ? state.players.get(state.playerId) : null;
  return JSON.stringify({
    mode: 'play',
    wsConnected: state.wsConnected,
    playerId: state.playerId,
    worldAlias: state.worldAlias,
    worldLoaded: state.worldLoaded,
    tick: state.tick,
    coords: 'origin at world center, +X right, +Z forward, +Y up',
    player: local
      ? {
          x: local.x,
          y: local.y,
          z: local.z,
          vxApprox: local.speed * Math.sin(local.yaw),
          vzApprox: local.speed * Math.cos(local.yaw),
          yaw: local.yaw
        }
      : null,
    input: { ...state.input }
  });
};

requestAnimationFrame(frame);
