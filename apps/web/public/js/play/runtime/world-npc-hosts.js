import { AVATAR_GROUND_OFFSET, createCharacterGlbPool, createProceduralAvatar } from '../avatars.js';

// NPC host spawn positions — MUST match server station coordinates in
// apps/server/src/game/stations/catalog.ts (STATION_POSITIONS) within
// each station's radius, or players will get "not_near_station" errors.
//
// Layout (all within 55 units of centre, clustered around the train):
//              [PREDICTION (0, 50)]
//  [INFO (-35,18)]  [TRAIN]  [CASHIER (38,18)]
//      [COINFLIP (-22,-22)]  [RPS (22,-22)]
//                 [DICE (0,-36)]
const WORLD_SECTION_SPAWNS = [
  { x: -35, z: 18 }, // guide (local interactable) -> station_world_info_a
  { x: 38, z: 18 }, // cashier -> station_cashier_bank
  { x: -22, z: -22 }, // coinflip_a -> station_dealer_coinflip_a
  { x: 22, z: -22 }, // rps_a -> station_dealer_rps_a
  { x: 0, z: -36 }, // dice -> station_dealer_dice_a
  { x: 0, z: 50 } // prediction -> station_dealer_prediction_a
];

export const HOST_STATION_PROXY_MAP = {
  station_npc_host_1: 'station_world_info_a',
  station_npc_host_2: 'station_cashier_bank',
  station_npc_host_3: 'station_dealer_coinflip_a',
  station_npc_host_4: 'station_dealer_rps_a',
  station_npc_host_5: 'station_dealer_dice_a',
  station_npc_host_6: 'station_dealer_prediction_a'
};

function roleDetails(role) {
  if (role === 'cashier') {
    return {
      title: 'Rex',
      inspect: '"All transactions, no conversation. I handle your USDC — deposits, withdrawals, player transfers. Your balance is live on-chain. What you see is what you actually have."',
      useLabel: 'Check balance',
      use: '"Balance loaded. Fund to top up, withdraw to pull out, or transfer to another player\'s wallet. Keep a few USDC in reserve — the dealers don\'t extend credit."'
    };
  }
  if (role === 'coinflip') {
    return {
      title: 'Coinflip',
      inspect: '"Heads or tails — oldest game in the world, fairest one in this Arena. The outcome\'s committed on-chain before you even pick a side. No way to rig it. Not even for me."',
      useLabel: 'Let\'s play',
      use: '"Set your wager and hit Play. Once the round locks, pick Heads or Tails. Win and it goes straight to your wallet."'
    };
  }
  if (role === 'rps') {
    return {
      title: 'Axel',
      inspect: '"Rock beats scissors, paper beats rock — you know the rules. What you don\'t know is that every round is sealed by escrow before either of us sees a result. Pure reads, pure nerve."',
      useLabel: 'Challenge me',
      use: '"Hit Play to lock the round, then throw Rock, Paper, or Scissors. Escrow reveals the winner and settles immediately. No takebacks."'
    };
  }
  if (role === 'dice') {
    return {
      title: 'Zara',
      inspect: '"Six faces, one pick — the seed\'s randomised on-chain so neither of us knows the result until it lands. I\'ve been running this table longer than most players have been in the Arena."',
      useLabel: 'Roll with me',
      use: '"Start the round, pick a number from 1 to 6. If the die lands on your number, the pot\'s yours. Start with a small wager until you get the rhythm."'
    };
  }
  if (role === 'prediction') {
    return {
      title: 'Kai',
      inspect: '"I trade outcomes, not cards. My markets are live yes/no questions on real events. Quote a side, check the price, decide if you believe in it. That\'s the whole game."',
      useLabel: 'Browse markets',
      use: '"Refresh the market list, pick a question you have a view on, request a quote, then buy YES or NO. Resolved markets settle automatically and winnings land in your wallet."'
    };
  }
  if (role === 'info') {
    return {
      title: 'Super Agent',
      inspect: '"Everything\'s close — you can see it all from here. South-west is Coinflip, south-east is RPS, straight south is the Dice table. Cashier\'s east of the train. Prediction board is north of everything."',
      useLabel: 'Show me the layout',
      use: '"Coinflip south-west, RPS south-east, Dice straight south. Cashier east of the train. Prediction markets north. Walk toward any of them and press E. Every game runs provably fair escrow on Base."'
    };
  }
  return {
    title: 'Dealer',
    inspect: '"Step up and set your wager. The house is ready when you are."',
    useLabel: 'Play',
    use: '"Round locked. Make your move."'
  };
}

function hostSpec(index) {
  const base = [
    {
      hostId: 'npc_host_guide',
      role: 'guide',
      displayName: 'Super Agent',
      kind: 'world_interactable',
      interactionTag: 'guide_welcome',
      actions: ['interact_open', 'interact_use'],
      yaw: -0.5,   // faces south-east toward the cluster
      radius: 8
    },
    {
      hostId: 'npc_host_cashier',
      role: 'cashier',
      displayName: 'Rex',
      kind: 'cashier_bank',
      interactionTag: 'cashier_host',
      actions: ['balance', 'fund', 'withdraw', 'transfer'],
      yaw: Math.PI - 0.3, // faces south-west toward the cluster
      radius: 8
    },
    {
      hostId: 'npc_host_coinflip_a',
      role: 'coinflip',
      displayName: 'Jade',
      kind: 'dealer_coinflip',
      interactionTag: 'coinflip_a',
      actions: ['coinflip_house_start', 'coinflip_house_pick'],
      yaw: -0.2,   // faces slightly east (toward centre)
      radius: 8
    },
    {
      hostId: 'npc_host_rps_a',
      role: 'rps',
      displayName: 'Axel',
      kind: 'dealer_rps',
      interactionTag: 'rps_a',
      actions: ['rps_house_start', 'rps_house_pick'],
      yaw: 0.2,    // faces slightly west (toward centre)
      radius: 8
    },
    {
      hostId: 'npc_host_dice',
      role: 'dice',
      displayName: 'Zara',
      kind: 'dealer_dice_duel',
      interactionTag: 'dice_host',
      actions: ['dice_duel_start', 'dice_duel_pick'],
      yaw: 0,      // faces north (toward incoming players)
      radius: 8
    },
    {
      hostId: 'npc_host_prediction',
      role: 'prediction',
      displayName: 'Kai',
      kind: 'dealer_prediction',
      interactionTag: 'prediction_host',
      actions: ['prediction_markets_open', 'prediction_market_buy_yes', 'prediction_market_buy_no'],
      yaw: 0.28,
      radius: 7
    }
  ];
  return base[index] || null;
}

function makeHostStationRecord(spec, spawn, index) {
  const localInteraction = roleDetails(spec.role);
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
    // Procedural avatars have their body geometry starting above y=0; use 0 as root.
    // AVATAR_GROUND_OFFSET (-0.7) is reserved for GLB models whose pivot is at the feet.
    procedural.avatar.position.set(station.x, 0, station.z);
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
