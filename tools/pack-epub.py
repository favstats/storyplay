#!/usr/bin/env python3
"""Pack books/<slug>/content/ into a Storyteller-ready EPUB.

Usage:
    python3 tools/pack-epub.py <book-slug>

Writes books/<slug>/source.epub. The mimetype file goes in first,
uncompressed — that's the EPUB spec, and Storyteller refuses to accept
archives that don't follow it.
"""
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent.parent


def main():
    if len(sys.argv) != 2:
        print("usage: pack-epub.py <book-slug>", file=sys.stderr); sys.exit(2)
    slug = sys.argv[1]
    src = ROOT / "books" / slug / "content"
    if not (src / "mimetype").exists():
        print(f"missing {src}/mimetype — not a Gutenberg EPUB layout", file=sys.stderr); sys.exit(1)
    out = ROOT / "books" / slug / "source.epub"

    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as z:
        # mimetype first, stored uncompressed
        z.write(src / "mimetype", arcname="mimetype", compress_type=zipfile.ZIP_STORED)
        for p in sorted(src.rglob("*")):
            if p.is_file() and p != src / "mimetype":
                z.write(p, arcname=str(p.relative_to(src)).replace("\\", "/"))

    print(f"wrote {out} ({out.stat().st_size / (1024*1024):.1f} MB)")


if __name__ == "__main__":
    main()
