# World Asset Quality Checklist (Mega)

- Export target: `train_station_mega_world.glb` only.
- Budget gate: keep under `WORLD_ASSET_MAX_MB` (CI default `240MB`).
- Geometry:
  - Simplify distant meshes and hidden backfaces.
  - Remove duplicate/unused meshes and materials.
- Textures:
  - Downscale non-critical textures.
  - Prefer compressed texture pipeline for mobile GPU memory.
- Compression:
  - Enable mesh compression and animation compression at export.
- Validation:
  - Load `/play` on mobile profile and confirm staged loader text:
    - `Connecting`
    - `Downloading`
    - `Processing`
    - `Entering world`
