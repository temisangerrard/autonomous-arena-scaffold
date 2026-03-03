export type ArenaZone = 'entry' | 'ring';
export type ArenaUiRole = 'cashier' | 'coinflip' | 'rps' | 'dice' | 'market';

export type ArenaStationLayout = {
  id: string;
  x: number;
  z: number;
  arenaZone: ArenaZone;
  uiRole: ArenaUiRole;
  primaryVenue: boolean;
};

// Coordinates mirror STATION_POSITIONS in apps/server/src/game/stations/catalog.ts.
// All stations sit within a 55-unit radius of the world centre:
//
//              [KAI — Prediction  (0, 50)]
//  [MARA — Coinflip (-35,18)]  [TRAIN]  [REX — Cashier (38,18)]
//      [JADE — Coinflip (-22,-22)]  [AXEL — RPS (22,-22)]
//                 [ZARA — Dice (0,-36)]
export const ARENA_PUBLIC_STATION_LAYOUT: ArenaStationLayout[] = [
  {
    id: 'station_world_info_a',
    x: -35,
    z: 18,
    arenaZone: 'ring',
    uiRole: 'coinflip',
    primaryVenue: true
  },
  {
    id: 'station_cashier_bank',
    x: 38,
    z: 18,
    arenaZone: 'ring',
    uiRole: 'cashier',
    primaryVenue: true
  },
  {
    id: 'station_dealer_coinflip_a',
    x: -22,
    z: -22,
    arenaZone: 'ring',
    uiRole: 'coinflip',
    primaryVenue: true
  },
  {
    id: 'station_dealer_rps_a',
    x: 22,
    z: -22,
    arenaZone: 'ring',
    uiRole: 'rps',
    primaryVenue: true
  },
  {
    id: 'station_dealer_dice_a',
    x: 0,
    z: -36,
    arenaZone: 'ring',
    uiRole: 'dice',
    primaryVenue: true
  },
  {
    id: 'station_dealer_prediction_a',
    x: 0,
    z: 50,
    arenaZone: 'ring',
    uiRole: 'market',
    primaryVenue: true
  }
];

export function arenaPrimaryStationIds(): string[] {
  return ARENA_PUBLIC_STATION_LAYOUT.filter((station) => station.primaryVenue).map((station) => station.id);
}

export function getArenaStationById(id: string): ArenaStationLayout | null {
  return ARENA_PUBLIC_STATION_LAYOUT.find((station) => station.id === id) || null;
}
