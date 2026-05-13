#!/usr/bin/env python3
"""Download the EPUB for a Project Gutenberg book.

Usage:
    python3 tools/fetch-gutenberg.py <book-slug> <gutenberg-id>

Reads books/<slug>/book.json to confirm the book is public-domain (refuses
to download otherwise — Gutenberg's whole point), then fetches the EPUB into
books/<slug>/content.epub. Doesn't unpack — that's a separate step, since
Storyteller-aligned EPUBs have a different on-disk layout than raw Gutenberg
ones.
"""
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent.parent


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
    license_str = info.get("license", "").lower()
    if "public domain" not in license_str and "cc0" not in license_str:
        print(f"refusing to fetch — book.json doesn't declare public-domain license", file=sys.stderr)
        print(f"current: {info.get('license')!r}", file=sys.stderr)
        sys.exit(1)

    url = f"https://www.gutenberg.org/ebooks/{gid}.epub3.images"
    book_dir.mkdir(parents=True, exist_ok=True)
    out = book_dir / "gutenberg.epub"
    print(f"fetching {url} ...")
    req = urllib.request.Request(url, headers={"User-Agent": "storyplay-fetch/0.1"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        out.write_bytes(resp.read())
    print(f"  wrote {out} ({out.stat().st_size / 1024:.0f} KB)")
    print(f"  next: unpack the EPUB into books/{slug}/content/, then run Storyteller to add audio alignment")


if __name__ == "__main__":
    main()
