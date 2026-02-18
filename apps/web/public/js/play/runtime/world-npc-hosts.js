import { AVATAR_GROUND_OFFSET, createCharacterGlbPool, createProceduralAvatar } from '../avatars.js';

// Keep host positions aligned with server station coordinates to avoid
// "not_near_station" mismatches for proxied dealer/cashier interactions.
const WORLD_SECTION_SPAWNS = [
  { x: -72, z: 41 }, // guide (local interactable)
  { x: 78, z: -41 }, // cashier -> station_cashier_bank
  { x: -25, z: -24 }, // coinflip_a -> station_dealer_coinflip_a
  { x: 25, z: 26 }, // coinflip_b -> station_dealer_coinflip_b
  { x: 25, z: -24 }, // rps_a -> station_dealer_rps_a
  { x: -27, z: 34 }, // rps_b -> station_dealer_rps_b
  { x: -78, z: -37 }, // dice -> station_dealer_dice_a
  { x: -72, z: 39 } // info (local interactable)
];

export const HOST_STATION_PROXY_MAP = {
  station_npc_host_2: 'station_cashier_bank',
  station_npc_host_3: 'station_dealer_coinflip_a',
  station_npc_host_4: 'station_dealer_coinflip_b',
  station_npc_host_5: 'station_dealer_rps_a',
  station_npc_host_6: 'station_dealer_rps_b',
  station_npc_host_7: 'station_dealer_dice_a'
};

function roleDetails(role) {
  if (role === 'guide') {
    return {
      title: 'Welcome Conductor',
      inspect: 'Welcome to the train world. Explore sections, meet hosts, and challenge other players.',
      useLabel: 'Get Tour',
      use: 'Try coinflip, RPS, or dice duel. Stake USDC, play smart, and win rounds. Explore other hosts for each game.'
    };
  }
  if (role === 'info') {
    return {
      title: 'Explorer Guide',
      inspect: 'I can point you to every game host and station interaction point in this world.',
      useLabel: 'Show Routes',
      use: 'Coinflip, RPS, and Dice Duel are live now. Cards and more modes are coming soon.'
    };
  }
  return {
    title: 'World Host',
    inspect: 'Talk with nearby hosts to run game rounds and interactions.',
    useLabel: 'Use',
    use: 'Interaction complete.'
  };
}

function hostSpec(index) {
  const base = [
    {
      hostId: 'npc_host_guide',
      role: 'guide',
      displayName: 'Welcome Conductor',
      kind: 'world_interactable',
      interactionTag: 'guide_welcome',
      actions: ['interact_open', 'interact_use'],
      yaw: 0.35,
      radius: 8.5
    },
    {
      hostId: 'npc_host_cashier',
      role: 'cashier',
      displayName: 'Cashier Host',
      kind: 'cashier_bank',
      interactionTag: 'cashier_host',
      actions: ['balance', 'fund', 'withdraw', 'transfer'],
      yaw: 0,
      radius: 7
    },
    {
      hostId: 'npc_host_coinflip_a',
      role: 'coinflip',
      displayName: 'Coinflip Dealer A',
      kind: 'dealer_coinflip',
      interactionTag: 'coinflip_a',
      actions: ['coinflip_house_start', 'coinflip_house_pick'],
      yaw: -0.25,
      radius: 7
    },
    {
      hostId: 'npc_host_coinflip_b',
      role: 'coinflip',
      displayName: 'Coinflip Dealer B',
      kind: 'dealer_coinflip',
      interactionTag: 'coinflip_b',
      actions: ['coinflip_house_start', 'coinflip_house_pick'],
      yaw: 0.2,
      radius: 7
    },
    {
      hostId: 'npc_host_rps_a',
      role: 'rps',
      displayName: 'RPS Dealer A',
      kind: 'dealer_rps',
      interactionTag: 'rps_a',
      actions: ['rps_house_start', 'rps_house_pick'],
      yaw: -0.1,
      radius: 7
    },
    {
      hostId: 'npc_host_rps_b',
      role: 'rps',
      displayName: 'RPS Dealer B',
      kind: 'dealer_rps',
      interactionTag: 'rps_b',
      actions: ['rps_house_start', 'rps_house_pick'],
      yaw: 0.15,
      radius: 7
    },
    {
      hostId: 'npc_host_dice',
      role: 'dice',
      displayName: 'Dice Duel Host',
      kind: 'dealer_dice_duel',
      interactionTag: 'dice_host',
      actions: ['dice_duel_start', 'dice_duel_pick'],
      yaw: -0.3,
      radius: 7
    },
    {
      hostId: 'npc_host_info',
      role: 'info',
      displayName: 'Explorer Info Host',
      kind: 'world_interactable',
      interactionTag: 'explorer_info',
      actions: ['interact_open', 'interact_use'],
      yaw: 0.4,
      radius: 8
    }
  ];
  return base[index] || null;
}

function makeHostStationRecord(spec, spawn, index) {
  const localInteraction = spec.kind === 'world_interactable'
    ? roleDetails(spec.role)
    : null;
  return {
    id: `station_npc_host_${index + 1}`,
    source: 'host',
    hostRole: spec.role,
    hostId: spec.hostId,
    kind: spec.kind,
    displayName: spec.displayName,
    x: Number(spawn?.x || 0),
    z: Number(spawn?.z || 0),
    yaw: Number(spec.yaw || 0),
    radius: Number(spec.radius || 7),
    interactionTag: String(spec.interactionTag || ''),
    actions: Array.isArray(spec.actions) ? [...spec.actions] : [],
    localInteraction,
    proxyStationId: ''
  };
}

export function createWorldNpcHosts({ THREE, scene }) {
  const glbPool = createCharacterGlbPool(THREE);
  const mixers = [];
  const visuals = new Map();
  const hostStations = new Map();

  WORLD_SECTION_SPAWNS.forEach((spawn, index) => {
    const spec = hostSpec(index);
    if (!spec) return;
    const station = makeHostStationRecord(spec, spawn, index);
    hostStations.set(station.id, station);

    const procedural = createProceduralAvatar(THREE, 'agent', station.displayName, false);
    procedural.avatar.position.set(station.x, AVATAR_GROUND_OFFSET, station.z);
    procedural.avatar.rotation.y = station.yaw || 0;
    scene.add(procedural.avatar);

    const visualState = {
      id: station.id,
      current: procedural.avatar,
      fallback: procedural.avatar,
      mixer: null
    };
    visuals.set(station.id, visualState);

    void glbPool.instantiateById(spec.hostId).then((loaded) => {
      const active = visuals.get(station.id);
      if (!active || !loaded) {
        return;
      }
      loaded.anchor.position.set(station.x, AVATAR_GROUND_OFFSET, station.z);
      loaded.anchor.rotation.y = (station.yaw || 0) + (loaded.yawOffset || 0);
      scene.remove(active.current);
      scene.add(loaded.anchor);
      active.current = loaded.anchor;
      if (Array.isArray(loaded.gltf.animations) && loaded.gltf.animations.length > 0) {
        const mixer = new THREE.AnimationMixer(loaded.anchor);
        const clip =
          loaded.gltf.animations.find((item) => String(item.name || '').toLowerCase() === 'idle')
          || loaded.gltf.animations[0]
          || null;
        if (clip) {
          mixer.clipAction(clip).play();
          active.mixer = mixer;
          mixers.push(mixer);
        }
      }
    });
  });

  const clock = new THREE.Clock();

  function updateHosts() {
    const dt = clock.getDelta();
    for (const mixer of mixers) {
      mixer.update(dt);
    }
  }

  function dispose() {
    for (const state of visuals.values()) {
      scene.remove(state.current);
    }
    visuals.clear();
    mixers.length = 0;
  }

  return {
    hostStations,
    updateHosts,
    dispose
  };
}
