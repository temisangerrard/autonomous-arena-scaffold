"""
Spatial layout audit — finds where content is dense vs empty.
Run with:
  /Applications/Blender.app/Contents/MacOS/blender --background --python scripts/blender_spatial_audit.py
"""

import bpy, os, json, math
from mathutils import Vector

BASE    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLB_IN  = os.path.join(BASE, "train_station_mega_world.glb")
OUT     = os.path.join(BASE, "scripts", "spatial_report.json")

print(f"\n=== IMPORTING ===")
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB_IN)
print("Done.\n")

# ── Collect all mesh object world-space centres + bounding boxes ──────────────
objects = []
world_min = Vector((1e9, 1e9, 1e9))
world_max = Vector((-1e9, -1e9, -1e9))

for obj in bpy.data.objects:
    if obj.type != 'MESH':
        continue
    # world-space bounding box corners
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    mn = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    mx = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    centre = (mn + mx) / 2

    world_min.x = min(world_min.x, mn.x); world_min.y = min(world_min.y, mn.y); world_min.z = min(world_min.z, mn.z)
    world_max.x = max(world_max.x, mx.x); world_max.y = max(world_max.y, mx.y); world_max.z = max(world_max.z, mx.z)

    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    objects.append({
        "name": obj.name,
        "cx": round(centre.x, 2), "cy": round(centre.y, 2), "cz": round(centre.z, 2),
        "min": [round(mn.x,2), round(mn.y,2), round(mn.z,2)],
        "max": [round(mx.x,2), round(mx.y,2), round(mx.z,2)],
        "tris": tris,
    })

print(f"World bounds  X: {world_min.x:.1f} → {world_max.x:.1f}  ({world_max.x - world_min.x:.1f} wide)")
print(f"              Y: {world_min.y:.1f} → {world_max.y:.1f}  ({world_max.y - world_min.y:.1f} deep)")
print(f"              Z: {world_min.z:.1f} → {world_max.z:.1f}  ({world_max.z - world_min.z:.1f} tall)")

# ── Grid heat-map on the XY plane (top-down) ─────────────────────────────────
# Divide world into GRID×GRID cells, count tris in each cell
GRID = 20
xs = world_max.x - world_min.x
ys = world_max.y - world_min.y
cell_x = xs / GRID
cell_y = ys / GRID

grid = [[0]*GRID for _ in range(GRID)]
for o in objects:
    cx, cy = o["cx"], o["cy"]
    gx = min(GRID-1, int((cx - world_min.x) / cell_x))
    gy = min(GRID-1, int((cy - world_min.y) / cell_y))
    grid[gy][gx] += o["tris"]

max_cell = max(max(row) for row in grid) or 1

print("\nTop-down density map (# = dense, . = empty)  [X→, Y↑]")
print("+" + "-"*GRID + "+")
for row in reversed(grid):
    line = ""
    for v in row:
        density = v / max_cell
        if density > 0.5:   line += "#"
        elif density > 0.2: line += "+"
        elif density > 0.05: line += "·"
        else:               line += " "
    print("|" + line + "|")
print("+" + "-"*GRID + "+")

# ── Find the "active zone" — bounding box of cells that have content ──────────
filled_xs, filled_ys = [], []
for gy in range(GRID):
    for gx in range(GRID):
        if grid[gy][gx] > 0:
            filled_xs.append(gx)
            filled_ys.append(gy)

if filled_xs:
    ax_min = min(filled_xs); ax_max = max(filled_xs)
    ay_min = min(filled_ys); ay_max = max(filled_ys)
    active_x_min = world_min.x + ax_min * cell_x
    active_x_max = world_min.x + (ax_max+1) * cell_x
    active_y_min = world_min.y + ay_min * cell_y
    active_y_max = world_min.y + (ay_max+1) * cell_y
    print(f"\nActive content zone:")
    print(f"  X: {active_x_min:.1f} → {active_x_max:.1f}  ({active_x_max-active_x_min:.1f} wide)")
    print(f"  Y: {active_y_min:.1f} → {active_y_max:.1f}  ({active_y_max-active_y_min:.1f} deep)")

# ── Dense cluster centre (weighted by tris) ───────────────────────────────────
total_w = sum(o["tris"] for o in objects) or 1
cx_w = sum(o["cx"] * o["tris"] for o in objects) / total_w
cy_w = sum(o["cy"] * o["tris"] for o in objects) / total_w
print(f"\nWeighted content centroid: ({cx_w:.2f}, {cy_w:.2f})")

# ── Identify truly empty quadrants ───────────────────────────────────────────
print("\nEmpty grid cells (no geometry at all):")
empty_cells = []
for gy in range(GRID):
    for gx in range(GRID):
        if grid[gy][gx] == 0:
            wx = world_min.x + (gx + 0.5) * cell_x
            wy = world_min.y + (gy + 0.5) * cell_y
            empty_cells.append({"gx": gx, "gy": gy, "wx": round(wx,1), "wy": round(wy,1)})

print(f"  {len(empty_cells)} / {GRID*GRID} cells are empty ({len(empty_cells)*100//(GRID*GRID)}%)")

# ── Named object positions (useful for understanding layout) ─────────────────
print("\nNamed/notable object positions:")
keywords = ["platform", "station", "train", "plaza", "track", "shop", "gate",
            "bench", "clock", "vendor", "bar", "kiosk", "ticket", "hall"]
notable = [o for o in objects if any(k in o["name"].lower() for k in keywords)]
notable.sort(key=lambda o: -o["tris"])
for o in notable[:30]:
    print(f"  {o['name']:45s}  pos=({o['cx']:7.1f}, {o['cy']:7.1f}, {o['cz']:5.1f})  tris={o['tris']:,}")

# ── Save full report ──────────────────────────────────────────────────────────
report = {
    "world_bounds": {
        "min": [round(world_min.x,2), round(world_min.y,2), round(world_min.z,2)],
        "max": [round(world_max.x,2), round(world_max.y,2), round(world_max.z,2)],
    },
    "active_zone": {
        "min": [round(active_x_min,2), round(active_y_min,2)],
        "max": [round(active_x_max,2), round(active_y_max,2)],
    } if filled_xs else None,
    "content_centroid": {"x": round(cx_w,2), "y": round(cy_w,2)},
    "grid_size": GRID,
    "grid_heatmap": grid,
    "empty_cell_count": len(empty_cells),
    "empty_cells": empty_cells,
    "objects": objects,
}
with open(OUT, "w") as f:
    json.dump(report, f, indent=2)
print(f"\nFull report → {OUT}")
