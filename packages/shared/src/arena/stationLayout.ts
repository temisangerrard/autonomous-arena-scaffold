export type ArenaZone = 'entry' | 'ring';
export type ArenaUiRole = 'guide' | 'cashier' | 'coinflip' | 'rps' | 'dice' | 'market';

export type ArenaStationLayout = {
  id: string;
  x: number;
  z: number;
  arenaZone: ArenaZone;
  uiRole: ArenaUiRole;
  primaryVenue: boolean;
};

export const ARENA_PUBLIC_STATION_LAYOUT: ArenaStationLayout[] = [
  {
    id: 'station_world_info_a',
    x: -70,
    z: 43,
    arenaZone: 'entry',
    uiRole: 'guide',
    primaryVenue: true
  },
  {
    id: 'station_cashier_bank',
    x: 78,
    z: -41,
    arenaZone: 'ring',
    uiRole: 'cashier',
    primaryVenue: true
  },
  {
    id: 'station_dealer_coinflip_a',
    x: -25,
    z: -24,
    arenaZone: 'ring',
    uiRole: 'coinflip',
    primaryVenue: true
  },
  {
    id: 'station_dealer_rps_a',
    x: 25,
    z: -24,
    arenaZone: 'ring',
    uiRole: 'rps',
    primaryVenue: true
  },
  {
    id: 'station_dealer_dice_a',
    x: -78,
    z: -37,
    arenaZone: 'ring',
    uiRole: 'dice',
    primaryVenue: true
  },
  {
    id: 'station_dealer_prediction_a',
    x: -70,
    z: 41,
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
