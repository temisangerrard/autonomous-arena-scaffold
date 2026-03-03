import type { SnapshotStation, StationActionId } from '@arena/shared';

// Station positions — all coordinates in world units (world bound ±120).
// Layout: tight horseshoe around the central train (X[-20,20] Z[-8,8]).
// All six stations sit within a 55-unit radius of centre so players can
// see every venue from spawn and walk between them in seconds.
//
//                 [PREDICTION  (0, 50)]
//
//  [INFO (-35,18)]  [TRAIN]  [CASHIER (38,18)]
//
//       [COINFLIP (-22,-22)]  [RPS (22,-22)]
//                  [DICE (0,-36)]
//                       ↑ players spawn south ~z-55
//
// When editing positions also update:
//   packages/shared/src/arena/stationLayout.ts   (UI map)
//   apps/web/public/js/play/runtime/world-npc-hosts.js  (NPC spawns, must stay within station.radius)

export const STATION_POSITIONS = {
  info:       { x: -35, z: 18  },
  cashier:    { x:  38, z: 18  },
  coinflip:   { x: -22, z: -22 },
  rps:        { x:  22, z: -22 },
  dice:       { x:   0, z: -36 },
  prediction: { x:   0, z:  50 },
} as const;

export function buildStations(options: { diceDuelEnabled: boolean }): SnapshotStation[] {
  const { diceDuelEnabled } = options;
  const stations: SnapshotStation[] = [
    {
      id: 'station_world_info_a',
      kind: 'dealer_coinflip',
      displayName: 'Coinflip',
      x: STATION_POSITIONS.info.x,
      z: STATION_POSITIONS.info.z,
      yaw: -0.5,
      radius: 8,
      interactionTag: 'coinflip_b',
      actions: ['coinflip_house_start', 'coinflip_house_pick'] satisfies StationActionId[]
    },
    {
      id: 'station_cashier_bank',
      kind: 'cashier_bank',
      displayName: 'Cashier',
      x: STATION_POSITIONS.cashier.x,
      z: STATION_POSITIONS.cashier.z,
      yaw: Math.PI,
      radius: 8,
      actions: ['balance', 'fund', 'withdraw', 'transfer'] satisfies StationActionId[]
    },
    {
      id: 'station_dealer_coinflip_a',
      kind: 'dealer_coinflip',
      displayName: 'Coinflip',
      x: STATION_POSITIONS.coinflip.x,
      z: STATION_POSITIONS.coinflip.z,
      yaw: 0.3,
      radius: 8,
      actions: ['coinflip_house_start', 'coinflip_house_pick'] satisfies StationActionId[]
    },
    {
      id: 'station_dealer_rps_a',
      kind: 'dealer_rps',
      displayName: 'RPS',
      x: STATION_POSITIONS.rps.x,
      z: STATION_POSITIONS.rps.z,
      yaw: -0.3,
      radius: 8,
      actions: ['rps_house_start', 'rps_house_pick'] satisfies StationActionId[]
    },
    {
      id: 'station_dealer_prediction_a',
      kind: 'dealer_prediction',
      displayName: 'Prediction Markets',
      x: STATION_POSITIONS.prediction.x,
      z: STATION_POSITIONS.prediction.z,
      yaw: Math.PI,
      radius: 10,
      actions: [
        'prediction_markets_open',
        'prediction_market_buy_yes',
        'prediction_market_buy_no'
      ] satisfies StationActionId[]
    }
  ];

  if (diceDuelEnabled) {
    stations.push({
      id: 'station_dealer_dice_a',
      kind: 'dealer_dice_duel',
      displayName: 'Dice',
      x: STATION_POSITIONS.dice.x,
      z: STATION_POSITIONS.dice.z,
      yaw: 0,
      radius: 8,
      actions: ['dice_duel_start', 'dice_duel_pick'] satisfies StationActionId[]
    });
  }

  return stations;
}
