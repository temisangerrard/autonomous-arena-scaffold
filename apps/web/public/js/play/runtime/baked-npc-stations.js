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

const WORLD_SECTION_SPAWNS = [
  { x: -80, z: -45 },
  { x: -25, z: -30 },
  { x: 25, z: -30 },
  { x: 80, z: -45 },
  { x: -80, z: 45 },
  { x: -25, z: 30 },
  { x: 25, z: 30 },
  { x: 80, z: 55 }
];
const MAX_BAKED_STATIONS_PER_SECTION = 3;
const SECTION_KIND_ROTATIONS = [
  ['dealer_dice_duel', 'world_interactable', 'dealer_coinflip'],
  ['cashier_bank', 'dealer_coinflip', 'world_interactable'],
  ['dealer_rps', 'dealer_coinflip', 'world_interactable'],
  ['cashier_bank', 'world_interactable', 'dealer_rps'],
  ['world_interactable', 'dealer_dice_duel', 'dealer_coinflip'],
  ['dealer_rps', 'cashier_bank', 'world_interactable'],
  ['dealer_coinflip', 'dealer_rps', 'world_interactable'],
  ['dealer_dice_duel', 'dealer_coinflip', 'world_interactable']
];

function inferKindFromName(name) {
  const raw = normalizeName(name).toLowerCase();
  if (raw.includes('cashier') || raw.includes('bank')) return 'cashier_bank';
  if (raw.includes('dice') || raw.includes('duel')) return 'dealer_dice_duel';
  if (raw.includes('rps') || raw.includes('rock') || raw.includes('paper') || raw.includes('scissors')) return 'dealer_rps';
  if (raw.includes('coin') || raw.includes('flip')) return 'dealer_coinflip';
  if (raw.includes('info') || raw.includes('guide') || raw.includes('kiosk')) return 'world_interactable';
  return null;
}

export function nearestSectionIndexForPosition(x, z) {
  let bestIdx = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < WORLD_SECTION_SPAWNS.length; i += 1) {
    const spawn = WORLD_SECTION_SPAWNS[i];
    const dist = Math.hypot(Number(spawn?.x || 0) - Number(x || 0), Number(spawn?.z || 0) - Number(z || 0));
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function fallbackKindForSection(sectionIndex, slotIndex = 0) {
  const safeSection = Math.max(0, Math.min(SECTION_KIND_ROTATIONS.length - 1, Number(sectionIndex || 0)));
  const sequence = SECTION_KIND_ROTATIONS[safeSection] || SECTION_KIND_ROTATIONS[0];
  const slot = Math.max(0, Number(slotIndex || 0));
  return sequence[slot % sequence.length] || 'world_interactable';
}

function labelForKind(kind) {
  if (kind === 'cashier_bank') return 'Cashier Operator';
  if (kind === 'dealer_coinflip') return 'Coinflip Dealer';
  if (kind === 'dealer_rps') return 'RPS Dealer';
  if (kind === 'dealer_dice_duel') return 'Dice Duel Dealer';
  return 'Info Host';
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
  const sectionSlotCounts = new Map();
  let index = 0;
  worldRoot.traverse((node) => {
    if (!node || !node.isMesh) return;
    if (!isNpcLikeName(node.name)) return;

    const worldPos = node.getWorldPosition(new THREE.Vector3());
    const bucket = `${Math.round(worldPos.x * 2)}:${Math.round(worldPos.z * 2)}`;
    if (seenBuckets.has(bucket)) return;
    seenBuckets.add(bucket);

    const sectionIndex = nearestSectionIndexForPosition(worldPos.x, worldPos.z);
    const assignedCount = Number(sectionSlotCounts.get(sectionIndex) || 0);
    if (assignedCount >= MAX_BAKED_STATIONS_PER_SECTION) {
      return;
    }
    const inferredKind = inferKindFromName(node.name);
    const kind = inferredKind || fallbackKindForSection(sectionIndex, assignedCount);
    sectionSlotCounts.set(sectionIndex, assignedCount + 1);
    const role = inferRole(kind);
    const shortName = slugify(node.name) || `npc_${index + 1}`;
    const stationId = `station_baked_npc_${index + 1}`;
    index += 1;

    bakedStations.set(stationId, {
      id: stationId,
      source: 'baked',
      hostRole: role,
      kind,
      displayName: `S${sectionIndex + 1} ${labelForKind(kind)} ${assignedCount + 1}: ${shortName}`,
      x: Number(worldPos.x || 0),
      z: Number(worldPos.z || 0),
      yaw: 0,
      radius: kind === 'world_interactable' ? 8 : 7,
      interactionTag: interactionTagForKind(kind),
      actions: actionsForKind(kind),
      proxyStationId: '',
      localInteraction: kind === 'world_interactable'
        ? {
            title: `Section ${sectionIndex + 1} Coordinator`,
            inspect: 'This host coordinates active games in this section.',
            useLabel: 'View Jobs',
            use: 'Coinflip, RPS, and Dice Duel hosts are active nearby. Start at any dealer station.'
          }
        : null
    });
  });

  return bakedStations;
}
