import { describe, expect, it } from 'vitest';
import { dealerReasonLabel } from '../public/js/play/runtime/dealer-reasons.js';

describe('dealerReasonLabel', () => {
  it('maps station router proximity failures', () => {
    expect(dealerReasonLabel('not_near_station', '')).toContain('Move closer');
    expect(dealerReasonLabel('station_not_found', '')).toContain('mapping');
    expect(dealerReasonLabel('position_unknown', '')).toContain('position');
  });

  it('maps wallet and round state failures', () => {
    expect(dealerReasonLabel('wallet_required', '')).toContain('Wallet');
    expect(dealerReasonLabel('dealer_round_not_started', '')).toContain('Start a round');
    expect(dealerReasonLabel('dealer_round_expired', '')).toContain('expired');
  });

  it('maps internal transport/auth errors', () => {
    expect(dealerReasonLabel('wallet_prepare_timeout', 'INTERNAL_TRANSPORT_ERROR')).toContain('network');
    expect(dealerReasonLabel('wallet_prepare_http_401', 'INTERNAL_AUTH_FAILED')).toContain('auth');
  });

  it('maps onchain preflight allowance and signer failures', () => {
    expect(dealerReasonLabel('allowance_too_low', 'PLAYER_ALLOWANCE_LOW')).toContain('approval');
    expect(dealerReasonLabel('wallet_signer_unavailable', 'PLAYER_SIGNER_UNAVAILABLE')).toContain('wallet');
    expect(dealerReasonLabel('wallet_signer_unavailable', 'HOUSE_SIGNER_UNAVAILABLE')).toContain('House');
  });
});
