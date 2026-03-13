#!/usr/bin/env bash
# autoresearch benchmark script
# Measures: TypeScript error count (lower = better)
# Usage: bash autoresearch.sh
# Outputs: a single integer (the metric value)

set -euo pipefail

COUNT=$(npm run typecheck 2>&1 | grep -c "error TS" || true)
echo "$COUNT"
