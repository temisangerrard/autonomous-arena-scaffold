# World Asset Host Design

## Decision
Use `https://arena-world-assets.netlify.app` as the canonical host for production world GLB assets.

## Why
- Keeps large binary world assets off the Fly web image.
- Decouples world hosting from frontend/backend app deploys.
- Uses a stable Netlify-owned URL with no custom DNS work.
- Lets `arena-web` recover even if the local GLB is absent from the runtime image.

## Architecture
- `arena-web` treats `https://arena-world-assets.netlify.app` as the canonical fallback base for `/assets/world/*.glb`.
- `/api/config` exposes the effective `worldAssetBaseUrl` so browser clients and viewers resolve the same canonical asset origin.
- A dedicated local publish script assembles `/assets/world/mega.glb` and deploys it to the Netlify site `arena-world-assets`.
- GitHub Actions does not publish the GLB automatically because the world asset is intentionally gitignored and not present in CI. The publish script is the supported operational path for world asset updates.

## Operational Rules
- Production `arena-web` should keep `PUBLIC_WORLD_ASSET_BASE_URL=https://arena-world-assets.netlify.app`.
- If that env var is missing, code should still default to the canonical Netlify host rather than hard-failing world loads.
- The asset publish script must require an explicit Netlify site target to avoid accidentally deploying to the main frontend site.

## Testing
- Unit test the canonical fallback constant in the web server path.
- Unit test the publish script to ensure it creates `/assets/world/mega.glb` in a staging dir and validates required inputs.
