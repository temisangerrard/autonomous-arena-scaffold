---
name: blender-world-build
description: Use when building or refining Junipali 3D stages/characters in Blender and exporting production-ready GLB assets for the game runtime. Covers scene scale, rig/animation export, naming conventions, and handoff checklist.
---

# Blender World Build

Use this skill when the task involves Blender scene work, world building, stage set dressing, character rig updates, Mixamo/FBX import, or GLB export troubleshooting.

## Source Of Truth In This Project

When working on Junipali, follow the local Python workflows first:

- `/Users/temisan/Downloads/junipali-game/blender_tools/stage_builder.py`
- `/Users/temisan/Downloads/junipali-game/blender_tools/export_tools.py`
- `/Users/temisan/Downloads/junipali-game/blender_tools/animation_tools.py`
- `/Users/temisan/Downloads/junipali-game/blender_tools/character_rigger.py`
- `/Users/temisan/Downloads/junipali-game/BLENDER_WORKFLOWS.md`
- `/Users/temisan/Downloads/FBX files/blender_python_reference_5_0` (Blender 5.0 API reference)
- `/Users/temisan/.codex/skills/blender-world-build/references/blender-5-api-index.md` (task-to-API map)
- `/Users/temisan/.codex/skills/blender-world-build/references/world-build-capabilities.md` (broad capability map)
- `/Users/temisan/.codex/skills/blender-world-build/references/blender-5-api-manifest.json` (machine-generated API manifest, 1862 pages indexed)
- `/Users/temisan/.codex/skills/blender-world-build/scripts/generate_blender_api_manifest.py` (rebuild manifest)
- `/Users/temisan/.codex/skills/blender-world-build/scripts/query_blender_api_manifest.py` (search manifest)

If these local files conflict with generic Blender habits, prefer the local files.

## How To Use This Skill For Natural-Language Blender Work

1. Map user request to task in:
   - `/Users/temisan/.codex/skills/blender-world-build/references/blender-5-api-index.md`
   - `/Users/temisan/.codex/skills/blender-world-build/references/world-build-capabilities.md`
2. Query the machine manifest for candidate operators/types.
3. Pull the exact operator/type docs from local Blender reference.
4. Implement script/operator calls with Blender 5 action compatibility.
5. Validate output in runtime (GLB loads, rig moves mesh, clips play).

For broad world-building asks, use capability routing first, then specific API pages.

Manifest refresh command:

`python3 /Users/temisan/.codex/skills/blender-world-build/scripts/generate_blender_api_manifest.py --doc-root '/Users/temisan/Downloads/FBX files/blender_python_reference_5_0' --out /Users/temisan/.codex/skills/blender-world-build/references/blender-5-api-manifest.json`

Manifest query command:

`python3 /Users/temisan/.codex/skills/blender-world-build/scripts/query_blender_api_manifest.py --manifest /Users/temisan/.codex/skills/blender-world-build/references/blender-5-api-manifest.json --q "import_scene.fbx" --limit 20`

## Blender 5.0 API Compatibility (From Local Reference)

The local reference confirms Blender 5.x moved Action internals to layered data:

- `Action.is_action_legacy` may be `False` even for valid imported actions.
- F-curves/groups can live on channelbags, not on `action.fcurves` / `action.groups`.
- Important types: `Action.slots`, `Action.layers`, `ActionChannelbag.fcurves`, `ActionChannelbag.groups`.

Use this safe iteration pattern in scripts:

```python
def iter_action_fcurves(action):
    # Legacy actions
    if hasattr(action, "fcurves") and action.fcurves:
        for fc in action.fcurves:
            yield fc
        return

    # Layered actions (Blender 5+)
    layers = getattr(action, "layers", None)
    if not layers:
        return
    for layer in layers:
        strips = getattr(layer, "strips", [])
        for strip in strips:
            channelbags = getattr(strip, "channelbags", [])
            for channelbag in channelbags:
                for fc in getattr(channelbag, "fcurves", []):
                    yield fc
```

Use this safe action inspection pattern:

```python
def describe_action(action):
    frame_range = tuple(action.frame_range) if hasattr(action, "frame_range") else None
    fcurve_count = sum(1 for _ in iter_action_fcurves(action))
    return {
        "name": action.name,
        "legacy": bool(getattr(action, "is_action_legacy", False)),
        "frame_range": frame_range,
        "fcurves": fcurve_count,
    }
```

Avoid direct assumptions like:
- `action.fcurves` always exists
- `action.groups` always exists

Those assumptions break on layered actions and caused previous Junipali diagnostics to fail.

## Target Project Conventions

- Character GLBs path: `assets/characters/*.glb`
- Stage GLBs path: `assets/stages/3d/*.glb`
- Runtime: Three.js with `GLTFLoader`
- Character facing: +Z forward in scene, feet aligned to ground plane at export
- World scale baseline: character height around `1.7` world units in runtime after normalization

## FBX / Mixamo Intake Rules

Use this sequence:

1. Import FBX with animation enabled.
2. Rename Mixamo bones to project names.
3. Rename actions to game names (`idle`, `walk`, `attack`, `hurt`, `death`, optional `run`, `kick`, `jump`, `special`, `block`).
4. Validate action coverage.
5. Export GLB.

If user asks "can Blender do X?", check task map first and only then expand to full docs.

Project-local import pattern (from `animation_tools.py`):

- `bpy.ops.import_scene.fbx(... use_anim=True, ignore_leaf_bones=True, automatic_bone_orientation=True)`

Reference-confirmed operator: `bpy.ops.import_scene.fbx` supports:
- `use_anim`
- `ignore_leaf_bones`
- `automatic_bone_orientation`
- `axis_forward`, `axis_up`

Project-local bone map support exists in `character_rigger.py` (`mixamorig:*` -> game names).

## Required Animation Contract

Minimum required per fighter:

- `idle`
- `walk`
- `attack`
- `hurt`
- `death`

Optional but recommended:

- `run`
- `kick`
- `jump`
- `special`
- `block`

If clips arrive with different names, normalize them using project mappings before export.

## Export Rules (GLB)

Use Blender GLTF export with:
- Format: `glTF Binary (.glb)`
- Include: `Selected Objects` when exporting per-asset
- Transform: `+Y Up` (Blender default conversion), apply transforms before export
- Geometry: `Apply Modifiers` enabled
- Animation: enabled, include actions/NLA as needed
- Materials: keep Principled workflow compatible with GLTF
- Avoid external texture references when possible; embed via GLB

Reference-confirmed operator: `bpy.ops.export_scene.gltf` supports:
- `export_format='GLB'`
- `use_selection=True`
- `export_animations=True`
- `export_animation_mode='ACTIONS'`
- `export_draco_mesh_compression_enable=True` (optional for stage size reduction)

Project-local pre-export sequence (from `export_tools.py`):

1. `apply_all_transforms()`
2. `fix_normals()`
3. `pack_textures()`
4. `pre_export_check()`
5. export

## Character Asset Checklist

Before handoff:
1. Origin at feet center.
2. Mesh and armature names are stable and clean.
3. Idle clip exists and is clearly named (`Idle` or `idle`).
4. Attack and movement clips use consistent names (`Walk`, `Jogging`, `Boxing`, `Roundhouse Kick`, `Drop Kick`, etc).
5. No huge hidden helper objects inflating bounds.
6. Re-export and validate by loading in browser `characters.html?view=3d`.
7. If source is Mixamo, confirm renamed bones and action names before export.

## Stage Asset Checklist

Before handoff:
1. Stage mesh centered around intended play area.
2. Collision-relevant floor surfaces are visually obvious.
3. Heavy props are grouped and named by zone (`beach_*`, `chinatown_*`, etc).
4. Lighting baked into textures only if required; runtime handles primary lights.
5. Exported to `assets/stages/3d/<stage>.glb`.

For quick arena blocking, use stage-builder conventions:

- 8x8 to 28x28 unit play footprints depending on stage intent.
- Explicit wall/boundary proxies or named blockers.
- Spawn empties named `Spawn_*` when possible.

## Handoff Format for Agents

When delivering assets to code agents, include:
- File path(s)
- Intended role (player, enemy, boss, stage)
- Clip names detected in export
- Known limitations (no clip, high poly count, missing textures)

## Troubleshooting

If a model appears tiny, off-screen, or fails in lab:
- Check mesh-only bounds in Blender (hidden helpers can break fit)
- Apply transforms (`Ctrl+A`) before export
- Ensure armature and mesh are both exported
- Confirm file opens directly in browser URL under local server

If animations do not play:
- Ensure actions are pushed to NLA or marked for export
- Ensure keyframes exist on exported bones
- Verify clip names and duration are non-zero

If movement works in test scene but not in game runtime:
- Check for root-motion translation tracks in clips (`*.position` on root tracks).
- If needed, strip translation tracks in runtime or re-export clips without baked root translation.

## Practical Command Pattern

For batch or repeatable work, prefer Blender headless scripts:

`/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python <script.py>`

Use this for:
- FBX to GLB conversion batches
- action renaming passes
- stage export normalization

## Collaboration Note

This skill is for asset pipeline consistency; gameplay logic remains in:
- `src/core/Game.js`
- `src/fallback/arcadeFallback.js`
- `src/fighters/Fighter.js`
