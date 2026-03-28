# World Rollout Checklist

Goal: serve the cleaned production world from the dedicated binary origin with a single-bundle load path that preserves the existing manifest contract.

## Desired production state

- `PUBLIC_WORLD_ASSET_BASE_URL` points to object storage + CDN, not the current Netlify world host.
- `/api/worlds` serves:
  - `mega-shell` -> `train_station_mega_world_clean.glb`
- `/play` enters after the cleaned world bundle loads once.
- Initial load messaging says `Preparing world…`, not `Connecting to world server…`.

## Pre-rollout checks

- Confirm the cleaned source file exists:
  - `train_station_mega_world_clean.glb`
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
- `/assets/world/mega-world.glb` as a compatibility alias

If moving away from Netlify host, upload those staged files to the object-storage/CDN origin and preserve the same `/assets/world/*.glb` paths.

## App rollout

Deploy the web runtime that includes:

- single-bundle manifest support through the existing shell slot
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
- `mega-shell` resolves to `train_station_mega_world_clean.glb`
- `mega-world` remains reachable as a compatibility alias to the same cleaned asset
- `/play` requests `mega-shell.glb`
- the player enters without any follow-up world swap
- dealer and cashier stations still initialize on first load

Manual browser verification:

- initial loader copy should read `Preparing world…`
- after the world load, gameplay UI should be present without the appearance of outage
- no `Streaming nearby world details…` phase should appear for the base world

## Rollback

If single-bundle rollout fails:

- point `PUBLIC_WORLD_ASSET_BASE_URL` back to the previous binary origin
- restore the previous `/api/worlds` bundle mapping
- keep the loader copy change; it is safer and more accurate even on rollback
