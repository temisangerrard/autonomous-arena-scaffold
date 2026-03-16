# World Rollout Checklist

Goal: move production from monolithic first-load world delivery to shell-first loading with a dedicated binary origin better suited for very large immutable assets.

## Desired production state

- `PUBLIC_WORLD_ASSET_BASE_URL` points to object storage + CDN, not the current Netlify world host.
- `/api/worlds` serves:
  - `mega-shell` -> `train_station_world.glb`
  - `mega-world` -> `train_station_mega_world.glb`
- `/play` enters after shell load, then swaps to the full mega world when ready.
- Initial load messaging says `Preparing world…`, not `Connecting to world server…`.

## Pre-rollout checks

- Confirm both local source files exist:
  - `train_station_world.glb`
  - `train_station_mega_world.glb`
- Confirm the target object-storage/CDN bucket/origin is provisioned.
- Confirm `PUBLIC_WORLD_ASSET_BASE_URL` can be updated on the deployed web service.

## Bundle publish

If using the existing staging script as the source of truth:

```bash
npm run world:publish -- --dry-run
```

Verify the staged output contains:

- `/assets/world/mega.glb`
- `/assets/world/mega-shell.glb`
- `/assets/world/mega-world.glb`

If moving away from Netlify host, upload those staged files to the object-storage/CDN origin and preserve the same `/assets/world/*.glb` paths.

## App rollout

Deploy the web runtime that includes:

- shell-first bundle manifest support
- shell-to-mega replacement loading
- multi-bundle cache support
- neutral initial loader copy

Then set:

```bash
PUBLIC_WORLD_ASSET_BASE_URL=<object-storage-cdn-origin>
```

on the deployed web service.

## Post-rollout verification

Check:

- `/api/worlds` returns `bundlesByAlias`
- `mega-shell` resolves to the 53 MB file
- `mega-world` resolves to the large mega file
- `/play` requests `mega-shell.glb` first
- the player enters before `mega-world.glb` finishes
- later the world swaps cleanly to the mega world

Manual browser verification:

- initial loader copy should read `Preparing world…`
- after shell load, gameplay UI should be present without the appearance of outage
- mega world replacement should not leave overlapping duplicate shell geometry

## Rollback

If shell-first rollout fails:

- point `PUBLIC_WORLD_ASSET_BASE_URL` back to the previous binary origin
- temporarily map `mega-shell` back to the legacy monolithic asset
- keep the loader copy change; it is safer and more accurate even on rollback
