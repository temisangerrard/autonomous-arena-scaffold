#!/usr/bin/env bash
# autoresearch benchmark: AgentBot activity coverage
# Metric: uncovered statements in apps/agent-runtime/src/AgentBot.ts (lower = better, goal: 0)
# Usage: bash autoresearch-agent-activities.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/apps/agent-runtime"

# Run vitest with v8 JSON coverage scoped to AgentBot.ts
npx vitest run \
  --coverage \
  --coverage.include='src/AgentBot.ts' \
  --coverage.reporter=json \
  --reporter=dot \
  2>/dev/null

# Count uncovered statements from JSON report
python3 - <<'EOF'
import json, sys

with open("coverage/coverage-final.json") as f:
    data = json.load(f)

key = next((k for k in data if "AgentBot" in k), None)
if not key:
    print(0)
    sys.exit(0)

statements = data[key]["s"]
uncovered = sum(1 for v in statements.values() if v == 0)
print(uncovered)
EOF
