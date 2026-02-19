export function parseDealerGameType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'rps') return 'rps';
  if (normalized === 'coinflip') return 'coinflip';
  if (normalized === 'dice_duel' || normalized === 'dice' || normalized === 'dice-duel') return 'dice_duel';
  return '';
}

export function deriveDealerGameType(stateName, view, station) {
  const fromView = parseDealerGameType(view?.gameType || view?.game || view?.mode);
  if (fromView) return fromView;
  const name = String(stateName || '').toLowerCase();
  if (name.includes('_rps')) return 'rps';
  if (name.includes('_dice')) return 'dice_duel';
  const stationKind = String(station?.kind || '').toLowerCase();
  if (stationKind === 'dealer_rps') return 'rps';
  if (stationKind === 'dealer_dice_duel') return 'dice_duel';
  if (stationKind === 'dealer_coinflip') return 'coinflip';
  return '';
}
