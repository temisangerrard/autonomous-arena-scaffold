# World Assets

Production world assets are hosted on the dedicated Netlify site:

- Canonical host: `https://arena-world-assets.netlify.app`
- Current production asset: `https://arena-world-assets.netlify.app/assets/world/mega.glb`

## Why this exists

- Keeps the large world GLB out of the Fly `arena-web` image.
- Prevents normal frontend/backend deploys from breaking world loading.
- Gives the browser, viewer, and `arena-web` one canonical asset origin.

## Production config

- `PUBLIC_WORLD_ASSET_BASE_URL=https://arena-world-assets.netlify.app`
- `arena-web` should keep that value in Fly secrets.
- If the env var is missing, the code now defaults to the same canonical Netlify host.

## Publishing a new world asset

Prerequisites:

- local `train_station_mega_world.glb` present in the repo root
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

Optional source override:

```bash
WORLD_ASSET_SOURCE_PATH=./some-other-world.glb NETLIFY_WORLD_ASSETS_SITE_NAME=arena-world-assets npm run world:publish
```

## Notes

- The world GLB is intentionally gitignored, so GitHub Actions does not publish it automatically.
- The main Netlify frontend rewrites `/assets/world/*` directly to the canonical asset host.
- Fly `arena-web` also redirects missing local world requests to the same host.
