# Storyplay Pack Format

A **pack** is the visual layer that sits on top of a book: backgrounds for scenes, portraits for characters, illustrations for key moments, and the mapping that says which fragment of audio each one belongs to. Books are the alignment data (text + audio + timing); packs are the look.

Same book, different pack = same audio, different visuals. The reader URL is `reader.html?book=<book>&pack=<pack>`.

## On disk

```
packs/<slug>/
├── pack.json                    — metadata (this file is required)
├── characters/                  — portrait images
│   ├── alice.png
│   └── …
├── backgrounds/                 — scene background images
│   ├── cottage.jpg
│   └── …
├── moments/                     — key-moment illustration images
│   ├── first-encounter.jpg
│   └── …
├── <chapterId>.json             — per-chapter scene/speaker/moment map (one per chapter)
└── assets-sources.md            — optional: per-image attribution + source URLs (recommended for public-domain packs)
```

All asset paths inside the per-chapter JSON files are **relative to the pack directory**. So if your pack JSON refers to `characters/alice.png`, the file lives at `packs/<slug>/characters/alice.png`. Absolute URLs (`https://…`) and root-relative paths (`/…`) are passed through unchanged.

## pack.json

```jsonc
{
  "slug": "dracula-public-domain",
  "name": "Dracula — Public Domain Visuals",
  "targetBook": "dracula",            // slug of the book in books/<slug>/
  "author": "favstats",
  "version": "1.0.0",
  "license": "CC0 / Public Domain — see assets-sources.md for per-image attribution.",
  "art": {
    "source": "public-domain",        // "public-domain" | "ai-generated" | "original" | "mixed"
    "notes": "Nosferatu (1922) film stills + 19th-century engravings."
  },
  "chapters": ["chapter001", "chapter002", "…"],   // which chapter ids have data
  "description": "Atmospheric vintage cinema pack using Murnau-era film stills."
}
```

The reader only requires `slug` and `targetBook`. Everything else is metadata for the library page.

## Per-chapter JSON

Each chapter that has visual data gets a file named after its chapter id (e.g. `chapter002.json`). The reader fetches `packs/<pack>/<chapterId>.json` when the chapter loads, and re-fetches every 6 seconds in case the file is being edited live.

```jsonc
{
  "chapterId": "chapter002",
  "characters": {
    "harker":     { "name": "Jonathan Harker",  "portrait": "characters/harker.png" },
    "innkeeper":  { "name": "The Innkeeper",    "portrait": "characters/innkeeper.png" }
  },
  "scenes": [
    {
      "id":            "carriage-ride",
      "background":    "backgrounds/carpathian-pass.jpg",
      "characters":    [
        { "id": "harker", "side": "right" }
      ],
      "startFragId":   "chapter002-s003",
      "endFragId":     "chapter002-s089"
    }
  ],
  "keyMoments": [
    {
      "id":            "first-howl",
      "image":         "moments/wolves-howling.jpg",
      "title":         "The wolves of the Borgo Pass",
      "anchorFragId":  "chapter002-s042",
      "durationFrags": 5,
      "inline":        true
    }
  ],
  "speakers": [
    { "fragId": "chapter002-s015", "id": "innkeeper" },
    { "fragId": "chapter002-s022", "id": "harker" }
  ]
}
```

### Fields

| Field                            | Type         | Notes |
|----------------------------------|--------------|-------|
| `chapterId`                      | string       | Must match a chapter `id` from the book's `manifest.json`. |
| `characters`                     | object map   | Keyed by your character id. Each value is `{ name, portrait, flip? }`. |
| `scenes[].id`                    | string       | Unique within the chapter. |
| `scenes[].background`            | path         | Resolved against the pack root. |
| `scenes[].characters`            | array        | `{ id, side: "left" | "right" }` — which character portraits to show during this scene. |
| `scenes[].startFragId`           | string       | Fragment id where the scene begins (must exist in the book's media-overlay SMIL). |
| `scenes[].endFragId`             | string       | Fragment id where the scene ends. |
| `keyMoments[].id`                | string       | Unique within the chapter. |
| `keyMoments[].image`             | path         | Resolved against the pack root. |
| `keyMoments[].title`             | string       | Caption shown on the moment card. |
| `keyMoments[].anchorFragId`      | string       | Fragment id where the moment surfaces. |
| `keyMoments[].durationFrags`     | int          | How many fragments to keep it visible. Defaults to 4. |
| `keyMoments[].inline`            | bool         | If true, render as an inline figure in the text flow. |
| `speakers[].fragId`              | string       | When this fragment is spoken, that character is highlighted. |
| `speakers[].id`                  | string       | Character id from `characters` map. |

## Validation

The reader is forgiving — missing or unresolvable fields just cause that visual layer to render nothing. Fragment ids that don't match the book's SMIL are silently skipped. This makes packs safe to ship incomplete.

## Distribution

A pack is just a directory. Zipping `packs/<slug>/` produces a `.spk` file you can share. Drop a `.spk` into a Storyplay install's `packs/` folder (or use `tools/pack-install.py`) and it appears in the library next time you reload.

## Licensing your pack

You're free to license your pack however you want — your art, your call. Two suggestions:

- **Public-domain or CC0 packs** are the most valuable to the ecosystem because anyone can fork and remix them.
- **Personal AI-generated packs** should usually stay private (don't redistribute model output of a copyrighted book's scenes).

The Storyplay code itself is MIT.
