#!/usr/bin/env bash
# Measure dead code and unused exports via knip.
# Lower is better; goal is 0.
set -euo pipefail
cd "$(dirname "$0")"
npx knip --reporter compact 2>/dev/null | grep -cE "^(apps|packages|scripts)/" || true
