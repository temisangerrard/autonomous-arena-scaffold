# World Assets

Current production world assets are hosted on the dedicated Netlify site:

- Current canonical host: `https://arena-world-assets.netlify.app`
- Current production asset path: `https://arena-world-assets.netlify.app/assets/world/mega.glb`

Recommended target architecture for large world binaries:

- Fly.io continues to host app/runtime/game services.
- World bundles should move to object storage + CDN.
- Production should load `mega-shell.glb` first and defer `mega-world.glb`.

## Why this exists

- Keeps the large world GLB out of the Fly `arena-web` image.
- Prevents normal frontend/backend deploys from breaking world loading.
- Gives the browser, viewer, and `arena-web` one canonical asset origin.
- Makes it possible to switch the binary origin without changing the runtime contract.

## Production config

- `PUBLIC_WORLD_ASSET_BASE_URL=<world-bundle-origin>`
- Today that value is `https://arena-world-assets.netlify.app`.
- For the next rollout, prefer an object-storage/CDN origin and keep Fly focused on app services.

## Publishing world bundles

Prerequisites:

- local shell and mega GLBs present in the repo root:
  - `train_station_world.glb`
  - `train_station_mega_world.glb`
- Netlify CLI authenticated locally, or `NETLIFY_AUTH_TOKEN` set
- one of:
  - `NETLIFY_WORLD_ASSETS_SITE_ID`
  - `NETLIFY_WORLD_ASSETS_SITE_NAME=arena-world-assets`

Dry run:

```bash
npm run world:publish -- --dry-run
```

Production publish:

```bash
NETLIFY_WORLD_ASSETS_SITE_NAME=arena-world-assets npm run world:publish
```

## Notes

- The world GLB is intentionally gitignored, so GitHub Actions does not publish it automatically.
- The publish script now stages:
  - `mega.glb`
  - `mega-shell.glb`
  - `mega-world.glb`
- The main frontend resolves `/assets/world/*` through the configured asset origin.
- Fly `arena-web` can still redirect missing local world requests to the configured host.
