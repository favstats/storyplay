#!/usr/bin/env python3
"""One-command setup for the three public-domain demo books.

Fetches Gutenberg EPUBs, unpacks them, builds text-only manifests, fetches
pack art, and refreshes the library index. Idempotent — re-running skips
anything already on disk.

Usage:
    python3 tools/setup-demos.py            # fetch text + art for all demos
    python3 tools/setup-demos.py --skip-art # only text + manifests
    python3 tools/setup-demos.py --skip-text  # only pack art (assumes text exists)
"""
import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent

# (book-slug, gutenberg-id, pack-slug)
DEMOS = [
    ("dracula",          "345",  "dracula-public-domain"),
    ("frankenstein",     "84",   "frankenstein-public-domain"),
    ("sherlock-bohemia", "1661", "sherlock-paget"),
]


def run(cmd: list[str], label: str) -> int:
    print(f"\n━━━ {label}")
    print(f"    $ {' '.join(cmd)}")
    res = subprocess.run(cmd, cwd=ROOT)
    return res.returncode


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-text", action="store_true")
    ap.add_argument("--skip-art", action="store_true")
    args = ap.parse_args()

    fails: list[str] = []

    for slug, gid, pack in DEMOS:
        book_dir = ROOT / "books" / slug
        content_dir = book_dir / "content"
        manifest = book_dir / "manifest.json"

        if not args.skip_text:
            if content_dir.exists() and any(content_dir.iterdir()):
                print(f"\n━━━ {slug}: text already present — skipping fetch")
            else:
                rc = run(
                    [sys.executable, "tools/fetch-gutenberg.py", slug, gid],
                    f"{slug}: fetching Gutenberg #{gid}",
                )
                if rc != 0:
                    fails.append(f"{slug} fetch")
                    continue

            if not manifest.exists() or content_dir.exists():
                rc = run(
                    [sys.executable, "build.py", slug],
                    f"{slug}: building manifest",
                )
                if rc != 0:
                    fails.append(f"{slug} build")

        if not args.skip_art:
            assets = ROOT / "packs" / pack / "assets.json"
            if assets.exists():
                rc = run(
                    [sys.executable, "tools/fetch-pack-assets.py", pack],
                    f"{pack}: fetching curated public-domain art",
                )
                if rc != 0:
                    fails.append(f"{pack} art")

    rc = run([sys.executable, "tools/build-library.py"], "rebuilding library.json")
    if rc != 0:
        fails.append("library index")

    print()
    if fails:
        print(f"FINISHED with {len(fails)} step(s) failed: {', '.join(fails)}")
        sys.exit(1)
    print("FINISHED — all three demo books ready.")
    print("Start the server with:  ./start.sh")


if __name__ == "__main__":
    main()
