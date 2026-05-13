#!/usr/bin/env python3
"""Install a .spk pack archive into packs/.

Usage:
    python3 tools/pack-install.py <path/to/pack.spk>
    python3 tools/pack-install.py <path/to/pack.spk> --force

The archive must contain a top-level <slug>/ directory with a pack.json.
Refuses to overwrite an existing pack unless --force is passed.
"""
import json
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent.parent


def main():
    args = sys.argv[1:]
    force = "--force" in args
    args = [a for a in args if a != "--force"]
    if len(args) != 1:
        print("usage: pack-install.py <file.spk> [--force]", file=sys.stderr)
        sys.exit(2)
    src = Path(args[0]).expanduser().resolve()
    if not src.is_file():
        print(f"not a file: {src}", file=sys.stderr)
        sys.exit(1)

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        with zipfile.ZipFile(src, "r") as z:
            z.extractall(tmp)
        # Find the top-level pack directory: should be exactly one dir
        # with a pack.json inside.
        candidates = [d for d in tmp.iterdir() if d.is_dir() and (d / "pack.json").exists()]
        if not candidates:
            print(f"no pack.json found in archive", file=sys.stderr)
            sys.exit(1)
        if len(candidates) > 1:
            print(f"archive contains multiple packs: {[c.name for c in candidates]}", file=sys.stderr)
            sys.exit(1)
        pack_dir = candidates[0]
        meta = json.loads((pack_dir / "pack.json").read_text())
        slug = meta.get("slug", pack_dir.name)
        target = ROOT / "packs" / slug
        if target.exists():
            if not force:
                print(f"pack already installed at {target} — pass --force to overwrite", file=sys.stderr)
                sys.exit(1)
            shutil.rmtree(target)
        shutil.copytree(pack_dir, target)
        print(f"installed {slug} ({meta.get('name', slug)}) → {target}")
        if meta.get("targetBook"):
            print(f"  targets book: {meta['targetBook']}")
        print(f"  refresh the library (python3 tools/build-library.py) to see it")


if __name__ == "__main__":
    main()
