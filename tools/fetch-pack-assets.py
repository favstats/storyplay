#!/usr/bin/env python3
"""Fetch a pack's curated public-domain images from Wikimedia / Internet Archive.

Usage:
    python3 tools/fetch-pack-assets.py <pack-slug> [--dry-run] [--force]

Reads packs/<pack-slug>/assets.json — a list of entries shaped like:

    {
      "filename": "harker.jpg",
      "category": "characters" | "backgrounds" | "moments",
      "url":      "https://commons.wikimedia.org/wiki/Special:FilePath/...",
      "width":    1200,                   // optional, defaults to 1600
      "attribution": "Author, Year — PD via Wikimedia Commons"
    }

Writes each image to packs/<pack-slug>/<category>/<filename>. Refuses
to overwrite existing files unless --force is set. Tracks a checksum log
in packs/<pack-slug>/.fetched.json so re-runs are idempotent.
"""
import argparse
import hashlib
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent.parent
UA = "storyplay-fetch/0.1 (+https://github.com/favstats/storyplay)"


def url_with_width(url: str, width: int) -> str:
    # Special:FilePath accepts ?width=<n> for a scaled JPEG.
    if "Special:FilePath" not in url:
        return url
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}width={width}"


def fetch_one(url: str, dest: Path, force: bool) -> tuple[bool, str]:
    if dest.exists() and not force:
        return False, "exists"
    # urllib refuses URLs with unencoded spaces / unicode. Re-quote the
    # path component, keeping the scheme + host + query intact.
    parts = urllib.parse.urlsplit(url)
    safe_path = urllib.parse.quote(parts.path, safe="/:%")
    safe_url = urllib.parse.urlunsplit((parts.scheme, parts.netloc, safe_path, parts.query, parts.fragment))
    req = urllib.request.Request(safe_url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = resp.read()
            ctype = resp.headers.get("Content-Type", "")
    except Exception as e:
        return False, f"error: {e}"
    if not ctype.startswith("image/"):
        return False, f"not an image (Content-Type: {ctype}, {len(data)}B)"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    h = hashlib.sha256(data).hexdigest()[:12]
    return True, f"{len(data)/1024:.0f} KB  sha256:{h}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pack")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    pack_dir = ROOT / "packs" / args.pack
    manifest = pack_dir / "assets.json"
    if not manifest.exists():
        print(f"missing {manifest}", file=sys.stderr)
        sys.exit(1)
    entries = json.loads(manifest.read_text())
    if not isinstance(entries, list):
        print("assets.json must be a list", file=sys.stderr)
        sys.exit(1)

    by_cat = {}
    for e in entries:
        by_cat.setdefault(e["category"], []).append(e)

    fetched_log_path = pack_dir / ".fetched.json"
    log = {}
    if fetched_log_path.exists():
        try:
            log = json.loads(fetched_log_path.read_text())
        except Exception:
            log = {}

    n_ok = n_skip = n_fail = 0
    for cat, items in by_cat.items():
        print(f"\n[{cat}]  ({len(items)} item(s))")
        for e in items:
            dest = pack_dir / e["category"] / e["filename"]
            width = e.get("width", 1600)
            url = url_with_width(e["url"], width)
            if args.dry_run:
                print(f"  DRY {dest.relative_to(pack_dir)}  <- {url}")
                continue
            wrote, info = fetch_one(url, dest, args.force)
            tag = "OK " if wrote else ("SKIP" if info == "exists" else "FAIL")
            print(f"  {tag} {str(dest.relative_to(pack_dir)):40s}  {info}")
            if wrote:
                n_ok += 1
                log[str(dest.relative_to(pack_dir))] = {
                    "url": url,
                    "attribution": e.get("attribution", ""),
                    "fetched_at": int(time.time()),
                }
            elif info == "exists":
                n_skip += 1
            else:
                n_fail += 1
            # tiny politeness delay
            time.sleep(0.15)

    if not args.dry_run:
        fetched_log_path.write_text(json.dumps(log, indent=2))
    print(f"\n{n_ok} fetched, {n_skip} skipped (exists), {n_fail} failed")
    if n_fail:
        sys.exit(1)


if __name__ == "__main__":
    main()
