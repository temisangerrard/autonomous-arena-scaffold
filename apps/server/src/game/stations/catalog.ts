import type { SnapshotStation, StationActionId } from '@arena/shared';
import { WORLD_SECTION_SPAWNS } from '../../WorldSim.js';

export function buildStations(options: { diceDuelEnabled: boolean }): SnapshotStation[] {
  const { diceDuelEnabled } = options;
  const stations: SnapshotStation[] = [
    {
      id: 'station_world_info_a',
      kind: 'world_interactable',
      displayName: 'Info Kiosk',
      x: (WORLD_SECTION_SPAWNS[4]?.x ?? -80) + 8,
      z: (WORLD_SECTION_SPAWNS[4]?.z ?? 45) - 4,
      yaw: 0,
      radius: 6.5,
      interactionTag: 'info_kiosk',
      actions: ['interact_open', 'interact_use'] satisfies StationActionId[]
    },
    {
      id: 'station_cashier_bank',
      kind: 'cashier_bank',
      displayName: 'Cashier',
      x: (WORLD_SECTION_SPAWNS[3]?.x ?? 80) - 2,
      z: (WORLD_SECTION_SPAWNS[3]?.z ?? -45) + 4,
      yaw: 0,
      actions: ['balance', 'fund', 'withdraw', 'transfer'] satisfies StationActionId[]
    },
    {
      id: 'station_dealer_coinflip_a',
      kind: 'dealer_coinflip',
      displayName: 'Coinflip Dealer A',
      x: (WORLD_SECTION_SPAWNS[1]?.x ?? -25) + 0,
      z: (WORLD_SECTION_SPAWNS[1]?.z ?? -30) + 6,
      yaw: 0,
      actions: ['coinflip_house_start', 'coinflip_house_pick'] satisfies StationActionId[]
    },
    {
      id: 'station_dealer_rps_a',
      kind: 'dealer_rps',
      displayName: 'RPS Dealer A',
      x: (WORLD_SECTION_SPAWNS[2]?.x ?? 25) + 0,
      z: (WORLD_SECTION_SPAWNS[2]?.z ?? -30) + 6,
      yaw: 0,
      actions: ['rps_house_start', 'rps_house_pick'] satisfies StationActionId[]
    },
    {
      id: 'station_dealer_prediction_a',
      kind: 'dealer_prediction',
      displayName: 'Prediction Dealer A',
      x: (WORLD_SECTION_SPAWNS[4]?.x ?? -80) + 10,
      z: (WORLD_SECTION_SPAWNS[4]?.z ?? 45) - 2,
      yaw: 0,
      actions: [
        'prediction_markets_open',
        'prediction_market_buy_yes',
        'prediction_market_buy_no'
      ] satisfies StationActionId[]
    }
  ];

  if (diceDuelEnabled) {
    stations.push(
      {
        id: 'station_dealer_dice_a',
        kind: 'dealer_dice_duel',
        displayName: 'Dice Dealer A',
        x: (WORLD_SECTION_SPAWNS[0]?.x ?? -80) + 2,
        z: (WORLD_SECTION_SPAWNS[0]?.z ?? -45) + 8,
        yaw: 0,
        actions: ['dice_duel_start', 'dice_duel_pick'] satisfies StationActionId[]
      }
    );
  }

  return stations;
}
