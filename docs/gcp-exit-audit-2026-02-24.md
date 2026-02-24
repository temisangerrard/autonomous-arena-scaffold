# GCP Exit Audit - 2026-02-24

## Scope
Comparison between:
- Main production frontend: `https://autobett.netlify.app` (Cloud Run backends)
- Fresh migration frontend: `https://autobett-fly-fresh-0224.netlify.app` (Fly backends)

## Admin Identity and Access
- Admin role assignment logic is email allowlist based:
  - Google auth path: `apps/web/src/server.ts:1307`
  - Email auth path: `apps/web/src/server.ts:1395`
- Effective admin allowlist on fresh web/server is set to:
  - `ADMIN_EMAILS=tagbajoh@gmail.com`
- Main web (Cloud Run) also has `ADMIN_EMAILS=tagbajoh@gmail.com`.
- Conclusion: admin identity parity is aligned for current configured admin email.

## Auth Parity
### Main
- `googleAuthEnabled: true`
- `emailAuthEnabled: true`
- `googleClientId` configured (`...-gj6b...apps.googleusercontent.com`)

### Fresh
- `googleAuthEnabled: false`
- `emailAuthEnabled: true`
- `googleClientId` empty
- `ALLOWED_AUTH_ORIGINS` explicitly configured to include all Netlify origins.

### Impact
- Fresh currently uses email auth only; Google sign-in parity is intentionally disabled for stability.

## Backend Origin Parity
### Main runtime-config
- `webApiOrigin: https://arena-web-api-mfpf3lbsba-uc.a.run.app`
- `serverOrigin: https://arena-server-mfpf3lbsba-uc.a.run.app`
- `runtimeOrigin: https://arena-runtime-mfpf3lbsba-uc.a.run.app`

### Fresh runtime-config
- `webApiOrigin: https://arena-web-api-fresh-02240816.fly.dev`
- `serverOrigin: https://arena-server-fresh-02240816.fly.dev`
- `runtimeOrigin: https://arena-runtime-fresh-02240816.fly.dev`

## Infrastructure Parity
### Main (Cloud Run)
- `arena-web-api`: min scale 1, max scale 20, `1 CPU / 1Gi`
- `arena-server`: min scale 1, max scale 20, `1 CPU / 1Gi`
- `arena-runtime`: min scale 1, max scale 1, `1 CPU / 1Gi`

### Fresh (Fly)
- web: 1 machine, `shared-cpu-1x:1024MB`
- server: 2 machines, each `shared-cpu-1x:512MB`
- runtime: 2 machines, each `shared-cpu-1x:512MB`

## Wallet/Server Smoke Results on Fresh
Executed `scripts/cutover-smoke.sh`:
- `/api/config` reachable and consistent
- Email signup succeeds (`/api/auth/email` HTTP 200)
- Session established after signup
- `/api/player/bootstrap` returns success
- `/api/player/wallet/summary` returns wallet payload
- Admin endpoint test from non-admin returns expected `403 forbidden`

## Key Deltas Blocking Clean GCP Exit
1. Main Netlify site still points to Cloud Run origins.
2. Google auth parity not yet restored on fresh (fresh is email-only currently).
3. Sizing/scale differs between main and fresh stacks.

## Update - World Asset Migration Completed (Fresh Stack)
- `arena-web-api-fresh-02240816` now bundles `train_station_mega_world.glb` in the image.
- `PUBLIC_WORLD_ASSET_BASE_URL` was unset on fresh web-api; `/api/config` now returns empty `worldAssetBaseUrl`.
- Netlify fresh routes `/assets/world/*` to Fly web-api and returns `200` with `model/gltf-binary`.
- Browser-delivered assets (`world-common.js`, `arena-config.js`, `sw-world-cache.js`, `viewer.html`) no longer contain GCS or Cloud Run fallback hosts.

### Result
- Fresh stack world hosting is now fully off GCP.

## Immediate Execution Plan
1. Decide auth mode at cutover:
   - Option A: email-only on fresh during cutover window.
   - Option B: re-enable Google after dedicated OAuth validation run.
2. Run cutover rehearsal against fresh with scripted checks:
   - `scripts/cutover-parity.sh`
   - `scripts/cutover-smoke.sh`
3. Switch production Netlify backend targets to Fly origins.
4. Run post-switch smoke suite (auth, wallet, challenge, admin endpoints).
5. Observe for 24-72h and then decommission Cloud Run services.

## Created Tools
- `scripts/cutover-parity.sh`
- `scripts/cutover-smoke.sh`
