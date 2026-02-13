import { THREE, installResizeHandler, loadWorld, makeCamera, makeRenderer, makeScene, pickWorldAlias } from './world-common.js';

const canvas = document.getElementById('scene');
const hud = document.getElementById('hud');
const targetSelect = document.getElementById('challenge-target');
const gameSelect = document.getElementById('challenge-game');
const wagerInput = document.getElementById('challenge-wager');
const sendChallengeBtn = document.getElementById('challenge-send');
const clearChallengeBtn = document.getElementById('challenge-cancel');
const acceptBtn = document.getElementById('challenge-accept');
const declineBtn = document.getElementById('challenge-decline');
const rpsButtons = document.getElementById('rps-buttons');
const coinButtons = document.getElementById('coin-buttons');
const feedPanel = document.getElementById('challenge-feed-panel');
const challengeStatusLine = document.getElementById('challenge-status-line');
const worldMapCanvas = document.getElementById('world-map');
const mapCoords = document.getElementById('map-coords');
const deskToggle = document.getElementById('desk-toggle');
const challengePanel = document.querySelector('.challenge-panel');
const gameModal = document.getElementById('game-modal');
const gameTitle = document.getElementById('game-title');
const gamePlayers = document.getElementById('game-players');
const gameStatus = document.getElementById('game-status');
const gameDetail = document.getElementById('game-detail');
const gameClose = document.getElementById('game-close');
const matchControls = document.getElementById('match-controls');
const matchControlsTitle = document.getElementById('match-controls-title');
const matchControlsStatus = document.getElementById('match-controls-status');
const matchControlsActions = document.getElementById('match-controls-actions');
const interactionPrompt = document.getElementById('interaction-prompt');
const queryParams = new URL(window.location.href).searchParams;

const renderer = makeRenderer(canvas);
const scene = makeScene();
const camera = makeCamera();
installResizeHandler(camera, renderer);

const matchSpotlight = new THREE.Mesh(
  new THREE.RingGeometry(2.4, 3.2, 40),
  new THREE.MeshStandardMaterial({
    color: 0xd7b24d,
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
    emissive: 0x5a3f08,
    emissiveIntensity: 0.5
  })
);
matchSpotlight.rotation.x = -Math.PI / 2;
matchSpotlight.position.y = 0.04;
matchSpotlight.visible = false;
scene.add(matchSpotlight);

function createNameTag(initialText) {
  const canvas = document.createElement('canvas');
  canvas.width = 112;
  canvas.height = 20;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  function draw(text) {
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(255, 251, 241, 0.94)';
    ctx.fillRect(0, 2, canvas.width, 16);
    ctx.strokeStyle = 'rgba(183, 136, 24, 0.9)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(0, 2, canvas.width, 16);
    ctx.fillStyle = '#4a3812';
    ctx.font = '600 9px "IBM Plex Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const trimmed = String(text).slice(0, 14);
    ctx.fillText(trimmed, canvas.width / 2, 10);
    texture.needsUpdate = true;
  }

  draw(initialText);

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    })
  );
  sprite.scale.set(0.74, 0.14, 1);
  sprite.position.set(0, 1.72, 0);

  return {
    sprite,
    setText: draw
  };
}

function createAvatar(color, initialName) {
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

  const nameTag = createNameTag(initialName);

  avatar.add(torso, head, leftLeg, rightLeg, nameTag.sprite);
  return {
    avatar,
    head,
    leftLeg,
    rightLeg,
    setName: nameTag.setText
  };
}

const localAvatarParts = createAvatar(0x3a7bff, 'You');
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
  nearbyNames: new Map(),
  nearbyDistances: new Map(),
  incomingChallengeId: null,
  outgoingChallengeId: null,
  activeChallenge: null,
  challengeStatus: 'none',
  challengeMessage: '',
  challengeFeed: [],
  cameraYawOffset: 0,
  cameraPitch: 0.27,
  deskCollapsed: false
};
const WORLD_BOUND = 120;

if (deskToggle && challengePanel) {
  deskToggle.addEventListener('click', () => {
    state.deskCollapsed = !state.deskCollapsed;
    challengePanel.classList.toggle('compact', state.deskCollapsed);
    deskToggle.textContent = state.deskCollapsed ? 'Expand' : 'Collapse';
  });
}

const wsUrlObj = new URL(queryParams.get('ws') ?? `ws://${window.location.hostname}:4000/ws`);
let sessionName = queryParams.get('name') || localStorage.getItem('arena_last_name') || '';
let sessionWalletId = queryParams.get('walletId') || localStorage.getItem('arena_wallet_id') || '';
if (!sessionName || !sessionWalletId) {
  try {
    const meResponse = await fetch('/api/player/me', { credentials: 'include' });
    if (meResponse.ok) {
      const mePayload = await meResponse.json();
      const profile = mePayload?.profile;
      if (!sessionName && profile?.displayName) {
        sessionName = String(profile.displayName);
      }
      if (!sessionWalletId && (profile?.wallet?.id || profile?.walletId)) {
        sessionWalletId = String(profile.wallet?.id || profile.walletId);
      }
    }
  } catch {
    // ignore; query/localStorage fallback remains in use
  }
}
if (sessionName) {
  wsUrlObj.searchParams.set('name', sessionName);
  localStorage.setItem('arena_last_name', sessionName);
}
if (sessionWalletId) {
  wsUrlObj.searchParams.set('walletId', sessionWalletId);
  localStorage.setItem('arena_wallet_id', sessionWalletId);
}
const wsUrl = wsUrlObj.toString();
const socket = new WebSocket(wsUrl);

socket.addEventListener('open', () => {
  state.wsConnected = true;
  addFeedEvent('system', 'Connected to game server.');
});

socket.addEventListener('close', () => {
  state.wsConnected = false;
  addFeedEvent('system', 'Disconnected from game server.');
});

socket.addEventListener('message', (event) => {
  const payload = JSON.parse(event.data);

  if (payload.type === 'welcome') {
    state.playerId = payload.playerId;
    localAvatarParts.setName(`You (${payload.displayName || payload.playerId})`);
    if (payload.displayName) {
      localStorage.setItem('arena_last_name', payload.displayName);
    }
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
          displayName: player.displayName ?? player.id,
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
        existing.displayName = player.displayName ?? player.id;
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

    refreshNearbyTargetOptions();
    updateRpsVisibility();
    updateGameModalFromState();
    return;
  }

  if (payload.type === 'proximity' && typeof payload.otherId === 'string') {
    if (payload.event === 'enter') {
      state.nearbyIds.add(payload.otherId);
      if (typeof payload.otherName === 'string') {
        state.nearbyNames.set(payload.otherId, payload.otherName);
      }
      if (typeof payload.distance === 'number') {
        state.nearbyDistances.set(payload.otherId, payload.distance);
      }
      addFeedEvent('proximity', `${payload.otherName || payload.otherId} entered range.`);
    }
    if (payload.event === 'exit') {
      state.nearbyIds.delete(payload.otherId);
      state.nearbyNames.delete(payload.otherId);
      state.nearbyDistances.delete(payload.otherId);
      addFeedEvent('proximity', `${payload.otherName || payload.otherId} left range.`);
    }
    refreshNearbyTargetOptions();
    return;
  }

  if (payload.type === 'challenge') {
    handleChallenge(payload);
    return;
  }

  if (payload.type === 'challenge_feed' && payload.event) {
    const line = payload.challenge
      ? `${payload.event} ${payload.challenge.gameType} ${labelFor(payload.challenge.challengerId)} vs ${labelFor(payload.challenge.opponentId)}${payload.challenge.winnerId ? ` winner=${labelFor(payload.challenge.winnerId)}` : ''}`
      : `${payload.event}${payload.reason ? ` (${payload.reason})` : ''}`;
    addFeedEvent('match', line);
  }
});

loadWorld(scene, state.worldAlias)
  .then(() => {
    state.worldLoaded = true;
    addFeedEvent('system', `World loaded: ${state.worldAlias}`);
  })
  .catch((err) => {
    console.error('Failed to load world', err);
    addFeedEvent('system', 'Failed to load world asset.');
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
    sendChallenge();
  }

  if (event.code === 'KeyY') {
    respondToIncoming(true);
  }

  if (event.code === 'KeyN') {
    respondToIncoming(false);
  }

  if (event.code === 'Digit1') {
    sendGameMove('rock');
  }
  if (event.code === 'Digit2') {
    sendGameMove('paper');
  }
  if (event.code === 'Digit3') {
    sendGameMove('scissors');
  }
  if (event.code === 'KeyH') {
    sendGameMove('heads');
  }
  if (event.code === 'KeyT') {
    sendGameMove('tails');
  }
});

window.addEventListener('keyup', (event) => {
  const action = keyMap[event.code];
  if (action) {
    state.input[action] = false;
  }
});

sendChallengeBtn?.addEventListener('click', () => sendChallenge());
clearChallengeBtn?.addEventListener('click', () => {
  state.challengeMessage = '';
  state.challengeStatus = 'none';
  hideGameModal();
});
acceptBtn?.addEventListener('click', () => respondToIncoming(true));
declineBtn?.addEventListener('click', () => respondToIncoming(false));
gameClose?.addEventListener('click', () => hideGameModal());
rpsButtons?.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }
  const move = target.dataset.rps;
  if (!move || (move !== 'rock' && move !== 'paper' && move !== 'scissors')) {
    return;
  }
  sendGameMove(move);
});
coinButtons?.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }
  const move = target.dataset.coin;
  if (!move || (move !== 'heads' && move !== 'tails')) {
    return;
  }
  sendGameMove(move);
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
      remote = createAvatar(color, player.displayName);
      remote.avatar.position.y = 1.2;
      remoteAvatars.set(player.id, remote);
      scene.add(remote.avatar);
    }

    remote.setName(player.displayName);

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

  const active = state.activeChallenge;
  const inMatch = active && active.status === 'active' && (active.challengerId === state.playerId || active.opponentId === state.playerId);
  const opponentId =
    inMatch && active
      ? (active.challengerId === state.playerId ? active.opponentId : active.challengerId)
      : null;
  const opponent = opponentId ? state.players.get(opponentId) : null;

  if (inMatch && opponent) {
    const cx = (local.displayX + opponent.displayX) * 0.5;
    const cz = (local.displayZ + opponent.displayZ) * 0.5;
    const dx = opponent.displayX - local.displayX;
    const dz = opponent.displayZ - local.displayZ;
    const len = Math.max(0.001, Math.hypot(dx, dz));
    const nx = dx / len;
    const nz = dz / len;
    const sideX = -nz;
    const sideZ = nx;
    const desired = new THREE.Vector3(
      cx + sideX * 4.2 - nx * 1.1,
      Math.max(local.displayY, opponent.displayY) + AVATAR_GROUND_OFFSET + 3.3,
      cz + sideZ * 4.2 - nz * 1.1
    );
    camera.position.lerp(desired, 0.12);
    camera.lookAt(cx, local.displayY + AVATAR_GROUND_OFFSET + 1.0, cz);
    return;
  }

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

function renderMatchSpotlight() {
  const challenge = state.activeChallenge;
  if (!challenge || challenge.status !== 'active') {
    matchSpotlight.visible = false;
    return;
  }

  const a = state.players.get(challenge.challengerId);
  const b = state.players.get(challenge.opponentId);
  if (!a || !b) {
    matchSpotlight.visible = false;
    return;
  }

  matchSpotlight.visible = true;
  matchSpotlight.position.x = (a.displayX + b.displayX) * 0.5;
  matchSpotlight.position.z = (a.displayZ + b.displayZ) * 0.5;
  matchSpotlight.rotation.z += 0.01;
}

function update(nowMs) {
  sendInput(nowMs);
  updateLocalAvatar();
  syncRemoteAvatars(state.playerId);
  refreshNearbyDistances();
  renderMatchSpotlight();

  if (hud) {
    const nearbyCount = state.nearbyIds.size;
    const totalPlayers = state.players.size;
    const agents = [...state.players.values()].filter((entry) => entry.role === 'agent').length;
    const hint = state.challengeMessage ? ` | ${state.challengeMessage}` : '';
    hud.textContent = `WASD move | C challenge | Y/N respond | 1/2/3 RPS | H/T coin | Near ${nearbyCount} | Players ${totalPlayers} | Agents ${agents}${hint}`;
  }

  if (challengeStatusLine) {
    challengeStatusLine.textContent =
      state.challengeMessage ||
      (state.challengeStatus === 'none'
        ? 'Find a nearby target and start a challenge.'
        : `Status: ${state.challengeStatus}`);
  }

  renderWorldMap();
  renderInteractionPrompt();
  renderMatchControls();
}

function render() {
  renderer.render(scene, camera);
}

function frame(nowMs) {
  update(nowMs);
  render();
  requestAnimationFrame(frame);
}

function labelFor(id) {
  if (!id) {
    return 'Unknown';
  }
  const player = state.players.get(id);
  return player?.displayName || state.nearbyNames.get(id) || id;
}

function refreshNearbyTargetOptions() {
  if (!targetSelect) {
    return;
  }

  const previous = targetSelect.value;
  targetSelect.innerHTML = '';

  const options = [...state.nearbyIds].sort();
  if (options.length === 0) {
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'No nearby players';
    targetSelect.appendChild(empty);
    targetSelect.disabled = true;
    return;
  }

  targetSelect.disabled = false;
  for (const id of options) {
    const option = document.createElement('option');
    option.value = id;
    const role = state.players.get(id)?.role === 'agent' ? 'agent' : 'human';
    option.textContent = `${labelFor(id)} (${role})`;
    targetSelect.appendChild(option);
  }

  if (options.includes(previous)) {
    targetSelect.value = previous;
  }
}

function closestNearbyTargetId() {
  if (state.nearbyIds.size === 0) {
    return '';
  }
  let bestId = '';
  let bestDist = Number.POSITIVE_INFINITY;
  for (const id of state.nearbyIds) {
    const distance = Number(state.nearbyDistances.get(id) ?? Number.POSITIVE_INFINITY);
    if (distance < bestDist) {
      bestDist = distance;
      bestId = id;
    }
  }
  return bestId || [...state.nearbyIds][0] || '';
}

function refreshNearbyDistances() {
  const selfId = state.playerId;
  if (!selfId) {
    return;
  }
  const self = state.players.get(selfId);
  if (!self) {
    return;
  }
  for (const id of state.nearbyIds) {
    const other = state.players.get(id);
    if (!other) {
      continue;
    }
    state.nearbyDistances.set(id, Math.hypot(other.x - self.x, other.z - self.z));
  }
}

function sendChallenge() {
  if (!state.wsConnected || socket.readyState !== WebSocket.OPEN) {
    state.challengeMessage = 'Not connected to game server.';
    return;
  }

  const selectedTarget = targetSelect?.value || '';
  const targetId =
    (selectedTarget && state.nearbyIds.has(selectedTarget) ? selectedTarget : '') ||
    closestNearbyTargetId();
  if (!targetId) {
    state.challengeMessage = 'No nearby target selected.';
    return;
  }

  const gameType = gameSelect?.value === 'coinflip' ? 'coinflip' : 'rps';
  const wager = Math.max(1, Math.min(10000, Number(wagerInput?.value || 1)));

  socket.send(
    JSON.stringify({
      type: 'challenge_send',
      targetId,
      gameType,
      wager
    })
  );

  state.challengeStatus = 'sent';
  state.challengeMessage = `Challenge sent (${gameType}, wager ${wager}) to ${labelFor(targetId)}`;
}

function respondToIncoming(accept) {
  if (!state.incomingChallengeId || socket.readyState !== WebSocket.OPEN) {
    state.challengeMessage = 'No incoming challenge to respond to.';
    return;
  }

  socket.send(
    JSON.stringify({
      type: 'challenge_response',
      challengeId: state.incomingChallengeId,
      accept
    })
  );
}

function sendGameMove(move) {
  const challenge = state.activeChallenge;
  if (!challenge || socket.readyState !== WebSocket.OPEN) {
    state.challengeMessage = 'No active match right now.';
    return;
  }
  if (challenge.gameType === 'rps' && move !== 'rock' && move !== 'paper' && move !== 'scissors') {
    return;
  }
  if (challenge.gameType === 'coinflip' && move !== 'heads' && move !== 'tails') {
    return;
  }

  const iAmChallenger = challenge.challengerId === state.playerId;
  const iAmOpponent = challenge.opponentId === state.playerId;
  if (!iAmChallenger && !iAmOpponent) {
    return;
  }

  const myMove = iAmChallenger ? challenge.challengerMove : challenge.opponentMove;
  if (myMove) {
    state.challengeMessage = `Move already submitted (${myMove})`;
    return;
  }

  socket.send(
    JSON.stringify({
      type: 'challenge_move',
      challengeId: challenge.id,
      move
    })
  );

  state.challengeMessage = `Submitted move: ${move}`;
}

function updateRpsVisibility() {
  if (!rpsButtons) {
    return;
  }

  const challenge = state.activeChallenge;
  const show =
    challenge &&
    challenge.status === 'active' &&
    challenge.gameType === 'rps' &&
    (challenge.challengerId === state.playerId || challenge.opponentId === state.playerId);

  rpsButtons.classList.toggle('visible', Boolean(show));
  const showCoin =
    challenge &&
    challenge.status === 'active' &&
    challenge.gameType === 'coinflip' &&
    (challenge.challengerId === state.playerId || challenge.opponentId === state.playerId);
  coinButtons?.classList.toggle('visible', Boolean(showCoin));

  if (rpsButtons) {
    rpsButtons.style.opacity = show ? '1' : '0.55';
  }
  if (coinButtons) {
    coinButtons.style.opacity = showCoin ? '1' : '0.55';
  }
}

function addFeedEvent(type, text) {
  const message = String(text || '').trim();
  if (!message) {
    return;
  }

  const at = Date.now();
  const last = state.challengeFeed[0];
  if (last && last.text === message && at - last.at < 2000) {
    return;
  }

  state.challengeFeed.unshift({
    type,
    text: message,
    at
  });
  if (state.challengeFeed.length > 14) {
    state.challengeFeed.pop();
  }

  renderFeed();
}

function renderFeed() {
  if (!feedPanel) {
    return;
  }
  feedPanel.innerHTML = '';

  if (state.challengeFeed.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'feed-empty';
    empty.textContent = 'No challenge activity yet.';
    feedPanel.appendChild(empty);
    return;
  }

  for (const entry of state.challengeFeed) {
    const item = document.createElement('div');
    item.className = 'feed-item';

    const top = document.createElement('div');
    top.className = 'feed-item__top';

    const kind = document.createElement('span');
    kind.textContent = entry.type;

    const time = document.createElement('span');
    time.textContent = new Date(entry.at).toLocaleTimeString();

    const body = document.createElement('div');
    body.className = 'feed-item__body';
    body.textContent = entry.text;

    top.appendChild(kind);
    top.appendChild(time);
    item.appendChild(top);
    item.appendChild(body);
    feedPanel.appendChild(item);
  }
}

function showGameModal(challenge, statusText, detailText = '') {
  if (!gameModal || !gameTitle || !gamePlayers || !gameStatus || !gameDetail) {
    return;
  }

  gameTitle.textContent = challenge.gameType === 'rps' ? 'Rock Paper Scissors' : 'Coin Flip';
  gamePlayers.textContent = `${labelFor(challenge.challengerId)} vs ${labelFor(challenge.opponentId)} | Wager ${challenge.wager}`;
  gameStatus.textContent = statusText;
  gameDetail.textContent = detailText;
  // Keep modal only for terminal states; active controls now live in the match dock.
  const terminal = statusText.toLowerCase().includes('resolved');
  if (terminal) {
    gameModal.classList.add('visible');
  }
}

function hideGameModal() {
  gameModal?.classList.remove('visible');
}

function updateGameModalFromState() {
  const challenge = state.activeChallenge;
  if (!challenge || challenge.status !== 'active') {
    return;
  }

  if (challenge.gameType === 'rps') {
    const left = challenge.challengerMove ? `${labelFor(challenge.challengerId)} locked move` : `${labelFor(challenge.challengerId)} thinking...`;
    const right = challenge.opponentMove ? `${labelFor(challenge.opponentId)} locked move` : `${labelFor(challenge.opponentId)} thinking...`;
    showGameModal(challenge, 'Submit move to play', `${left} | ${right}`);
    return;
  }

  const left =
    challenge.challengerMove && (challenge.challengerMove === 'heads' || challenge.challengerMove === 'tails')
      ? `${labelFor(challenge.challengerId)} picked ${challenge.challengerMove}`
      : `${labelFor(challenge.challengerId)} choosing...`;
  const right =
    challenge.opponentMove && (challenge.opponentMove === 'heads' || challenge.opponentMove === 'tails')
      ? `${labelFor(challenge.opponentId)} picked ${challenge.opponentMove}`
      : `${labelFor(challenge.opponentId)} choosing...`;
  showGameModal(challenge, 'Choose heads or tails (H/T)', `${left} | ${right}`);
}

function handleChallenge(payload) {
  const challenge = payload.challenge;
  if (challenge) {
    state.activeChallenge = challenge;
  }

  if (payload.event === 'created' && challenge) {
    if (challenge.opponentId === state.playerId) {
      state.incomingChallengeId = challenge.id;
      state.challengeStatus = 'incoming';
      state.challengeMessage = `Incoming ${challenge.gameType} challenge from ${labelFor(challenge.challengerId)} (wager ${challenge.wager}).`;
      hideGameModal();
    }

    if (challenge.challengerId === state.playerId) {
      state.outgoingChallengeId = challenge.id;
      state.challengeStatus = 'sent';
      state.challengeMessage = `Challenge created. Waiting for ${labelFor(challenge.opponentId)}.`;
      hideGameModal();
    }
  }

  if (payload.event === 'accepted' && challenge) {
    state.incomingChallengeId = null;
    state.outgoingChallengeId = null;
    state.challengeStatus = 'active';
    state.challengeMessage = `${challenge.gameType.toUpperCase()} active.`;
    hideGameModal();
  }

  if (payload.event === 'move_submitted' && challenge) {
    state.challengeStatus = 'active';
    hideGameModal();
  }

  if (payload.event === 'declined' && challenge) {
    state.activeChallenge = null;
    state.incomingChallengeId = null;
    state.outgoingChallengeId = null;
    state.challengeStatus = 'declined';
    state.challengeMessage = `Challenge declined (${challenge.id})`;
    hideGameModal();
  }

  if (payload.event === 'expired' && challenge) {
    state.activeChallenge = null;
    state.incomingChallengeId = null;
    state.outgoingChallengeId = null;
    state.challengeStatus = 'expired';
    state.challengeMessage = `Challenge expired (${challenge.id})`;
    hideGameModal();
  }

  if (payload.event === 'resolved' && challenge) {
    state.activeChallenge = null;
    state.incomingChallengeId = null;
    state.outgoingChallengeId = null;
    state.challengeStatus = 'resolved';
    const winnerLabel = challenge.winnerId ? labelFor(challenge.winnerId) : 'Draw';
    const coinInfo = challenge.gameType === 'coinflip' && challenge.coinflipResult ? ` | Toss: ${challenge.coinflipResult}` : '';
    state.challengeMessage = challenge.winnerId ? `Resolved. Winner: ${winnerLabel}` : 'Resolved. Draw/refund.';
    showGameModal(challenge, 'Match resolved', `Winner: ${winnerLabel}${coinInfo}`);
    setTimeout(() => {
      hideGameModal();
    }, 3500);
  }

  if (payload.event === 'invalid' || payload.event === 'busy') {
    state.challengeMessage = challengeReasonLabel(payload.reason);
  }

  addFeedEvent('match', `challenge:${payload.event}${payload.reason ? ` (${payload.reason})` : ''}`);
  updateRpsVisibility();
}

function challengeReasonLabel(reason) {
  switch (reason) {
    case 'target_not_found':
      return 'Target not found.';
    case 'target_not_nearby':
      return 'Move closer to your target to challenge.';
    case 'player_busy':
      return 'Target is already in a match.';
    case 'wallet_required':
      return 'Both players need funded wallets to start wagered matches.';
    case 'challenger_wallet_policy_disabled':
    case 'opponent_wallet_policy_disabled':
      return 'Wallet policy disabled. Enable wallet skills in Agents page.';
    case 'challenger_insufficient_balance':
    case 'opponent_insufficient_balance':
      return 'One player has insufficient balance for this wager.';
    case 'challenger_max_bet_percent_exceeded':
    case 'opponent_max_bet_percent_exceeded':
      return 'Wager exceeds one player spend-limit policy.';
    case 'challenge_not_pending':
      return 'Challenge is no longer pending.';
    case 'challenge_not_active':
      return 'Match is not active.';
    case 'not_opponent':
      return 'Only the challenged player can accept.';
    case 'not_participant':
      return 'Only match participants can submit a move.';
    case 'invalid_rps_move':
    case 'invalid_coinflip_move':
      return 'Invalid move for current game type.';
    default:
      return reason ? `Action rejected: ${reason}` : 'Challenge action rejected.';
  }
}

function renderInteractionPrompt() {
  if (!interactionPrompt) {
    return;
  }
  const active = state.activeChallenge;
  if (active && active.status === 'active') {
    interactionPrompt.classList.remove('visible');
    return;
  }
  const targetId = closestNearbyTargetId();
  if (!targetId) {
    interactionPrompt.classList.remove('visible');
    return;
  }
  const distance = state.nearbyDistances.get(targetId);
  interactionPrompt.textContent = `Near ${labelFor(targetId)}${typeof distance === 'number' ? ` (${distance.toFixed(1)}m)` : ''}. Press C to challenge.`;
  interactionPrompt.classList.add('visible');
}

function renderMatchControls() {
  if (!matchControls || !matchControlsActions || !matchControlsStatus || !matchControlsTitle) {
    return;
  }

  const challenge = state.activeChallenge;
  const isIncoming = Boolean(state.incomingChallengeId && state.challengeStatus === 'incoming');
  const isParticipant =
    challenge && (challenge.challengerId === state.playerId || challenge.opponentId === state.playerId);

  if (!isIncoming && !(challenge && challenge.status === 'active' && isParticipant)) {
    matchControls.classList.remove('visible');
    matchControlsActions.innerHTML = '';
    return;
  }

  matchControls.classList.add('visible');
  matchControlsActions.innerHTML = '';

  if (isIncoming && challenge) {
    matchControlsTitle.textContent = 'Incoming Challenge';
    matchControlsStatus.textContent = `${labelFor(challenge.challengerId)} challenged you (${challenge.gameType}, wager ${challenge.wager}).`;
    matchControlsActions.className = 'match-controls__actions two';
    matchControlsActions.innerHTML = `
      <button type="button" data-action="accept">Accept (Y)</button>
      <button type="button" data-action="decline">Decline (N)</button>
    `;
    return;
  }

  if (!challenge) {
    return;
  }

  matchControlsTitle.textContent = challenge.gameType === 'rps' ? 'RPS Match' : 'Coinflip Match';
  matchControlsStatus.textContent = `${labelFor(challenge.challengerId)} vs ${labelFor(challenge.opponentId)} | Wager ${challenge.wager}`;

  const iAmChallenger = challenge.challengerId === state.playerId;
  const myMove = iAmChallenger ? challenge.challengerMove : challenge.opponentMove;

  if (challenge.gameType === 'rps') {
    matchControlsActions.className = 'match-controls__actions';
    matchControlsActions.innerHTML = `
      <button type="button" data-move="rock" ${myMove ? 'disabled' : ''}>Rock (1)</button>
      <button type="button" data-move="paper" ${myMove ? 'disabled' : ''}>Paper (2)</button>
      <button type="button" data-move="scissors" ${myMove ? 'disabled' : ''}>Scissors (3)</button>
    `;
  } else {
    matchControlsActions.className = 'match-controls__actions two';
    matchControlsActions.innerHTML = `
      <button type="button" data-move="heads" ${myMove ? 'disabled' : ''}>Heads (H)</button>
      <button type="button" data-move="tails" ${myMove ? 'disabled' : ''}>Tails (T)</button>
    `;
  }

  if (myMove) {
    matchControlsStatus.textContent = `${matchControlsStatus.textContent} | Locked: ${myMove}. Waiting for opponent.`;
  }
}

matchControlsActions?.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }
  const action = target.dataset.action;
  if (action === 'accept') {
    respondToIncoming(true);
    return;
  }
  if (action === 'decline') {
    respondToIncoming(false);
    return;
  }
  const move = target.dataset.move;
  if (move) {
    sendGameMove(move);
  }
});

function renderWorldMap() {
  if (!(worldMapCanvas instanceof HTMLCanvasElement)) {
    return;
  }
  const ctx = worldMapCanvas.getContext('2d');
  if (!ctx) {
    return;
  }

  const { width, height } = worldMapCanvas;
  ctx.clearRect(0, 0, width, height);

  // Soft paper-like field background.
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, 'rgba(255,255,251,0.98)');
  bg.addColorStop(1, 'rgba(243,234,208,0.95)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Draw 8 sections (4x2) with alternating tint.
  for (let r = 0; r < 2; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      const x = (c / 4) * width;
      const y = (r / 2) * height;
      const w = width / 4;
      const h = height / 2;
      ctx.fillStyle = (r + c) % 2 === 0 ? 'rgba(228, 206, 147, 0.14)' : 'rgba(255,255,255,0.2)';
      ctx.fillRect(x, y, w, h);
    }
  }

  ctx.strokeStyle = 'rgba(168, 130, 24, 0.55)';
  ctx.lineWidth = 1.1;
  const cols = 4;
  const rows = 2;
  for (let c = 1; c < cols; c += 1) {
    const x = (c / cols) * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let r = 1; r < rows; r += 1) {
    const y = (r / rows) * height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.font = '10px "IBM Plex Mono", monospace';
  ctx.fillStyle = 'rgba(91, 72, 20, 0.9)';
  for (let i = 0; i < 8; i += 1) {
    const c = i % 4;
    const r = Math.floor(i / 4);
    ctx.fillText(`S${i + 1}`, c * (width / 4) + 4, r * (height / 2) + 12);
  }

  for (const player of state.players.values()) {
    const x = ((player.x + WORLD_BOUND) / (WORLD_BOUND * 2)) * width;
    const y = ((player.z + WORLD_BOUND) / (WORLD_BOUND * 2)) * height;

    const isSelf = player.id === state.playerId;
    const role = player.role ?? 'human';

    ctx.beginPath();
    ctx.arc(x, y, isSelf ? 4.8 : 3.2, 0, Math.PI * 2);
    ctx.fillStyle = isSelf ? '#2f6dff' : role === 'agent' ? '#b4792a' : '#4f8a63';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  if (state.playerId) {
    const self = state.players.get(state.playerId);
    if (self && mapCoords) {
      mapCoords.textContent = `x:${Math.round(self.x)} z:${Math.round(self.z)}`;
    }
  }
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
          yaw: local.yaw,
          displayName: local.displayName
        }
      : null,
    nearbyIds: [...state.nearbyIds],
    challengeStatus: state.challengeStatus,
    activeChallenge: state.activeChallenge
      ? {
          id: state.activeChallenge.id,
          gameType: state.activeChallenge.gameType,
          challengerId: state.activeChallenge.challengerId,
          opponentId: state.activeChallenge.opponentId,
          challengerMove: state.activeChallenge.challengerMove,
          opponentMove: state.activeChallenge.opponentMove,
          wager: state.activeChallenge.wager
        }
      : null
  });
};

requestAnimationFrame(frame);
