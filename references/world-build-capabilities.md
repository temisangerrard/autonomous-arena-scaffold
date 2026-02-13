# Blender World-Build Capability Map (Broad Coverage)

Purpose: give a broad natural-language-to-API map beyond Junipali’s immediate pipeline.

Primary doc root:
- `/Users/temisan/Downloads/FBX files/blender_python_reference_5_0`

## NL Intent Router

Use this to translate user requests fast:

- "build streets / props / architecture" -> Mesh + Object + Modifiers + Collections
- "procedural city / repeatable generation" -> Geometry Nodes + node ops + attributes
- "terrain / cliffs / road cut" -> Sculpt + Displace + modifiers + curves
- "crowds / scattered props / foliage" -> Particle + geometry nodes instancing + point cloud
- "physics interactions" -> Rigid body / cloth / fluid / cache
- "lighting mood / night neon / day sun" -> World + lights + cycles/eevee settings
- "cinematic camera passes" -> Camera + constraints + keyframes + markers
- "rig and animate character" -> Armature + Pose + Action/NLA
- "export game assets" -> import_scene/export_scene + transform cleanup

## Capability Matrix

## 1) Scene and World Setup
- APIs:
  - `bpy.ops.scene.*` (`bpy.ops.scene.html`)
  - `bpy.ops.world.*` (`bpy.ops.world.html`)
  - `bpy.types.Scene` (`bpy.types.Scene.html`)
  - `bpy.types.World` (`bpy.types.World.html`)
- Use for:
  - scene creation, world background/fog setup, render context defaults.

## 2) Object Graph and Layout
- APIs:
  - `bpy.ops.object.*` (`bpy.ops.object.html`)
  - `bpy.ops.collection.*` (`bpy.ops.collection.html`)
  - `bpy.types.Object`, `bpy.types.Collection`
- Use for:
  - parenting, transforms, duplicate/link, organization by zone.

## 3) Modeling (Hard Surface + Organic)
- APIs:
  - `bpy.ops.mesh.*` (`bpy.ops.mesh.html`)
  - `bpy.ops.curve.*` / `bpy.ops.curves.*`
  - `bmesh`, `bmesh.ops`
  - `bpy.types.Modifier` + concrete modifiers (`ArrayModifier`, `BevelModifier`, `BooleanModifier`, etc.)
- Use for:
  - buildings, stalls, street furniture, hero props, quick blockouts.

## 4) Procedural Generation (Geometry Nodes)
- APIs:
  - `bpy.ops.node.*` (`bpy.ops.node.html`)
  - `bpy.ops.geometry.*` (`bpy.ops.geometry.html`)
  - attribute types: `bpy.types.Attribute*`
- Use for:
  - procedural streets, randomized prop scattering, reusable stage generators.

## 5) Materials, Texturing, UV
- APIs:
  - `bpy.ops.material.*`
  - `bpy.ops.uv.*`
  - `bpy.types.Material`, `bpy.types.Image`, node trees
- Use for:
  - stylized stage look, atlas-driven materials, clean UV for export.

## 6) Rigging and Animation
- APIs:
  - `bpy.ops.armature.*`, `bpy.ops.pose.*`, `bpy.ops.anim.*`, `bpy.ops.nla.*`
  - `bpy.types.Armature`, `bpy.types.Bone`, `bpy.types.PoseBone`
  - `bpy.types.Action`, `ActionLayer`, `ActionSlot`, `ActionChannelbag*`
- Use for:
  - character rig setup, attack clip authoring, animation cleanup.
- Blender 5 note:
  - Action data can be layered; do not assume legacy-only `action.fcurves`.

## 7) Simulation and VFX
- APIs:
  - `bpy.ops.rigidbody.*`
  - `bpy.ops.fluid.*`
  - `bpy.ops.cloth.*`
  - `bpy.ops.particle.*`
  - `bpy.ops.ptcache.*`
- Use for:
  - destruction prototypes, cloth props, smoke/fire passes, cached sims.

## 8) Camera and Cinematic Staging
- APIs:
  - `bpy.ops.camera.*`
  - `bpy.ops.constraint.*`
  - `bpy.ops.marker.*`
  - `bpy.types.Camera`
- Use for:
  - gameplay camera tests, flythrough previews, stage reveal shots.

## 9) Render and Baking
- APIs:
  - `bpy.ops.render.*`
  - `bpy.ops.cycles.*`
  - bake settings types (`bpy.types.BakeSettings`)
- Use for:
  - lookdev previews, texture baking workflows.

## 10) Import/Export and Automation
- APIs:
  - `bpy.ops.import_scene.fbx`
  - `bpy.ops.export_scene.gltf`
  - `bpy.app.handlers`, `bpy.app.timers`
- Use for:
  - deterministic FBX->GLB conversion pipelines and batch jobs.

## 11) Data/Context/Events
- APIs:
  - `bpy.data`, `bpy.context`, `bpy.msgbus`, handlers
- Use for:
  - robust scripts that inspect scene state and react to updates.

## Practical Rule Set For This Skill

1. Pick the smallest capability set that solves the ask.
2. Use operators for fast tasks; direct data API for precise deterministic edits.
3. For game assets, prefer repeatable scripts over manual click paths.
4. Validate in three passes:
   - Blender scene correctness
   - GLB export validity
   - runtime behavior in game (scale, rig, clips, collisions).

