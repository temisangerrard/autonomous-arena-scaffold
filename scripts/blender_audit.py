"""
Blender world audit script.
Run with:
  /Applications/Blender.app/Contents/MacOS/blender --background --python scripts/blender_audit.py
"""

import bpy
import sys
import os
import json
from collections import defaultdict

GLB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "train_station_mega_world.glb")
OUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "blender_audit_report.json")

print(f"\n=== IMPORTING {GLB_PATH} ===")
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB_PATH)
print("Import done.\n")

# ── Mesh audit ────────────────────────────────────────────────────────────────
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
total_tris = 0
mesh_data = []

for obj in meshes:
    me = obj.data
    # count triangulated faces
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    total_tris += tris
    verts = len(me.vertices)
    mat_names = [m.name if m else "<none>" for m in me.materials]
    mesh_data.append({
        "name": obj.name,
        "verts": verts,
        "tris": tris,
        "materials": mat_names,
        "visible": not obj.hide_render,
        "users": me.users,
    })

mesh_data.sort(key=lambda x: x["tris"], reverse=True)

# ── Material audit ────────────────────────────────────────────────────────────
mat_data = []
for mat in bpy.data.materials:
    textures = []
    if mat.node_tree:
        for node in mat.node_tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image:
                img = node.image
                textures.append({
                    "image": img.name,
                    "size": list(img.size),
                    "packed": img.packed_file is not None,
                })
    mat_data.append({
        "name": mat.name,
        "users": mat.users,
        "textures": textures,
    })

# ── Texture/image audit ───────────────────────────────────────────────────────
image_data = []
for img in bpy.data.images:
    image_data.append({
        "name": img.name,
        "size": list(img.size),
        "users": img.users,
        "packed": img.packed_file is not None,
        "filepath": img.filepath,
    })

# ── Orphan data ───────────────────────────────────────────────────────────────
orphan_meshes   = [m.name for m in bpy.data.meshes    if m.users == 0]
orphan_mats     = [m.name for m in bpy.data.materials if m.users == 0]
orphan_images   = [i.name for i in bpy.data.images    if i.users == 0]
orphan_objects  = [o.name for o in bpy.data.objects   if o.users == 0]

# ── Duplicate materials (same name prefix, likely duplicates) ─────────────────
from collections import Counter
mat_base_names = [m.name.rstrip("0123456789").rstrip(".") for m in bpy.data.materials]
dup_candidates = {k: v for k, v in Counter(mat_base_names).items() if v > 1}

# ── Objects with no geometry (empties, etc.) ─────────────────────────────────
empty_objects = [o.name for o in bpy.data.objects if o.type not in ('MESH', 'ARMATURE', 'LIGHT', 'CAMERA')]

# ── Hidden/disabled objects ───────────────────────────────────────────────────
hidden_objects = [o.name for o in bpy.data.objects if o.type == 'MESH' and o.hide_render]

# ── Large texture warning (>2048px) ──────────────────────────────────────────
large_textures = [i for i in image_data if i["size"][0] > 2048 or i["size"][1] > 2048]

# ── Shared vs unique meshes ───────────────────────────────────────────────────
shared_meshes = [m for m in mesh_data if m["users"] > 1]

# ── Report ────────────────────────────────────────────────────────────────────
report = {
    "summary": {
        "total_objects": len(bpy.data.objects),
        "total_mesh_objects": len(meshes),
        "total_triangles": total_tris,
        "total_materials": len(bpy.data.materials),
        "total_images": len(bpy.data.images),
        "empty_objects": len(empty_objects),
        "hidden_render_objects": len(hidden_objects),
    },
    "top_20_heavy_meshes": mesh_data[:20],
    "orphan_data": {
        "meshes": orphan_meshes,
        "materials": orphan_mats,
        "images": orphan_images,
        "objects": orphan_objects,
    },
    "duplicate_material_candidates": dup_candidates,
    "large_textures_over_2048": large_textures,
    "shared_mesh_data_blocks": [m["name"] for m in shared_meshes],
    "empty_non_mesh_objects": empty_objects,
    "hidden_render_objects": hidden_objects,
    "all_materials": mat_data,
    "all_images": image_data,
}

with open(OUT_PATH, "w") as f:
    json.dump(report, f, indent=2)

# ── Console summary ───────────────────────────────────────────────────────────
print("=" * 60)
print("AUDIT SUMMARY")
print("=" * 60)
s = report["summary"]
print(f"  Objects total     : {s['total_objects']}")
print(f"  Mesh objects      : {s['total_mesh_objects']}")
print(f"  Total triangles   : {s['total_triangles']:,}")
print(f"  Materials         : {s['total_materials']}")
print(f"  Images/Textures   : {s['total_images']}")
print(f"  Empty objects     : {s['empty_objects']}")
print(f"  Hidden (render)   : {s['hidden_render_objects']}")
print()
print(f"  Orphan meshes     : {len(orphan_meshes)}")
print(f"  Orphan materials  : {len(orphan_mats)}")
print(f"  Orphan images     : {len(orphan_images)}")
print(f"  Dup mat candidates: {len(dup_candidates)}")
print(f"  Large textures    : {len(large_textures)}")
print()
print("Top 5 heaviest meshes:")
for m in mesh_data[:5]:
    print(f"  {m['name']:<40} {m['tris']:>8,} tris  {m['verts']:>7,} verts")
print()
print(f"Full report written to: {OUT_PATH}")
print("=" * 60)
