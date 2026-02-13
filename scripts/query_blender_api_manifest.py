#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description='Query Blender API manifest')
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--q', required=True, help='substring to search in ids/files/titles')
    parser.add_argument('--limit', type=int, default=25)
    args = parser.parse_args()

    data = json.loads(Path(args.manifest).read_text(encoding='utf-8'))
    q = args.q.lower()
    out = []

    for entry in data.get('entries', []):
        file = entry.get('file', '')
        title = entry.get('title', '')
        if q in file.lower() or q in title.lower():
            out.append((file, title, None))
        for group, anchors in entry.get('anchors', {}).items():
            for a in anchors:
                if q in a.lower():
                    out.append((file, title, a))

    # stable dedupe
    seen = set()
    uniq = []
    for row in out:
        if row in seen:
            continue
        seen.add(row)
        uniq.append(row)

    for file, title, anchor in uniq[: args.limit]:
        if anchor:
            print(f'{file}: {anchor}')
        else:
            print(f'{file}: {title}')

    print(f'\nresults={min(len(uniq), args.limit)} shown / total={len(uniq)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
