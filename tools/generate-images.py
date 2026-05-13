#!/usr/bin/env python3
"""Generate character portraits and scene background art for a chapter.

Usage:
    export OPENAI_API_KEY=sk-...      # or
    export GEMINI_API_KEY=AIza...
    python3 generate-images.py scenes/chapter002.json [--provider openai|gemini]
                                                      [--force]
                                                      [--style "painterly sci-fi"]

What it does:
    Reads the chapter data file, generates one portrait per character
    (1024x1024) and one background per scene (1536x1024 if supported).
    Writes PNGs to scenes/characters/<id>.png and scenes/backgrounds/<id>.png,
    and updates the JSON to point to those PNGs (overwriting the SVG refs).
    Caches by prompt hash so re-running only regenerates what's changed.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Optional
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).parent
CACHE_DIR = ROOT / "scenes" / ".cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_STYLE = (
    "painterly sci-fi digital art, cinematic dramatic lighting, muted "
    "desaturated palette with deep shadows and one accent color, no text, "
    "no letters, no captions, no signature"
)
PORTRAIT_STYLE = (
    "head-and-shoulders portrait, three-quarter view, character centered, "
    "plain dark vignette background, no other figures"
)
SCENE_STYLE = (
    "wide cinematic establishing shot, atmospheric perspective, "
    "rich environmental detail, no visible faces or named characters"
)


# ────────────────────────── OpenAI gpt-image-2 ──────────────────────────────
# Released 2026-04-21. Replaces gpt-image-1 / DALL-E 3.
# 1K / 2K / 4K output, accepts reference images, multilingual text rendering.
def gen_openai(prompt: str, *, size: str = "1024x1024", quality: str = "medium") -> bytes:
    """Call OpenAI gpt-image-2. Returns raw PNG bytes."""
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("OPENAI_API_KEY not set")
    body = json.dumps({
        "model": "gpt-image-2",
        "prompt": prompt,
        "size": size,
        "quality": quality,
        "n": 1,
    }).encode("utf-8")
    req = Request(
        "https://api.openai.com/v1/images/generations",
        data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(req, timeout=300) as r:
        data = json.loads(r.read().decode("utf-8"))
    b64 = data["data"][0]["b64_json"]
    return base64.b64decode(b64)


# ────────────────────────── Gemini Imagen 3 ────────────────────────────────
def gen_gemini(prompt: str, *, aspect_ratio: str = "1:1") -> bytes:
    """Call Google Imagen 3. Returns raw PNG bytes."""
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY (or GOOGLE_API_KEY) not set")
    model = "imagen-3.0-generate-002"
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:predict?key={key}"
    )
    body = json.dumps({
        "instances": [{"prompt": prompt}],
        "parameters": {
            "sampleCount": 1,
            "aspectRatio": aspect_ratio,
            "personGeneration": "allow_adult",
        },
    }).encode("utf-8")
    req = Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(req, timeout=300) as r:
        data = json.loads(r.read().decode("utf-8"))
    b64 = data["predictions"][0]["bytesBase64Encoded"]
    return base64.b64decode(b64)


# ────────────────────────── dispatch + cache ───────────────────────────────
def generate(prompt: str, *, provider: str, aspect: str) -> bytes:
    if provider == "openai":
        size = {
            "1:1": "1024x1024",
            "16:9": "1536x1024",
            "9:16": "1024x1536",
            "4:3": "1280x960",
            "3:4": "960x1280",
        }.get(aspect, "1024x1024")
        return gen_openai(prompt, size=size, quality="high")
    if provider == "gemini":
        return gen_gemini(prompt, aspect_ratio=aspect)
    raise RuntimeError(f"unknown provider: {provider}")


def cache_key(prompt: str, provider: str, aspect: str) -> Path:
    h = hashlib.sha1(f"{provider}|{aspect}|{prompt}".encode("utf-8")).hexdigest()[:16]
    return CACHE_DIR / f"{h}.png"


def get_image(prompt: str, *, provider: str, aspect: str, force: bool) -> bytes:
    ck = cache_key(prompt, provider, aspect)
    if ck.exists() and not force:
        return ck.read_bytes()
    print(f"  > generating ({provider}, {aspect})...", flush=True)
    t0 = time.time()
    img = generate(prompt, provider=provider, aspect=aspect)
    dt = time.time() - t0
    print(f"  > done in {dt:.1f}s ({len(img) // 1024} KB)", flush=True)
    ck.write_bytes(img)
    return img


# ────────────────────────── prompt builders ────────────────────────────────
def portrait_prompt(character: dict, style: str) -> str:
    return (
        f"Character portrait. {character['description']} "
        f"Style: {style}. {PORTRAIT_STYLE}."
    )


def scene_prompt(scene: dict, style: str) -> str:
    mood = scene.get("mood", "")
    return (
        f"Scene: {scene['title']}. {mood}. "
        f"Style: {style}. {SCENE_STYLE}."
    )


def moment_prompt(moment: dict, characters_bible: dict, style: str) -> str:
    """Build a moment prompt. If the moment has a `characters` list, prepend
    each character's bible description so the API generates consistent
    likenesses across the chapter."""
    base = moment.get("prompt") or moment["title"]
    char_ids = moment.get("characters") or []
    char_lines = []
    for cid in char_ids:
        c = characters_bible.get(cid)
        if not c:
            continue
        char_lines.append(f"{c.get('short', c.get('name', cid))}: {c['description']}")
    cast = ""
    if char_lines:
        cast = "Characters in this scene (use these exact descriptions for visual consistency across images): " + " || ".join(char_lines) + ". "
    return f"{cast}{base}. Style: {style}. No text, no captions, no signature."


# ────────────────────────── main ───────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data_file", help="path to chapter JSON (e.g. scenes/chapter002.json)")
    ap.add_argument("--provider", choices=["openai", "gemini", "auto"], default="auto")
    ap.add_argument("--force", action="store_true", help="ignore cache, regenerate everything")
    ap.add_argument("--style", default=DEFAULT_STYLE, help="style guide appended to every prompt")
    ap.add_argument("--only", choices=["characters", "scenes", "moments", "all"], default="all")
    args = ap.parse_args()

    data_path = (ROOT / args.data_file).resolve()
    if not data_path.exists():
        sys.exit(f"no such file: {data_path}")

    if args.provider == "auto":
        if os.environ.get("OPENAI_API_KEY"):
            provider = "openai"
        elif os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"):
            provider = "gemini"
        else:
            sys.exit("Set OPENAI_API_KEY or GEMINI_API_KEY in env, or pass --provider.")
    else:
        provider = args.provider

    print(f"provider: {provider}")
    print(f"data: {data_path}")
    print(f"style: {args.style}")

    data = json.loads(data_path.read_text())
    out_chars_dir = ROOT / "scenes" / "characters"
    out_scenes_dir = ROOT / "scenes" / "backgrounds"
    out_moments_dir = ROOT / "scenes" / "moments"
    out_chars_dir.mkdir(parents=True, exist_ok=True)
    out_scenes_dir.mkdir(parents=True, exist_ok=True)
    out_moments_dir.mkdir(parents=True, exist_ok=True)

    # Build a flat task list. Each task: (kind, id, obj, prompt, aspect, out_path, json_field).
    tasks = []
    if args.only in ("characters", "all"):
        for cid, character in data.get("characters", {}).items():
            tasks.append(("character", cid, character,
                          portrait_prompt(character, args.style),
                          "1:1", out_chars_dir / f"{cid}.png", "portrait",
                          f"scenes/characters/{cid}.png"))
    if args.only in ("scenes", "all"):
        for scene in data.get("scenes", []):
            tasks.append(("scene", scene["id"], scene,
                          scene_prompt(scene, args.style),
                          "16:9", out_scenes_dir / f"{scene['id']}.png", "background",
                          f"scenes/backgrounds/{scene['id']}.png"))
    if args.only in ("moments", "all"):
        for moment in data.get("keyMoments", []):
            tasks.append(("moment", moment["id"], moment,
                          moment_prompt(moment, data.get("characters", {}), args.style),
                          "4:3", out_moments_dir / f"{moment['id']}.png", "image",
                          f"scenes/moments/{moment['id']}.png"))

    print(f"\nQueueing {len(tasks)} image generations in parallel...\n")

    # Run them in parallel. Each task fetches/regenerates its image independently;
    # the JSON is updated incrementally as completions arrive so the reader's
    # live-refresh polling picks up images as soon as each one finishes.
    json_lock_count = [0]
    def commit_json():
        # Write atomically — concurrent jobs across chapters write different
        # files, so no inter-process contention.
        tmp = data_path.with_suffix(data_path.suffix + ".tmp")
        tmp.write_text(json.dumps(data, indent=2))
        tmp.replace(data_path)

    def run_task(t):
        kind, mid, obj, prompt, aspect, out_path, field, rel_path = t
        try:
            img = get_image(prompt, provider=provider, aspect=aspect, force=args.force)
        except Exception as e:
            return (kind, mid, e, None)
        out_path.write_bytes(img)
        return (kind, mid, None, (obj, field, rel_path, out_path))

    completed = 0
    failed = 0
    max_workers = int(os.environ.get("STORYTELLER_MAX_WORKERS", "8"))
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = {ex.submit(run_task, t): t for t in tasks}
        for fut in as_completed(futures):
            t = futures[fut]
            kind, mid, err, result = fut.result()
            if err:
                print(f"  ! [{kind}] {mid}: {err}")
                failed += 1
                continue
            obj, field, rel_path, out_path = result
            obj[field] = rel_path
            commit_json()
            completed += 1
            print(f"  > [{kind}] {mid} → {out_path.name}  ({completed}/{len(tasks)})")

    commit_json()
    print(f"\ndone: {completed} succeeded, {failed} failed.  updated {data_path}")


if __name__ == "__main__":
    try:
        main()
    except (HTTPError, URLError) as e:
        sys.exit(f"network/API error: {e}")
    except KeyboardInterrupt:
        sys.exit("\ninterrupted")
