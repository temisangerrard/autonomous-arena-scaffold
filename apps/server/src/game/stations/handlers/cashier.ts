export function unsupportedCashierActionView() {
  return {
    ok: false,
    state: 'dealer_error',
    reason: 'cashier_actions_use_http_api'
  };
}
