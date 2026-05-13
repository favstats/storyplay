#!/usr/bin/env python3
"""Download a LibriVox audiobook and unpack it into books/<slug>/audio/.

Usage:
    python3 tools/fetch-librivox.py <book-slug> [<librivox-id>]

If <librivox-id> is omitted, looks up the IDs hardcoded for the three demo
books. Requires the target book's book.json to declare a public-domain
license — LibriVox recordings are PD/CC0 but we still won't fetch over a
copyrighted book.json by mistake.

The result is books/<slug>/audio/*.mp3 (one file per chapter). That folder
is what you feed to Storyteller. After Storyteller finishes alignment,
replace books/<slug>/content/ with the aligned EPUB it exports.
"""
import json
import shutil
import sys
import urllib.parse
import urllib.request
import zipfile
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).parent.parent
UA = "storyplay-fetch/0.1 (+https://github.com/favstats/storyplay)"

# Curated mapping for the three public-domain demo books shipped with
# Storyplay. The IDs map (book-slug → librivox-id).
DEMO_IDS = {
    "dracula":          "271",
    "frankenstein":     "2030",   # 1818 edition — matches Gutenberg #84
    "sherlock-bohemia": "314",    # The Adventures of Sherlock Holmes
}


def api_lookup(lid: str) -> dict:
    url = f"https://librivox.org/api/feed/audiobooks/?id={lid}&format=json"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    books = data.get("books") or []
    if not books:
        raise RuntimeError(f"LibriVox id {lid} returned no books")
    return books[0]


def download_zip(url: str, out_path: Path) -> bytes:
    # LibriVox's url_zip_file contains an unencoded space.
    parts = urllib.parse.urlsplit(url)
    safe_query = urllib.parse.quote(parts.query, safe="=&")
    safe = urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path, safe_query, parts.fragment))
    print(f"  GET {safe}")
    req = urllib.request.Request(safe, headers={"User-Agent": UA})
    chunks = []
    with urllib.request.urlopen(req, timeout=300) as r:
        total = 0
        while True:
            chunk = r.read(1024 * 1024)
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            print(f"\r  downloaded {total/(1024*1024):.1f} MB", end="", flush=True)
        print()
    data = b"".join(chunks)
    out_path.write_bytes(data)
    return data


def main():
    if len(sys.argv) not in (2, 3):
        print("usage: fetch-librivox.py <book-slug> [<librivox-id>]", file=sys.stderr)
        sys.exit(2)
    slug = sys.argv[1]
    lid = sys.argv[2] if len(sys.argv) == 3 else DEMO_IDS.get(slug)
    if not lid:
        print(f"no LibriVox ID hardcoded for {slug!r}; pass one as the second arg.\n"
              f"  Find it at https://librivox.org/search?title=...", file=sys.stderr)
        sys.exit(1)

    book_dir = ROOT / "books" / slug
    book_meta_path = book_dir / "book.json"
    if not book_meta_path.exists():
        print(f"missing {book_meta_path}", file=sys.stderr)
        sys.exit(1)
    info = json.loads(book_meta_path.read_text())
    license_str = info.get("license", "").lower()
    if "public domain" not in license_str and "cc0" not in license_str:
        print(f"refusing — book.json doesn't declare public-domain license", file=sys.stderr)
        sys.exit(1)

    print(f"▸ Looking up LibriVox id {lid} for {slug} ...")
    book = api_lookup(lid)
    title = book.get("title", "?")
    zip_url = book.get("url_zip_file")
    if not zip_url:
        print("  LibriVox returned no url_zip_file", file=sys.stderr)
        sys.exit(1)
    print(f"  {title}")
    print(f"  zip: {zip_url}")

    audio_dir = book_dir / "audio"
    if audio_dir.exists():
        print(f"  removing existing {audio_dir}")
        shutil.rmtree(audio_dir)
    audio_dir.mkdir(parents=True)

    cache_path = audio_dir / f"librivox-{lid}.zip"
    print(f"▸ Downloading (this is a few hundred MB — be patient) ...")
    data = download_zip(zip_url, cache_path)

    print(f"▸ Unpacking ...")
    with zipfile.ZipFile(BytesIO(data)) as z:
        z.extractall(audio_dir)

    # Move any nested files up one level if the zip contained a directory.
    nested_dirs = [d for d in audio_dir.iterdir() if d.is_dir()]
    if len(nested_dirs) == 1 and not any(audio_dir.glob("*.mp3")):
        inner = nested_dirs[0]
        for f in inner.iterdir():
            target = audio_dir / f.name
            if target.exists():
                target.unlink() if target.is_file() else shutil.rmtree(target)
            shutil.move(str(f), str(target))
        inner.rmdir()

    mp3s = sorted(audio_dir.glob("*.mp3"))
    if not mp3s:
        print("  no .mp3 files unpacked — archive may have an unexpected structure", file=sys.stderr)
        sys.exit(1)
    cache_path.unlink(missing_ok=True)
    total_mb = sum(f.stat().st_size for f in mp3s) / (1024 * 1024)
    print(f"\n✓ {len(mp3s)} audio file(s) ready in {audio_dir}")
    print(f"  total: {total_mb:.0f} MB")
    print(f"\nNext: feed books/{slug}/audio/ to Storyteller along with the")
    print(f"already-fetched EPUB at books/{slug}/content/. See docs/audio-alignment.md.")


if __name__ == "__main__":
    main()
