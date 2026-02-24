#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://autobett-fly-fresh-0224.netlify.app}"
COOKIES="${COOKIES:-/tmp/arena_cutover.cookies}"
EMAIL="${EMAIL:-cutover+$(date +%s)@example.com}"
PASSWORD="${PASSWORD:-TestPass123!}"

rm -f "$COOKIES"

echo "[smoke] base=$BASE_URL"

echo "[smoke] /api/config"
CONFIG_JSON="$(curl -fsS "$BASE_URL/api/config?t=$(date +%s)")"
printf '%s' "$CONFIG_JSON" | jq '{authEnabled,googleAuthEnabled,emailAuthEnabled,localAuthEnabled}'

echo "[smoke] signup"
SIGNUP_PAYLOAD=$(jq -cn --arg email "$EMAIL" --arg password "$PASSWORD" '{email:$email,password:$password,mode:"signup"}')
SIGNUP_HTTP=$(curl -sS -o /tmp/cutover_signup.json -w '%{http_code}' -c "$COOKIES" \
  -X POST "$BASE_URL/api/auth/email" \
  -H 'content-type: application/json' \
  -H "origin: $BASE_URL" \
  --data "$SIGNUP_PAYLOAD")
echo "status=$SIGNUP_HTTP email=$EMAIL"
cat /tmp/cutover_signup.json | jq '{ok,reason,redirectTo,user:{email,role,profileId,walletId,username}}'

echo "[smoke] session"
curl -fsS -b "$COOKIES" "$BASE_URL/api/session" | jq '{ok,user:{email,role,profileId,walletId}}'

echo "[smoke] player bootstrap"
curl -fsS -b "$COOKIES" "$BASE_URL/api/player/bootstrap" | jq '{ok,player:{id,username,walletId},wallet:(.wallet|{id,address,balance})}'

echo "[smoke] wallet summary"
curl -fsS -b "$COOKIES" "$BASE_URL/api/player/wallet/summary" | jq '{ok,summary:(.summary // .wallet // .data // {})}'

echo "[smoke] admin endpoint should reject non-admin"
ADMIN_HTTP=$(curl -sS -o /tmp/cutover_admin.json -w '%{http_code}' -b "$COOKIES" "$BASE_URL/api/chief/v1/skills")
echo "status=$ADMIN_HTTP"
cat /tmp/cutover_admin.json | jq '{ok,reason}' || true

echo "[smoke] done"
