#!/usr/bin/env bash
set -euo pipefail

FRESH_URL="${FRESH_URL:-https://autobett-fly-fresh-0224.netlify.app}"
MAIN_URL="${MAIN_URL:-https://autobett.netlify.app}"

jget() {
  local url="$1"
  curl -fsS "$url"
}

echo "[parity] comparing runtime-config.js origins"
echo "fresh=$FRESH_URL"
echo "main=$MAIN_URL"

fresh_runtime="$(jget "$FRESH_URL/runtime-config.js" | sed -n '1,120p')"
main_runtime="$(jget "$MAIN_URL/runtime-config.js" | sed -n '1,120p')"

echo "\n--- fresh runtime-config.js ---"
printf '%s\n' "$fresh_runtime"
echo "\n--- main runtime-config.js ---"
printf '%s\n' "$main_runtime"

echo "\n[parity] /api/config"
fresh_cfg="$(jget "$FRESH_URL/api/config")"
main_cfg="$(jget "$MAIN_URL/api/config")"

echo "\n--- fresh /api/config (auth/ws subset) ---"
printf '%s' "$fresh_cfg" | jq '{googleClientId,authEnabled,googleAuthEnabled,emailAuthEnabled,localAuthEnabled,gameWsUrl,worldAssetBaseUrl}'

echo "\n--- main /api/config (auth/ws subset) ---"
printf '%s' "$main_cfg" | jq '{googleClientId,authEnabled,googleAuthEnabled,emailAuthEnabled,localAuthEnabled,gameWsUrl,worldAssetBaseUrl}'


echo "\n[parity] health"
for base in "$FRESH_URL" "$MAIN_URL"; do
  echo "-- $base/health"
  curl -fsS "$base/health" | jq '.'
  echo "-- $base/server/health"
  curl -fsS "$base/server/health" | jq '.'
  echo "-- $base/runtime/health"
  curl -fsS "$base/runtime/health" | jq '.'
done

echo "\n[parity] done"
