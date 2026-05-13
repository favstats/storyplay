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

    # Find the actual OPF location. The Gutenberg fetcher flattened a
    # nested OEBPS layout into content/, so package.opf lives at the root
    # but META-INF/container.xml still claims it's at OEBPS/content.opf.
    # We rewrite container.xml on the fly to point at the real location.
    opf_rel = None
    for cand in ("package.opf", "content.opf"):
        if (src / cand).exists():
            opf_rel = cand
            break
    if not opf_rel:
        for p in src.rglob("*.opf"):
            opf_rel = str(p.relative_to(src)).replace("\\", "/")
            break
    if not opf_rel:
        print(f"no .opf file under {src}", file=sys.stderr); sys.exit(1)

    container_xml = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">\n'
        '  <rootfiles>\n'
        f'    <rootfile full-path="{opf_rel}" media-type="application/oebps-package+xml"/>\n'
        '  </rootfiles>\n'
        '</container>\n'
    )

    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as z:
        # mimetype first, stored uncompressed
        z.write(src / "mimetype", arcname="mimetype", compress_type=zipfile.ZIP_STORED)
        # rewritten container.xml so it actually points at our flat OPF
        z.writestr("META-INF/container.xml", container_xml)
        for p in sorted(src.rglob("*")):
            if not p.is_file():
                continue
            rel = str(p.relative_to(src)).replace("\\", "/")
            if rel in ("mimetype", "META-INF/container.xml"):
                continue
            z.write(p, arcname=rel)

    print(f"wrote {out} ({out.stat().st_size / (1024*1024):.1f} MB)")


if __name__ == "__main__":
    main()
