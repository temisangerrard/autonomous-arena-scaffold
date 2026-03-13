# Autoresearch: Code Quality — TypeScript Errors

## Session

- **Metric**: TypeScript error count (`npm run typecheck`)
- **Direction**: lower is better
- **Goal**: 0 errors
- **Benchmark**: `bash autoresearch.sh`

## Baseline

| Run | Errors | Δ | Status | Commit | Notes |
|-----|--------|---|--------|--------|-------|
| 0   | 141    | — | baseline | — | Initial state before any fixes |

## Error Breakdown (baseline)

| Code   | Count | Meaning |
|--------|-------|---------|
| TS2580 | 74    | Cannot find global name (`Buffer`, `process`, etc.) — missing `@types/node` |
| TS2307 | 53    | Cannot find module or type declarations — missing deps/types |
| TS7006 | 12    | Parameter implicitly has type `any` |
| TS2503 | 1     | Cannot find namespace |
| TS2339 | 1     | Property does not exist on type |

## Top Files by Error Count

| File | Errors |
|------|--------|
| apps/server/src/server.ts | 69 |
| packages/shared/src/wsAuth.ts | 8 |
| apps/server/src/lib/http.ts | 7 |
| apps/server/src/lib/env.ts | 7 |
| apps/server/src/sessionStore.ts | 5 |
| apps/server/src/worldAssets.ts | 4 |
| apps/server/src/chief/toolExecutor.ts | 4 |
| apps/server/src/chief/skillCatalog.ts | 4 |

## Loop Rules (agent instructions)

1. Pick the highest-impact fix (most errors eliminated per change).
2. Run `bash autoresearch.sh` to measure the new error count.
3. If the count went down → commit the change and log the run below.
4. If the count went up or stayed the same → revert and try a different fix.
5. Never skip or suppress errors (no `@ts-ignore`, `any` casts, or `// @ts-nocheck`).
6. Repeat until 0 errors.

## Run Log

<!-- append new rows here after each iteration -->
| 1 | 41  | -100 | ✅ fixed | — | Add `@types/node` to all workspaces (agent-runtime, server, shared, sdk) |
| 2 | 18  | -23  | ✅ fixed | — | Install `vitest` in all workspaces that run tests |
| 3 | 0   | -18  | ✅ fixed | — | Install `vitest` + `google-auth-library` in web workspace |
| 4 | 0   | 0    | ✅ fixed | — | ESLint: remove unused imports, replace `as any` with `ContractRunner`/typed helpers, `unknown` in .d.ts, global declarations in JS test files |
