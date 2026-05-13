#!/usr/bin/env python3
"""Slot a Storyteller-aligned EPUB back into a Storyplay book.

Usage:
    python3 tools/install-aligned-epub.py <book-slug> <path/to/aligned.epub>

Replaces books/<slug>/content/ with the aligned EPUB's contents and rebuilds
manifest.json. The reader auto-detects SMIL media overlays in the new
manifest and that book flips from text-only to fully synced.

Backs up the previous content/ to content.text-only.bak/ in case you want
to revert.
"""
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent.parent


def main():
    if len(sys.argv) != 3:
        print("usage: install-aligned-epub.py <book-slug> <aligned.epub>", file=sys.stderr); sys.exit(2)
    slug, epub_path = sys.argv[1], Path(sys.argv[2]).expanduser().resolve()
    if not epub_path.is_file():
        print(f"not a file: {epub_path}", file=sys.stderr); sys.exit(1)

    book_dir = ROOT / "books" / slug
    if not (book_dir / "book.json").exists():
        print(f"missing books/{slug}/book.json", file=sys.stderr); sys.exit(1)

    content = book_dir / "content"
    backup = book_dir / "content.text-only.bak"
    if content.exists():
        if backup.exists():
            shutil.rmtree(backup)
        print(f"▸ backing up text-only content → {backup}")
        content.rename(backup)
    content.mkdir(parents=True)

    print(f"▸ unpacking {epub_path.name} → {content}")
    with zipfile.ZipFile(epub_path, "r") as z:
        z.extractall(content)

    # If the aligned EPUB has a nested OEBPS layout, flatten it like the
    # Gutenberg fetcher does.
    if not (content / "package.opf").exists():
        opfs = list(content.rglob("package.opf")) + list(content.rglob("*.opf"))
        if opfs:
            opf_dir = opfs[0].parent
            print(f"  flattening {opf_dir.relative_to(content)}/* → content/")
            for child in opf_dir.iterdir():
                target = content / child.name
                if target.exists():
                    if target.is_dir(): shutil.rmtree(target)
                    else: target.unlink()
                shutil.move(str(child), str(target))
            try: opf_dir.rmdir()
            except OSError: pass
        if not (content / "package.opf").exists():
            for cand in content.glob("*.opf"):
                cand.rename(content / "package.opf")
                break

    print(f"▸ rebuilding manifest")
    subprocess.run([sys.executable, "build.py", slug], cwd=ROOT, check=True)
    print(f"▸ rebuilding library index")
    subprocess.run([sys.executable, "tools/build-library.py"], cwd=ROOT, check=True)
    print(f"\n✓ {slug} is now aligned. Reload the reader to see word-by-word sync.")
    print(f"  text-only backup preserved at {backup}")


if __name__ == "__main__":
    main()
