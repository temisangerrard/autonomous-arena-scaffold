const runtimeUrl = String(process.env.RUNTIME_URL || 'https://arena-runtime-mfpf3lbsba-uc.a.run.app').replace(/\/+$/, '');
const internalToken = String(process.env.INTERNAL_SERVICE_TOKEN || '');
const playerWalletId = String(process.env.PLAYER_WALLET_ID || '');
const houseWalletId = String(process.env.HOUSE_WALLET_ID || '');
const amount = Math.max(0, Number(process.env.WAGER || 1));

function statusLine(level, text, detail = '') {
  const icon = level === 'green' ? 'GREEN' : level === 'yellow' ? 'YELLOW' : 'RED';
  const suffix = detail ? ` | ${detail}` : '';
  console.log(`[${icon}] ${text}${suffix}`);
}

async function fetchJson(path, init = {}) {
  const response = await fetch(`${runtimeUrl}${path}`, init);
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function main() {
  const { response, payload } = await fetchJson('/status');
  if (!response.ok || !payload) {
    statusLine('red', 'Runtime status unavailable', `http=${response.status}`);
    process.exit(1);
  }

  statusLine(
    payload.wsAuthMismatchLikely ? 'yellow' : 'green',
    'Runtime WS auth check',
    `wsAuthMismatchLikely=${Boolean(payload.wsAuthMismatchLikely)}`
  );
  statusLine(
    Number(payload.connectedBotCount || 0) > 0 ? 'green' : 'yellow',
    'Bot connectivity',
    `connected=${Number(payload.connectedBotCount || 0)}/${Number(payload.configuredBotCount || 0)}`
  );

  const sponsor = payload?.house?.sponsorGas;
  if (sponsor && typeof sponsor === 'object') {
    const sponsorStatus = String(sponsor.status || 'unknown').toLowerCase();
    const level = sponsorStatus === 'green'
      ? 'green'
      : sponsorStatus === 'yellow'
        ? 'yellow'
        : sponsorStatus === 'red'
          ? 'red'
          : 'yellow';
    const detail = [
      `address=${String(sponsor.address || 'missing')}`,
      `balanceEth=${String(sponsor.balanceEth ?? 'unknown')}`,
      `thresholdEth=${String(sponsor.thresholdEth ?? 'n/a')}`,
      `topupEth=${String(sponsor.topupEth ?? 'n/a')}`,
      sponsor.error ? `error=${String(sponsor.error)}` : ''
    ].filter(Boolean).join(' ');
    statusLine(level, 'Sponsor gas status', detail);
  } else {
    statusLine('yellow', 'Sponsor gas status unavailable', 'runtime /status has no house.sponsorGas diagnostics');
  }

  const house = payload?.house?.wallet;
  const inferredHouseWalletId = houseWalletId || String(house?.id || '');
  const inferredPlayerWalletId = playerWalletId || String(payload?.profiles?.find((entry) => String(entry?.walletId || '').length > 0)?.walletId || '');
  statusLine(inferredHouseWalletId ? 'green' : 'red', 'House wallet detected', inferredHouseWalletId || 'missing');
  statusLine(inferredPlayerWalletId ? 'green' : 'yellow', 'Sample player wallet detected', inferredPlayerWalletId || 'missing');

  if (!internalToken || !inferredHouseWalletId || !inferredPlayerWalletId || amount <= 0) {
    statusLine('yellow', 'Skipping sponsorship dry-check', 'Set INTERNAL_SERVICE_TOKEN + PLAYER_WALLET_ID + HOUSE_WALLET_ID (+ optional WAGER)');
    return;
  }

  const prep = await fetchJson('/wallets/onchain/prepare-escrow', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': internalToken
    },
    body: JSON.stringify({
      walletIds: [inferredPlayerWalletId, inferredHouseWalletId],
      amount
    })
  });
  if (!prep.response.ok || !prep.payload?.ok) {
    statusLine('red', 'Sponsorship preflight failed', String(prep.payload?.reason || `http_${prep.response.status}`));
    process.exit(2);
  }
  statusLine('green', 'Sponsorship preflight passed', `wallets=${[inferredPlayerWalletId, inferredHouseWalletId].join(',')} amount=${amount}`);
}

main().catch((error) => {
  statusLine('red', 'Runtime sponsorship check crashed', String(error?.message || error));
  process.exit(1);
});
