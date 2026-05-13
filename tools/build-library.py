#!/usr/bin/env python3
"""Scan books/ and packs/ and emit a single library.json at the site root.

A book is any books/<slug>/ directory that contains book.json AND manifest.json.
A pack is any packs/<slug>/ directory that contains pack.json. Packs that
specify a targetBook are grouped under that book; packs without a target
appear under "Other".
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
BOOKS = ROOT / "books"
PACKS = ROOT / "packs"
OUT = ROOT / "library.json"


def fmt_duration(seconds: float) -> str:
    if not seconds:
        return ""
    h, rem = divmod(int(seconds), 3600)
    m = rem // 60
    return f"{h}h {m:02d}m" if h else f"{m}m"


def collect_books():
    books = []
    if not BOOKS.exists():
        return books
    for d in sorted(BOOKS.iterdir()):
        if not d.is_dir():
            continue
        book_meta = d / "book.json"
        manifest = d / "manifest.json"
        if not book_meta.exists():
            continue
        info = json.loads(book_meta.read_text())
        info["slug"] = info.get("slug", d.name)
        if manifest.exists():
            m = json.loads(manifest.read_text())
            info["chapterCount"] = sum(1 for c in m.get("chapters", []) if c.get("segments"))
            info["totalDuration"] = m.get("totalDuration", 0)
            info["totalDurationLabel"] = fmt_duration(info["totalDuration"])
            cover = m.get("cover")
            if cover and not info.get("cover"):
                info["cover"] = f"books/{d.name}/{cover}"
            info["available"] = True
        else:
            info["chapterCount"] = 0
            info["totalDuration"] = 0
            info["totalDurationLabel"] = ""
            info["available"] = False
        info["packs"] = []
        books.append(info)
    return books


def collect_packs():
    packs = []
    if not PACKS.exists():
        return packs
    for d in sorted(PACKS.iterdir()):
        if not d.is_dir():
            continue
        meta = d / "pack.json"
        if not meta.exists():
            continue
        info = json.loads(meta.read_text())
        info["slug"] = info.get("slug", d.name)
        packs.append(info)
    return packs


def main():
    books = collect_books()
    by_slug = {b["slug"]: b for b in books}
    orphans = []
    for p in collect_packs():
        target = p.get("targetBook")
        if target and target in by_slug:
            by_slug[target]["packs"].append({
                "slug": p["slug"],
                "name": p.get("name", p["slug"]),
                "description": p.get("description", ""),
                "art": p.get("art", {}),
                "license": p.get("license", ""),
            })
        else:
            orphans.append(p)
    out = {
        "books": books,
        "orphanPacks": [
            {"slug": p["slug"], "name": p.get("name", p["slug"]),
             "targetBook": p.get("targetBook", "")}
            for p in orphans
        ],
    }
    OUT.write_text(json.dumps(out, indent=2))
    print(f"wrote {OUT}: {len(books)} books, {sum(len(b['packs']) for b in books)} packs")
    for b in books:
        avail = "" if b["available"] else " [no manifest — run build.py]"
        print(f"  {b['slug']:30s} {b['title']:35s} {len(b['packs'])} pack(s){avail}")


if __name__ == "__main__":
    main()
