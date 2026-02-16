#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[dev-up] starting @arena/server, @arena/agent-runtime, @arena/web"

npm run -w @arena/server dev &
SERVER_PID=$!
npm run -w @arena/agent-runtime dev &
RUNTIME_PID=$!
npm run -w @arena/web dev &
WEB_PID=$!

cleanup() {
  echo
  echo "[dev-up] stopping services"
  kill "$WEB_PID" "$RUNTIME_PID" "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait_for_url() {
  local url="$1"
  local label="$2"
  local max_tries=40
  local i
  for ((i=1; i<=max_tries; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "[dev-up] $label is healthy: $url"
      return 0
    fi
    sleep 1
  done
  echo "[dev-up] timeout waiting for $label ($url)"
  return 1
}

wait_for_url "http://localhost:4000/health" "server"
wait_for_url "http://localhost:4100/health" "agent-runtime"
wait_for_url "http://localhost:3000/health" "web"
wait_for_url "http://localhost:3000/api/chief/v1/heartbeat" "chief"

echo "[dev-up] all services ready"
echo "[dev-up] press Ctrl+C to stop"

wait
