export function challengeReasonLabelForMode(reason, autoApproval) {
  switch (reason) {
    case 'target_not_found':
      return 'Target not found.';
    case 'target_not_nearby':
      return 'Move closer to your target to challenge.';
    case 'player_busy':
      return 'Target is already in a match.';
    case 'wallet_required':
      return 'Wagered matches require wallets. Tip: set wager to 0 (Free) to play instantly.';
    case 'challenger_wallet_policy_disabled':
    case 'opponent_wallet_policy_disabled':
      return 'Wallet policy disabled. Tip: set wager to 0 (Free), or enable wallet skills in Agents page.';
    case 'challenger_insufficient_balance':
    case 'opponent_insufficient_balance':
      return 'Insufficient balance for this wager. Tip: set wager to 0 (Free).';
    case 'challenger_max_bet_percent_exceeded':
    case 'opponent_max_bet_percent_exceeded':
      return 'Wager exceeds one player spend-limit policy.';
    case 'allowance_too_low':
    case 'player_allowance_low':
      return autoApproval
        ? 'Super-agent escrow prep failed on testnet. Retry the challenge in a moment.'
        : 'Escrow approval needed. Tap Approve Escrow, confirm in wallet, then send the challenge again.';
    case 'approve_failed':
      return autoApproval
        ? 'Super-agent approval step failed on testnet. Retry shortly.'
        : 'Wallet approval was not completed. Tap Approve Escrow and confirm in wallet.';
    case 'wallet_prepare_failed':
      return 'Could not prepare escrow approval. Retry in a moment.';
    case 'runtime_unavailable':
      return 'Escrow service is temporarily unavailable. Retry shortly.';
    case 'wallet_not_connected':
      return 'Connect your wallet before wagering.';
    case 'insufficient_funds':
      return 'Wallet balance is too low for this wager.';
    case 'challenge_not_pending':
      return 'Challenge is no longer pending.';
    case 'challenge_not_active':
      return 'Match is not active.';
    case 'not_opponent':
      return 'Only the challenged player can accept.';
    case 'not_participant':
      return 'Only match participants can submit a move.';
    case 'invalid_rps_move':
    case 'invalid_coinflip_move':
    case 'invalid_dice_duel_move':
      return 'Invalid move for current game type.';
    case 'human_challenge_cooldown':
      return 'Target is in cooldown from recent agent challenges.';
    default:
      return reason ? `Action rejected: ${reason}` : 'Challenge action rejected.';
  }
}
