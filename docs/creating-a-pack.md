# Creating a Pack

A pack is the visual layer for a book. It's just a folder of images plus a few JSON files. No build step, no compiler — drop it into `packs/`, refresh the library, and it shows up.

This guide walks through building a pack from scratch.

## 0. Prerequisites

You need a Storyplay-aligned book in `books/<book-slug>/` with a generated `manifest.json`. The manifest tells you which chapters exist and what their fragment ids look like — you'll need both.

```bash
ls books/<book-slug>/manifest.json
```

If the manifest doesn't exist, the book hasn't been aligned yet. See the main README for Storyteller setup.

## 1. Pick a name and create the directory

```bash
mkdir -p packs/<pack-slug>/{characters,backgrounds,moments}
```

Convention: `<book-slug>-<pack-name>`, e.g. `dracula-paget`, `dracula-public-domain`, `dracula-ai`. The slug doubles as the URL parameter (`?pack=<slug>`).

## 2. Write pack.json

```json
{
  "slug":        "<pack-slug>",
  "name":        "Human-friendly name",
  "targetBook":  "<book-slug>",
  "author":      "you",
  "version":     "0.1.0",
  "license":     "CC0",
  "art":         { "source": "public-domain" },
  "description": "One-line description shown in the library."
}
```

## 3. Sketch the cast

Open the book's first chapter and figure out who speaks, who appears, and what scenes occur. For each character, find or create a portrait image and save it to `characters/`.

```
packs/<pack-slug>/characters/
├── harker.png
├── mina.png
└── dracula.png
```

Recommended size: square-ish, around 600–900 px on the long side. The reader displays them at clamp(140px, 17vh, 200px), so going much higher is wasted bytes.

## 4. Find fragment ids

The reader uses **fragment ids** (e.g. `chapter002-s042`) to sync your visuals to specific sentences. These come from the book's media-overlay SMIL files. Easiest way to find them: open the book in the reader, turn on dev tools, watch the highlighted `<span class="s" id="…">` ticking through the text.

A cleaner approach is to grep the chapter's xhtml:

```bash
grep -oE 'id="[a-z0-9]+-s[0-9]+"' books/<book>/content/chapter002.xhtml | head
```

## 5. Write the chapter JSON

Create `packs/<pack-slug>/chapter002.json` with one or more scenes, optional key moments, and speaker mappings. See **[pack-format.md](pack-format.md)** for the schema.

The minimum useful chapter JSON is just a single scene:

```json
{
  "chapterId": "chapter002",
  "characters": {
    "harker": { "name": "Jonathan Harker", "portrait": "characters/harker.png" }
  },
  "scenes": [
    {
      "id": "main",
      "background": "backgrounds/carpathian-pass.jpg",
      "characters": [{ "id": "harker", "side": "right" }],
      "startFragId": "chapter002-s001",
      "endFragId":   "chapter002-s200"
    }
  ]
}
```

That covers the whole chapter with one background + Harker on the right. Add more scenes, speakers, and key moments as you flesh it out.

## 6. Live-edit while reading

Open `reader.html?book=<book>&pack=<pack>` and navigate to the chapter. The reader re-fetches chapter JSON every 6 seconds, so you can edit, save, and watch the visuals update without reloading. (Image paths that change also trigger refresh.)

## 7. Ship it

Bundle the pack into a `.spk` archive:

```bash
python3 tools/pack-zip.py <pack-slug>
```

That writes `dist/<pack-slug>.spk` — a zip file you can hand out. Recipients drop it into their `packs/` folder, or run `python3 tools/pack-install.py <file.spk>`.

## Tips

- **Public-domain art ships better than AI.** Wikimedia Commons, Internet Archive, NYPL Digital Collections, Public Domain Review. Distinctive visual identity, zero legal ambiguity, smaller downloads. See [contributing-art.md](contributing-art.md) for sourcing guidance.
- **Coarse before fine.** Get one background per chapter working first; add speaker mappings only after you've enjoyed the basic flow.
- **Don't over-illustrate.** Key moments are best used sparingly — 2–4 per chapter. More than that and they stop feeling like punctuation.
- **A pack with 80% chapters covered is usable.** Missing chapters silently render no visuals; the reader doesn't break.
