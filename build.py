#!/usr/bin/env python3
"""Parse a Storyteller-aligned EPUB into manifest.json for a given book.

Usage:
    python build.py <book-slug>

Reads from books/<slug>/content/ (which should contain the unpacked EPUB —
package.opf, MediaOverlays, Audio, etc.) and writes books/<slug>/manifest.json.

All asset paths in the output manifest are relative to the book root
(books/<slug>/), so the reader resolves them as
    `books/<slug>/<relative_path>`
regardless of where the book lives in the library.
"""
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).parent

NS = {
    "opf": "http://www.idpf.org/2007/opf",
    "smil": "http://www.w3.org/ns/SMIL",
    "epub": "http://www.idpf.org/2007/ops",
    "dc": "http://purl.org/dc/elements/1.1/",
}

CLIP_RE = re.compile(r"([\d.]+)s")
TITLE_RE = re.compile(r"<h1[^>]*class=[\"'][^\"']*chapter-title[^\"']*[\"'][^>]*>(.*?)</h1>", re.S)
H1_RE = re.compile(r"<h1[^>]*>(.*?)</h1>", re.S)
TAG_RE = re.compile(r"<[^>]+>")


def extract_title(xhtml_path: Path) -> str:
    try:
        text = xhtml_path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""
    m = TITLE_RE.search(text) or H1_RE.search(text)
    if not m:
        return ""
    raw = TAG_RE.sub("", m.group(1))
    return re.sub(r"\s+", " ", raw).strip()[:80]


def parse_clip(s: str) -> float:
    m = CLIP_RE.search(s)
    return float(m.group(1)) if m else 0.0


def parse_smil(smil_path: Path):
    tree = ET.parse(smil_path)
    root = tree.getroot()
    segments = []
    current = None
    for par in root.iter(f"{{{NS['smil']}}}par"):
        text_el = par.find(f"{{{NS['smil']}}}text")
        audio_el = par.find(f"{{{NS['smil']}}}audio")
        if text_el is None or audio_el is None:
            continue
        src = text_el.get("src", "")
        frag_id = src.split("#", 1)[1] if "#" in src else src
        a_src = audio_el.get("src", "")
        start = parse_clip(audio_el.get("clipBegin", "0s"))
        end = parse_clip(audio_el.get("clipEnd", "0s"))
        if current is None or current["audio"] != a_src:
            current = {"audio": a_src, "fragments": []}
            segments.append(current)
        current["fragments"].append({"id": frag_id, "start": start, "end": end})
    return segments


def build(book_slug: str) -> None:
    book_root = ROOT / "books" / book_slug
    content = book_root / "content"
    opf = content / "package.opf"
    if not opf.exists():
        print(f"missing {opf}", file=sys.stderr)
        sys.exit(1)

    def rel_to_book(p: Path) -> str:
        return str(p.resolve().relative_to(book_root.resolve())).replace("\\", "/")

    tree = ET.parse(opf)
    root = tree.getroot()
    meta = root.find(f"{{{NS['opf']}}}metadata")
    title = meta.findtext(f"{{{NS['dc']}}}title", default="Untitled")
    creator = meta.findtext(f"{{{NS['dc']}}}creator", default="")

    manifest_el = root.find(f"{{{NS['opf']}}}manifest")
    id_to_href = {}
    id_to_overlay = {}
    for item in manifest_el.iter(f"{{{NS['opf']}}}item"):
        iid = item.get("id")
        id_to_href[iid] = item.get("href")
        overlay = item.get("media-overlay")
        if overlay:
            id_to_overlay[iid] = overlay

    cover_href = None
    for cover_meta in meta.findall(f"{{{NS['opf']}}}meta"):
        if cover_meta.get("name") == "cover":
            cover_id = cover_meta.get("content")
            if cover_id in id_to_href:
                cover_href = id_to_href[cover_id]
    if not cover_href:
        for iid, href in id_to_href.items():
            if "cover" in iid.lower() and href.lower().endswith((".jpg", ".jpeg", ".png")):
                cover_href = href
                break

    opf_dir = opf.parent
    spine_el = root.find(f"{{{NS['opf']}}}spine")
    chapters = []
    for itemref in spine_el.iter(f"{{{NS['opf']}}}itemref"):
        idref = itemref.get("idref")
        href = id_to_href.get(idref)
        if not href:
            continue
        overlay_id = id_to_overlay.get(idref)
        segments = []
        if overlay_id and overlay_id in id_to_href:
            smil_path = (opf_dir / id_to_href[overlay_id]).resolve()
            try:
                for seg in parse_smil(smil_path):
                    audio_abs = (smil_path.parent / seg["audio"]).resolve()
                    seg_duration = (
                        seg["fragments"][-1]["end"] - seg["fragments"][0]["start"]
                        if seg["fragments"] else 0
                    )
                    seg_start_offset = seg["fragments"][0]["start"] if seg["fragments"] else 0
                    segments.append({
                        "audio": rel_to_book(audio_abs),
                        "clipStart": seg_start_offset,
                        "duration": seg_duration,
                        "fragments": seg["fragments"],
                    })
            except Exception as e:
                print(f"smil parse failed {smil_path}: {e}", file=sys.stderr)

        xhtml_abs = (opf_dir / href).resolve()
        chapters.append({
            "id": idref,
            "title": extract_title(xhtml_abs),
            "xhtml": rel_to_book(xhtml_abs),
            "segments": segments,
            "duration": sum(s["duration"] for s in segments),
        })

    cover_path = None
    if cover_href:
        try:
            cover_path = rel_to_book((opf_dir / cover_href).resolve())
        except ValueError:
            cover_path = None

    out = {
        "title": title,
        "creator": creator,
        "cover": cover_path,
        "chapters": chapters,
        "totalDuration": sum(c["duration"] for c in chapters),
    }

    manifest_path = book_root / "manifest.json"
    manifest_path.write_text(json.dumps(out, indent=1))
    audible = sum(1 for c in chapters if c["segments"])
    print(f"wrote {manifest_path}")
    print(f"  title: {title}")
    print(f"  chapters: {len(chapters)} (with audio: {audible})")
    print(f"  total: {out['totalDuration']/3600:.1f}h")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: build.py <book-slug>", file=sys.stderr)
        sys.exit(2)
    build(sys.argv[1])
