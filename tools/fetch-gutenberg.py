#!/usr/bin/env python3
"""Download + unpack a Project Gutenberg EPUB into books/<slug>/content/.

Usage:
    python3 tools/fetch-gutenberg.py <book-slug> <gutenberg-id>

Reads books/<slug>/book.json (which must declare a public-domain license),
fetches the EPUB from Gutenberg, and unzips it into books/<slug>/content/
in the layout build.py expects. The book is then ready for `python3 build.py
<slug>` to produce a text-only manifest. Adding audio alignment later is a
separate Storyteller step.
"""
import json
import shutil
import sys
import urllib.request
import zipfile
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).parent.parent
UA = "storyplay-fetch/0.1 (+https://github.com/favstats/storyplay)"


def fetch_epub_bytes(gid: str) -> bytes:
    candidates = [
        f"https://www.gutenberg.org/ebooks/{gid}.epub3.images",
        f"https://www.gutenberg.org/ebooks/{gid}.epub.images",
        f"https://www.gutenberg.org/ebooks/{gid}.epub.noimages",
    ]
    last_err = None
    for url in candidates:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = resp.read()
                if data[:4] == b"PK\x03\x04" or len(data) > 10_000:
                    return data
        except Exception as e:
            last_err = e
    raise RuntimeError(f"all Gutenberg URLs failed: {last_err}")


def main():
    if len(sys.argv) != 3:
        print("usage: fetch-gutenberg.py <book-slug> <gutenberg-id>", file=sys.stderr)
        sys.exit(2)
    slug, gid = sys.argv[1], sys.argv[2]
    book_dir = ROOT / "books" / slug
    meta = book_dir / "book.json"
    if not meta.exists():
        print(f"missing {meta} — create books/{slug}/book.json first", file=sys.stderr)
        sys.exit(1)
    info = json.loads(meta.read_text())
    lic = info.get("license", "").lower()
    if "public domain" not in lic and "cc0" not in lic:
        print(f"refusing to fetch — book.json doesn't declare public-domain license", file=sys.stderr)
        print(f"  current: {info.get('license')!r}", file=sys.stderr)
        sys.exit(1)

    print(f"fetching Gutenberg #{gid} for {slug} ...")
    data = fetch_epub_bytes(gid)
    print(f"  got {len(data)/1024:.0f} KB")

    content_dir = book_dir / "content"
    if content_dir.exists():
        print(f"  removing existing {content_dir}")
        shutil.rmtree(content_dir)
    content_dir.mkdir(parents=True)

    with zipfile.ZipFile(BytesIO(data)) as z:
        # Gutenberg EPUB has package.opf inside an EPUB subfolder; we want
        # the OPF and everything it references in the same content/ tree.
        # Strategy: extract everything, then find package.opf and reroot if needed.
        z.extractall(content_dir)

    opfs = list(content_dir.rglob("package.opf")) + list(content_dir.rglob("*.opf"))
    if not opfs:
        print("  no .opf file found in archive", file=sys.stderr)
        sys.exit(1)
    opf = opfs[0]
    if opf.parent != content_dir:
        # Move the OPF directory's contents up to content/
        opf_dir = opf.parent
        print(f"  flattening: moving {opf_dir.relative_to(content_dir)}/* → content/")
        for child in opf_dir.iterdir():
            target = content_dir / child.name
            if target.exists():
                if target.is_dir():
                    shutil.rmtree(target)
                else:
                    target.unlink()
            shutil.move(str(child), str(target))
        # Clean up empty directories
        if opf_dir != content_dir:
            try:
                opf_dir.rmdir()
            except OSError:
                pass

    final_opf = content_dir / "package.opf"
    if not final_opf.exists():
        # Some Gutenberg files use a different name like "content.opf"
        for cand in content_dir.glob("*.opf"):
            cand.rename(final_opf)
            break
    if not final_opf.exists():
        print("  could not establish content/package.opf", file=sys.stderr)
        sys.exit(1)

    print(f"  unpacked into {content_dir}")
    print(f"  next: python3 build.py {slug}")


if __name__ == "__main__":
    main()
