#!/usr/bin/env python3
"""Bundle a pack into a .spk archive for distribution.

Usage:
    python3 tools/pack-zip.py <pack-slug>

Writes dist/<pack-slug>-<version>.spk — a zip of packs/<pack-slug>/
with pack.json forced to the top. Skips dotfiles, OS junk, and the
.cache directory used by the AI image generator.
"""
import json
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent.parent
SKIP_NAMES = {".DS_Store", "Thumbs.db", ".cache", "__pycache__"}


def main():
    if len(sys.argv) != 2:
        print("usage: pack-zip.py <pack-slug>", file=sys.stderr)
        sys.exit(2)
    slug = sys.argv[1]
    src = ROOT / "packs" / slug
    if not src.is_dir():
        print(f"missing pack: {src}", file=sys.stderr)
        sys.exit(1)
    meta_path = src / "pack.json"
    if not meta_path.exists():
        print(f"missing pack.json in {src}", file=sys.stderr)
        sys.exit(1)
    meta = json.loads(meta_path.read_text())
    version = meta.get("version", "0.0.0")

    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    out = dist / f"{slug}-{version}.spk"

    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as z:
        files = []
        for p in src.rglob("*"):
            if any(part in SKIP_NAMES or part.startswith(".") for part in p.relative_to(src).parts):
                continue
            if p.is_file():
                files.append(p)
        # write pack.json first so consumers can read metadata without unzipping everything
        z.write(meta_path, arcname=f"{slug}/pack.json")
        for f in files:
            if f == meta_path:
                continue
            z.write(f, arcname=f"{slug}/{f.relative_to(src)}")

    size_mb = out.stat().st_size / (1024 * 1024)
    print(f"wrote {out} ({size_mb:.1f} MB)")
    print(f"  contains {len(files)} files (pack.json + {len(files) - 1} others)")


if __name__ == "__main__":
    main()
