# Blender 5 API Index For Junipali

This index is built from local docs:

- `/Users/temisan/Downloads/FBX files/blender_python_reference_5_0`
- `/Users/temisan/Downloads/FBX files/blender_python_reference_5_0 2`

Use this file as the first lookup when converting natural-language requests into Blender Python tasks.

## Fast Lookup (Task -> API)

### 1) Import FBX / Mixamo animations
- `bpy.ops.import_scene.fbx`
- Docs:
  - `bpy.ops.import_scene.html#bpy.ops.import_scene.fbx`
- Key args:
  - `filepath`, `use_anim`, `ignore_leaf_bones`, `automatic_bone_orientation`, `axis_forward`, `axis_up`

### 2) Export game-ready GLB
- `bpy.ops.export_scene.gltf`
- Docs:
  - `bpy.ops.export_scene.html#bpy.ops.export_scene.gltf`
- Key args:
  - `export_format='GLB'`, `use_selection=True`, `export_animations=True`, `export_animation_mode='ACTIONS'`
  - `export_draco_mesh_compression_enable=True` for stage optimization

### 3) Read / validate actions (Blender 5 layered actions)
- `bpy.types.Action`
- `bpy.types.ActionSlot`
- `bpy.types.ActionLayer`
- `bpy.types.ActionChannelbag`
- `bpy.types.ActionChannelbagFCurves`
- Docs:
  - `bpy.types.Action.html`
  - `bpy.types.ActionSlot.html`
  - `bpy.types.ActionLayer.html`
  - `bpy.types.ActionChannelbag.html`
  - `bpy.types.ActionChannelbagFCurves.html`
- Critical compatibility note:
  - Do not assume `action.fcurves` / `action.groups` are always present in Blender 5.
  - Use layers/channelbags when needed.

### 4) Rig, armature, pose operations
- `bpy.types.Armature`, `bpy.types.Bone`, `bpy.types.PoseBone`
- `bpy.ops.armature.*`, `bpy.ops.pose.*`
- Docs:
  - `bpy.ops.armature.html`
  - `bpy.ops.pose.html`
  - `bpy.types.Armature.html`
  - `bpy.types.PoseBone.html`

### 5) Mesh editing and cleanup
- `bpy.ops.mesh.*`
- `bmesh` / `bmesh.ops`
- `bpy.types.Mesh`
- Docs:
  - `bpy.ops.mesh.html`
  - `bmesh.html`
  - `bmesh.ops.html`
  - `bpy.types.Mesh.html`

### 6) Object transforms, parenting, modifiers
- `bpy.ops.object.*`
- `bpy.types.Object`
- `bpy.types.Modifier`
- Docs:
  - `bpy.ops.object.html`
  - `bpy.types.Object.html`
  - `bpy.types.Modifier.html`

### 7) Materials / textures for runtime
- `bpy.types.Material`
- `bpy.types.Image`
- `bpy.ops.uv.*`
- Docs:
  - `bpy.types.Material.html`
  - `bpy.types.Image.html`
  - `bpy.ops.uv.html`

### 8) Scene / collection organization for stages
- `bpy.types.Scene`
- `bpy.types.Collection`
- `bpy.ops.collection.*`
- Docs:
  - `bpy.types.Scene.html`
  - `bpy.types.Collection.html`
  - `bpy.ops.collection.html`

### 9) Handlers/timers for scripted pipelines
- `bpy.app.handlers`
- `bpy.app.timers`
- Docs:
  - `bpy.app.handlers.html`
  - `bpy.app.timers.html`

### 10) Context and data access
- `bpy.context`
- `bpy.data`
- Docs:
  - `bpy.context.html`
  - `bpy.data.html`

## Natural Language -> Blender Task Map

Use these mappings before writing code.

### "Import this Mixamo FBX and keep animations"
1. `bpy.ops.import_scene.fbx(... use_anim=True ...)`
2. Find armature + mesh objects.
3. Validate actions using Blender-5-safe action traversal.

### "Rename clips to idle/walk/attack/hurt/death"
1. Iterate `bpy.data.actions`.
2. Rename `action.name`.
3. Validate each required clip exists.

### "Fix rig so mesh follows armature"
1. Inspect mesh vertex groups (`obj.vertex_groups`).
2. Check armature modifier target (`obj.modifiers`).
3. Rebind/repair parenting and modifier if missing.

### "Build a stage from primitives and export GLB"
1. Create meshes (`bpy.ops.mesh.*` or bmesh).
2. Organize in named collections.
3. Apply transforms and set origins.
4. Export selected via `bpy.ops.export_scene.gltf`.

### "Optimize this stage GLB"
1. Merge repeated props where safe.
2. Remove hidden/unused meshes.
3. Use GLTF export Draco compression.
4. Validate visual parity and file size.

### "Batch convert FBX files to GLB"
1. Run headless blender script.
2. Loop files, import FBX, normalize names, export GLB.
3. Emit conversion report (success/failure, clip list, size).

## Blender 5 Action-Safe Pattern (Required)

```python
def iter_action_fcurves(action):
    if hasattr(action, "fcurves") and action.fcurves:
        for fc in action.fcurves:
            yield fc
        return

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

## Grep Patterns For Rapid Doc Retrieval

Run inside `blender_python_reference_5_0`:

- `rg -n "id=\"bpy.ops.import_scene.fbx\"" bpy.ops.import_scene.html`
- `rg -n "id=\"bpy.ops.export_scene.gltf\"" bpy.ops.export_scene.html`
- `rg -n "is_action_legacy|id=\"bpy.types.Action.layers\"|id=\"bpy.types.Action.slots\"" bpy.types.Action.html`
- `rg -n "id=\"bpy.types.ActionChannelbag.fcurves\"" bpy.types.ActionChannelbag.html`
- `rg -n "load_post|depsgraph_update_post" bpy.app.handlers.html`

