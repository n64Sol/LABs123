#!/usr/bin/env python3
"""Inspect LPC sprite sheets and report frame geometry + animation layout.

Reusable port of the feasibility `analyze.py`. Use it when adding new LPC parts
to confirm a sheet matches the geometry the composer expects before you add it to
the allowlist.

Usage:

  # report the row/frame layout the pipeline assumes
  python analyze.py layout

  # inspect one or more sheets (dimensions, frame size, classic/expanded/oversize)
  python analyze.py inspect /path/to/sheet.png [more.png ...]

  # scan a directory tree and tally sheet dimensions
  python analyze.py scan /path/to/lpc_root
"""
from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

from PIL import Image

import slots


def report_layout() -> None:
    print(f"Frame cell: {slots.CELL}x{slots.CELL}px")
    print(f"Classic sheet: {slots.SHEET_W}x{slots.SHEET_H} ({slots.COLS} cols x {slots.ROWS} rows)")
    print(f"Direction order: {', '.join(slots.DIRECTION_ORDER)}")
    print("Animation rows (start_row, frames):")
    for name, (start, frames) in slots.ANIMATION_ROWS.items():
        print(f"  {name:<10} rows {start}-{start + 3:<3} {frames} frames")
    print("\nBase character layer order (bottom -> top):")
    for i, s in enumerate(slots.BASE_LAYER_ORDER):
        print(f"  {i:>2}. {s}")
    print("\nRuntime equipment z-order (negative = behind body):")
    for k, z in sorted(slots.EQUIP_LAYER_Z.items(), key=lambda t: t[1]):
        print(f"  {z:>4}  {k}")


def classify(w: int, h: int) -> str:
    if w == slots.SHEET_W and h == slots.SHEET_H:
        return "classic 832x1344 (21 rows)"
    if w == slots.SHEET_W and h == 2944:
        return "expanded 832x2944 (46 rows; uses top 21)"
    if h == slots.OVERSIZE_FRAME * 4 and w % slots.OVERSIZE_FRAME == 0:
        return f"oversize {slots.OVERSIZE_FRAME}px weapon ({w // slots.OVERSIZE_FRAME} cols x 4 dirs)"
    return "non-standard (verify before use)"


def inspect(paths: list[Path]) -> None:
    for p in paths:
        if not p.exists():
            print(f"{p}: MISSING")
            continue
        with Image.open(p) as im:
            w, h = im.size
        print(f"{p.name}: {w}x{h} -> {classify(w, h)}")


def scan(root: Path) -> None:
    counts: Counter[tuple[int, int]] = Counter()
    total = 0
    for p in root.rglob("*.png"):
        try:
            with Image.open(p) as im:
                counts[im.size] += 1
                total += 1
        except Exception:
            continue
    print(f"Scanned {total} PNGs under {root}")
    for (w, h), n in counts.most_common(20):
        print(f"  {w}x{h:<6} {n:>6}  {classify(w, h)}")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("layout", help="print the geometry/z-order model the pipeline uses")
    pi = sub.add_parser("inspect", help="report dimensions of one or more sheets")
    pi.add_argument("paths", nargs="+", type=Path)
    ps = sub.add_parser("scan", help="tally sheet dimensions across a source tree")
    ps.add_argument("root", type=Path)

    args = ap.parse_args(argv)
    if args.cmd == "layout":
        report_layout()
    elif args.cmd == "inspect":
        inspect(args.paths)
    elif args.cmd == "scan":
        scan(args.root)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
