#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from collections import defaultdict

ID_RE = re.compile(r'id="([^"]+)"')
TITLE_RE = re.compile(r'<title>([^<]+)</title>', re.IGNORECASE)


def classify(file_name: str) -> str:
    if file_name.startswith('bpy.ops.'):
        return 'ops_page'
    if file_name.startswith('bpy.types.'):
        return 'types_page'
    if file_name.startswith('bpy.app'):
        return 'app_page'
    if file_name.startswith('bpy.'):
        return 'bpy_page'
    if file_name.startswith('bmesh'):
        return 'bmesh_page'
    if file_name.startswith('mathutils'):
        return 'mathutils_page'
    if file_name.startswith('gpu'):
        return 'gpu_page'
    return 'other_page'


def scan_html(path: Path) -> dict:
    text = path.read_text(errors='ignore')
    ids = ID_RE.findall(text)
    title_m = TITLE_RE.search(text)
    title = title_m.group(1).strip() if title_m else path.name

    buckets = defaultdict(list)
    for anchor in ids:
        if anchor.startswith('bpy.ops.'):
            buckets['operators'].append(anchor)
        elif anchor.startswith('bpy.types.'):
            buckets['types'].append(anchor)
        elif anchor.startswith('bpy.app.'):
            buckets['app'].append(anchor)
        elif anchor.startswith('bpy.'):
            buckets['bpy'].append(anchor)
        elif anchor.startswith('bmesh.'):
            buckets['bmesh'].append(anchor)
        elif anchor.startswith('mathutils.'):
            buckets['mathutils'].append(anchor)
        elif anchor.startswith('gpu.'):
            buckets['gpu'].append(anchor)

    dedup = {k: sorted(set(v)) for k, v in buckets.items() if v}
    return {
        'file': path.name,
        'title': title,
        'class': classify(path.name),
        'id_count': len(ids),
        'anchors': dedup,
    }


def build_manifest(doc_root: Path) -> dict:
    entries = []
    for p in sorted(doc_root.glob('*.html')):
        entries.append(scan_html(p))

    ops_index = defaultdict(list)
    types_index = defaultdict(list)
    topic_index = defaultdict(list)

    for e in entries:
        f = e['file']
        for op in e['anchors'].get('operators', []):
            ops_index[op.split('.', 3)[2]].append({'id': op, 'file': f})
        for t in e['anchors'].get('types', []):
            types_index[t.split('.', 3)[2]].append({'id': t, 'file': f})

        cls = e['class']
        topic_index[cls].append(f)

    def sort_index(d: dict) -> dict:
        return {k: sorted(v, key=lambda x: (x['file'], x['id'])) for k, v in sorted(d.items())}

    return {
        'doc_root': str(doc_root),
        'pages_scanned': len(entries),
        'entries': entries,
        'indexes': {
            'operators_by_namespace': sort_index(ops_index),
            'types_by_namespace': sort_index(types_index),
            'pages_by_class': {k: sorted(v) for k, v in sorted(topic_index.items())},
        },
        'notes': [
            'Use this manifest to map natural-language tasks to exact Blender API anchors.',
            'Prefer local project scripts in junipali-game/blender_tools when overlap exists.',
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description='Generate Blender API manifest from local HTML docs')
    parser.add_argument('--doc-root', required=True, help='Path to blender python reference html directory')
    parser.add_argument('--out', required=True, help='Output JSON path')
    args = parser.parse_args()

    doc_root = Path(args.doc_root).expanduser().resolve()
    out = Path(args.out).expanduser().resolve()

    if not doc_root.exists():
        raise SystemExit(f'doc root not found: {doc_root}')

    manifest = build_manifest(doc_root)
    out.write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(f'Wrote manifest: {out}')
    print(f"Scanned pages: {manifest['pages_scanned']}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
