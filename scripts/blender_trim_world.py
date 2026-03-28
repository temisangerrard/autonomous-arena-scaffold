"""
Trim the world to match WORLD_BOUND=70.
Actions:
  1. Delete any mesh object whose centre lies entirely outside ±70 units (X or Z)
  2. Clip floor/ground plane geometry that extends beyond the bound using a Boolean
  3. Run the cleanup (duplicate mats, downscale textures, orphan purge) from before
  4. Export train_station_mega_world_clean.glb

Run with:
  /Applications/Blender.app/Contents/MacOS/blender --background --python scripts/blender_trim_world.py
"""

import bpy, os, re, math
from mathutils import Vector

BASE    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLB_IN  = os.path.join(BASE, "train_station_mega_world.glb")
GLB_OUT = os.path.join(BASE, "train_station_mega_world_clean.glb")

WORLD_BOUND = 70   # must match WorldSim.ts

print(f"\n=== IMPORTING {GLB_IN} ===")
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB_IN)
print("Import done.\n")

stats = {"removed_outside": 0, "mats_merged": 0, "textures_downscaled": 0}

# ─────────────────────────────────────────────────────────────────────────────
# 1. REMOVE OBJECTS COMPLETELY OUTSIDE THE BOUND
#    If the entire bounding box is outside ±WORLD_BOUND on X or Z, nuke it.
#    "Completely outside" = min > BOUND or max < -BOUND on either axis.
# ─────────────────────────────────────────────────────────────────────────────
print(f"--- Step 1: Removing objects fully outside ±{WORLD_BOUND} ---")

to_remove = []
for obj in bpy.data.objects:
    if obj.type != 'MESH':
        continue
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    min_x = min(c.x for c in corners)
    max_x = max(c.x for c in corners)
    min_z = min(c.z for c in corners)
    max_z = max(c.z for c in corners)
    outside = (min_x > WORLD_BOUND or max_x < -WORLD_BOUND or
               min_z > WORLD_BOUND or max_z < -WORLD_BOUND)
    if outside:
        to_remove.append(obj)

for obj in to_remove:
    print(f"  Removing (outside bounds): {obj.name}")
    bpy.data.objects.remove(obj, do_unlink=True)
    stats["removed_outside"] += 1

print(f"  Removed {stats['removed_outside']} out-of-bounds objects.")

# ─────────────────────────────────────────────────────────────────────────────
# 2. CLIP FLOOR/GROUND OBJECTS THAT STRADDLE THE BOUNDARY
#    Objects that partially extend outside get a Boolean Intersect with
#    a cube that exactly matches ±WORLD_BOUND, snapping them to the edge.
# ─────────────────────────────────────────────────────────────────────────────
print(f"\n--- Step 2: Clipping oversized floor/ground meshes to ±{WORLD_BOUND} ---")

# Identify "floor" candidates: flat meshes (thin in Y/Z) that span > 60% of world
LARGE_FLOOR_THRESHOLD = WORLD_BOUND * 1.2   # wider than 84 units on any axis

# Create the clipping cube
bpy.ops.mesh.primitive_cube_add(size=1)
clip_cube = bpy.context.active_object
clip_cube.name = "_ClipBound"
# Scale to exactly ±WORLD_BOUND on X/Z, tall enough on Y to cover everything
clip_cube.scale = (WORLD_BOUND, 40, WORLD_BOUND)  # 40 covers -6 to +25 world height
bpy.ops.object.transform_apply(scale=True)

clipped = 0
for obj in list(bpy.data.objects):
    if obj.type != 'MESH' or obj.name.startswith('_'):
        continue
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    min_x = min(c.x for c in corners); max_x = max(c.x for c in corners)
    min_z = min(c.z for c in corners); max_z = max(c.z for c in corners)
    span_x = max_x - min_x
    span_z = max_z - min_z

    # Only clip objects that actually stick out AND are wide (floor-like)
    sticks_out = (max_x > WORLD_BOUND or min_x < -WORLD_BOUND or
                  max_z > WORLD_BOUND or min_z < -WORLD_BOUND)
    is_large = span_x > LARGE_FLOOR_THRESHOLD or span_z > LARGE_FLOOR_THRESHOLD

    if not (sticks_out and is_large):
        continue

    print(f"  Clipping: {obj.name}  span=({span_x:.1f}, {span_z:.1f})")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    mod = obj.modifiers.new(name="ClipBound", type='BOOLEAN')
    mod.operation = 'INTERSECT'
    mod.object = clip_cube
    mod.solver = 'FAST'
    try:
        bpy.ops.object.modifier_apply(modifier="ClipBound")
        clipped += 1
    except Exception as e:
        obj.modifiers.remove(mod)
        print(f"    Boolean failed on {obj.name}: {e} — skipping.")
    obj.select_set(False)

# Remove the clipping helper
bpy.data.objects.remove(clip_cube, do_unlink=True)
print(f"  Clipped {clipped} floor/ground objects.")

# ─────────────────────────────────────────────────────────────────────────────
# 3. MERGE DUPLICATE MATERIALS
# ─────────────────────────────────────────────────────────────────────────────
print("\n--- Step 3: Merging duplicate materials ---")
from collections import defaultdict

def base_name(name):
    return re.sub(r'\.\d+$', '', name)

groups = defaultdict(list)
for mat in bpy.data.materials:
    groups[base_name(mat.name)].append(mat)

for canonical_name, variants in groups.items():
    if len(variants) <= 1:
        continue
    canonical = next((m for m in variants if m.name == canonical_name), variants[0])
    for dupe in [m for m in variants if m is not canonical]:
        for obj in bpy.data.objects:
            if obj.type != 'MESH':
                continue
            for slot in obj.material_slots:
                if slot.material == dupe:
                    slot.material = canonical
        dupe.user_remap(canonical)
        bpy.data.materials.remove(dupe)
        stats["mats_merged"] += 1

print(f"  Merged {stats['mats_merged']} duplicate material variants.")
print(f"  Materials remaining: {len(bpy.data.materials)}")

# ─────────────────────────────────────────────────────────────────────────────
# 4. DOWNSCALE 4K TEXTURES → 2048
# ─────────────────────────────────────────────────────────────────────────────
print("\n--- Step 4: Downscaling 4K textures ---")
for img in bpy.data.images:
    w, h = img.size
    if w > 2048 or h > 2048:
        img.scale(min(w, 2048), min(h, 2048))
        stats["textures_downscaled"] += 1
        print(f"  {img.name}: {w}×{h} → 2048×2048")
print(f"  Downscaled {stats['textures_downscaled']} textures.")

# ─────────────────────────────────────────────────────────────────────────────
# 5. DECIMATE HEAVY NPC MESHES
# ─────────────────────────────────────────────────────────────────────────────
print("\n--- Step 5: Decimating heavy NPC meshes ---")
DECIMATE_TARGETS = [
    ("Juniper_Lee",   6000),
    ("Robot_Vendor",  6000),
    ("Maria_J_J_Ong", 6000),
    ("Object_3.008",  3000),
]
decimated = 0
for target_name, target_tris in DECIMATE_TARGETS:
    obj = bpy.data.objects.get(target_name)
    if obj is None or obj.type != 'MESH':
        continue
    current = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if current <= target_tris:
        continue
    ratio = target_tris / current
    mod = obj.modifiers.new(name="Decimate", type='DECIMATE')
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier="Decimate")
    after = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    print(f"  {target_name}: {current:,} → {after:,} tris")
    decimated += 1
print(f"  Decimated {decimated} meshes.")

# ─────────────────────────────────────────────────────────────────────────────
# 6. PURGE ORPHAN DATA
# ─────────────────────────────────────────────────────────────────────────────
print("\n--- Step 6: Purging orphan data ---")
bpy.ops.outliner.orphans_purge(do_recursive=True)

# ─────────────────────────────────────────────────────────────────────────────
# 7. EXPORT
# ─────────────────────────────────────────────────────────────────────────────
print(f"\n--- Step 7: Exporting to {GLB_OUT} ---")
bpy.ops.export_scene.gltf(
    filepath=GLB_OUT,
    export_format='GLB',
    export_texcoords=True,
    export_normals=True,
    export_materials='EXPORT',
    export_apply=True,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6,
    export_image_format='JPEG',
    export_jpeg_quality=85,
)

in_mb  = os.path.getsize(GLB_IN)  / 1024 / 1024
out_mb = os.path.getsize(GLB_OUT) / 1024 / 1024

print("\n" + "=" * 60)
print("DONE")
print("=" * 60)
print(f"  Out-of-bounds objects removed : {stats['removed_outside']}")
print(f"  Materials merged              : {stats['mats_merged']}")
print(f"  Textures downscaled           : {stats['textures_downscaled']}")
print(f"  NPC meshes decimated          : {decimated}")
print(f"  Input  : {in_mb:.1f} MB")
print(f"  Output : {out_mb:.1f} MB  ({(1-out_mb/in_mb)*100:.0f}% smaller)")
print(f"\n  → {GLB_OUT}")
print("=" * 60)
