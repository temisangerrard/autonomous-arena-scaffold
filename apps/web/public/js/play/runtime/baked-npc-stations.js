function normalizeName(value) {
  return String(value || '').trim();
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function isNpcLikeName(name) {
  const raw = normalizeName(name).toLowerCase();
  if (!raw) return false;
  return raw.startsWith('npc_')
    || raw.startsWith('npc-')
    || raw.startsWith('npc')
    || raw.includes('_npc_')
    || raw.includes(' npc')
    || raw.includes('juniper')
    || raw.includes('cashier')
    || raw.includes('dealer')
    || raw.includes('vendor')
    || raw.includes('kiosk');
}

function inferKind(name) {
  const raw = normalizeName(name).toLowerCase();
  if (raw.includes('cashier') || raw.includes('bank')) return 'cashier_bank';
  if (raw.includes('dice') || raw.includes('duel')) return 'dealer_dice_duel';
  if (raw.includes('rps') || raw.includes('rock') || raw.includes('paper') || raw.includes('scissors')) return 'dealer_rps';
  if (raw.includes('coin') || raw.includes('flip')) return 'dealer_coinflip';
  return 'world_interactable';
}

function inferRole(kind) {
  if (kind === 'cashier_bank') return 'cashier';
  if (kind === 'dealer_coinflip') return 'coinflip';
  if (kind === 'dealer_rps') return 'rps';
  if (kind === 'dealer_dice_duel') return 'dice';
  return 'info';
}

function actionsForKind(kind) {
  if (kind === 'cashier_bank') return ['balance', 'fund', 'withdraw', 'transfer'];
  if (kind === 'dealer_coinflip') return ['coinflip_house_start', 'coinflip_house_pick'];
  if (kind === 'dealer_rps') return ['rps_house_start', 'rps_house_pick'];
  if (kind === 'dealer_dice_duel') return ['dice_duel_start', 'dice_duel_pick'];
  return ['interact_open', 'interact_use'];
}

function interactionTagForKind(kind) {
  if (kind === 'cashier_bank') return 'cashier_baked';
  if (kind === 'dealer_coinflip') return 'coinflip_baked';
  if (kind === 'dealer_rps') return 'rps_baked';
  if (kind === 'dealer_dice_duel') return 'dice_baked';
  return 'info_kiosk';
}

export function extractBakedNpcStations({ THREE, worldRoot }) {
  const bakedStations = new Map();
  if (!worldRoot || !THREE) return bakedStations;

  const seenBuckets = new Set();
  let index = 0;
  worldRoot.traverse((node) => {
    if (!node || !node.isMesh) return;
    if (!isNpcLikeName(node.name)) return;

    const worldPos = node.getWorldPosition(new THREE.Vector3());
    const bucket = `${Math.round(worldPos.x * 2)}:${Math.round(worldPos.z * 2)}`;
    if (seenBuckets.has(bucket)) return;
    seenBuckets.add(bucket);

    const kind = inferKind(node.name);
    const role = inferRole(kind);
    const shortName = slugify(node.name) || `npc_${index + 1}`;
    const stationId = `station_baked_npc_${index + 1}`;
    index += 1;

    bakedStations.set(stationId, {
      id: stationId,
      source: 'baked',
      hostRole: role,
      kind,
      displayName: `Baked NPC ${index}: ${shortName}`,
      x: Number(worldPos.x || 0),
      z: Number(worldPos.z || 0),
      yaw: 0,
      radius: kind === 'world_interactable' ? 8 : 7,
      interactionTag: interactionTagForKind(kind),
      actions: actionsForKind(kind),
      proxyStationId: '',
      localInteraction: kind === 'world_interactable'
        ? {
            title: 'World NPC',
            inspect: 'This baked NPC is now active as a world interaction point.',
            useLabel: 'Talk',
            use: 'You can challenge nearby players after visiting game hosts.'
          }
        : null
    });
  });

  return bakedStations;
}
