export function dealerReasonLabel(reason, reasonCode) {
  const code = String(reasonCode || '').toUpperCase();
  const raw = String(reason || '').toLowerCase();
  if (code === 'PLAYER_GAS_LOW' || raw.includes('gas_low')) {
    return 'Insufficient gas. Top up ETH to continue.';
  }
  if (code === 'HOUSE_GAS_LOW' || raw.includes('gas_topup_failed') || raw.includes('insufficient funds')) {
    return 'House sponsor wallet is out of Sepolia ETH gas. Top up sponsor wallet, then retry.';
  }
  if (code === 'PLAYER_BALANCE_LOW' || raw.includes('insufficient_balance')) {
    return 'Insufficient balance for this wager. Lower wager or fund wallet.';
  }
  if (code === 'PLAYER_APPROVAL_REQUIRED' || code === 'PLAYER_ALLOWANCE_LOW' || raw.includes('approval') || raw.includes('allowance')) {
    return 'Escrow approval required. Approve and retry.';
  }
  if (code === 'HOUSE_ALLOWANCE_LOW') {
    return 'House escrow approval is not ready. House operator should refresh allowance, then retry.';
  }
  if (code === 'PLAYER_SIGNER_UNAVAILABLE') {
    return 'Player wallet signer unavailable. Reconnect wallet session and retry.';
  }
  if (code === 'HOUSE_SIGNER_UNAVAILABLE') {
    return 'House wallet signer unavailable. House operator must restore signer, then retry.';
  }
  if (code === 'RPC_UNAVAILABLE' || raw.includes('rpc') || raw.includes('network')) {
    return 'Onchain network is unavailable right now. Retry in a moment.';
  }
  if (code === 'UNKNOWN_PRECHECK_FAILURE') {
    return 'Escrow precheck failed. Retry once; if it persists, inspect runtime preflight logs.';
  }
  if (raw === 'not_near_station') {
    return 'Move closer to this station, then start the round again.';
  }
  if (raw === 'station_not_found') {
    return 'Station mapping is unavailable right now. Re-target a nearby dealer.';
  }
  if (raw === 'position_unknown') {
    return 'Player position not synced yet. Move briefly and retry.';
  }
  if (raw === 'wallet_required') {
    return 'Wallet not ready for escrow sponsorship. Reconnect wallet and retry.';
  }
  if (raw === 'dealer_round_not_started') {
    return 'Start a round first, then submit your pick.';
  }
  if (raw === 'dealer_round_expired') {
    return 'Round expired. Start a new round.';
  }
  if (raw === 'invalid_station_kind' || raw === 'invalid_station_action') {
    return 'This NPC cannot run that action. Try the station\'s primary game action.';
  }
  if (code === 'BET_ID_ALREADY_USED' || raw.includes('bet_already_exists')) {
    return 'Escrow id collision detected. Please retry the round.';
  }
  if (code === 'INVALID_WAGER' || raw === 'invalid_amount') {
    return 'Invalid wager amount. Enter a valid amount and retry.';
  }
  if (code === 'INVALID_ESCROW_PARTICIPANTS' || raw === 'invalid_address') {
    return 'Wallet participants are invalid. Reconnect and retry.';
  }
  if (code === 'BET_NOT_LOCKED' || raw === 'bet_not_locked') {
    return 'Escrow lock is missing for this round. Start a new round.';
  }
  if (code === 'WINNER_NOT_PARTICIPANT' || raw === 'winner_not_participant') {
    return 'Escrow winner wallet is invalid for this round.';
  }
  if (code === 'ONCHAIN_EXECUTION_ERROR') {
    return 'Onchain escrow transaction failed. Retry shortly.';
  }
  if (code === 'INTERNAL_AUTH_FAILED') {
    return 'Operator auth mismatch detected. Retry while operator refreshes runtime auth.';
  }
  if (code === 'INTERNAL_TRANSPORT_ERROR' || raw.includes('wallet_prepare_timeout') || raw.includes('wallet_prepare_unreachable')) {
    return 'Escrow prep network is unstable. Retry in a moment.';
  }
  return reason ? 'Station request failed. Please retry.' : '';
}
