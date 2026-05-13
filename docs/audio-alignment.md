# Audio Alignment

By default the demo books play as text + curated art (no audio). To upgrade any book to **word-by-word audio sync** — narration drives the text highlight, sentence position drives scene changes — you run it through [Storyteller](https://gitlab.com/smoores/storyteller) once.

Time budget per book: **2-8 hours of wall time** depending on book length and your CPU. The compute work is Whisper transcribing the entire audiobook plus a DTW alignment pass against the EPUB. You don't have to babysit it — kick it off, let it run, come back.

## Prerequisites

- **Docker Desktop** ([install](https://www.docker.com/products/docker-desktop/)). Storyteller is a Docker stack.
- **Disk space**: ~5 GB free per book (audio + transcript artifacts).
- **The EPUB and audio for the book.** For the three Storyplay demos, both are already wired up (see below).

## The three demo books

Each demo book has a Project Gutenberg EPUB (text — already fetched by `setup-demos.py`) and a LibriVox recording (audio — fetched on demand). The fetch tool knows the LibriVox IDs:

| Book               | Gutenberg | LibriVox | Approx. audio length |
|--------------------|----------:|---------:|---------------------:|
| Dracula            |       345 |      271 |              ~21 hrs |
| Frankenstein       |        84 |     2030 |               ~8 hrs |
| Sherlock Holmes    |      1661 |      314 |              ~14 hrs |

## Step 1 — Fetch the LibriVox audio

```bash
cd ~/storyplay
python3 tools/fetch-librivox.py dracula
python3 tools/fetch-librivox.py frankenstein
python3 tools/fetch-librivox.py sherlock-bohemia
```

Each command downloads the LibriVox zip (a few hundred MB), unpacks it into `books/<slug>/audio/`, and prints the resulting MP3 file list. The download alone takes 5-30 minutes per book on a typical home connection.

The audio is **not** committed to the Storyplay repo (`.gitignore` excludes `books/*/audio/`) — it stays local on your machine.

## Step 2 — Install and start Storyteller

```bash
git clone https://gitlab.com/smoores/storyteller ~/storyteller
cd ~/storyteller
docker compose up -d
```

Wait ~30 seconds for the stack to come up. Open http://localhost:8001 in your browser.

First-time setup: create an admin account when prompted (local-only, doesn't go anywhere).

## Step 3 — Align one book in Storyteller

In the Storyteller UI:

1. Click **"Add book"** → upload the EPUB at `~/storyplay/books/<slug>/content/`.
   - The Gutenberg EPUB lives unpacked under `content/`. Storyteller wants a `.epub` file, so first re-zip it:
     ```bash
     cd ~/storyplay/books/<slug>/content
     zip -r ../source.epub .
     ```
     Then upload `books/<slug>/source.epub`.
2. **Upload audio** → drag all the MP3s from `~/storyplay/books/<slug>/audio/`. Storyteller will concatenate them internally.
3. Hit **"Process"**. Whisper begins transcribing.
4. **Watch the progress bar.** Expect 1-3× realtime depending on your CPU. Frankenstein (~8 hrs of audio) might take 8-24 hours. Dracula (~21 hrs) might take a full day-plus. Storyteller resumes if interrupted.
5. When done, click **"Export"** to download the aligned EPUB. It'll be named something like `dracula-aligned.epub`.

## Step 4 — Slot the aligned EPUB back into Storyplay

```bash
cd ~/storyplay/books/<slug>
rm -rf content
mkdir content
cd content
unzip ../dracula-aligned.epub
cd ../../..
python3 build.py <slug>
python3 tools/build-library.py
```

Reload the library — that book is now flagged as having audio. Open the reader and word-by-word sync just works. Your existing pack (Paget, Friedrich, Nosferatu, whatever) drops onto the audio timeline because the per-chapter JSONs reference fragment ids that came out of Storyteller.

## Step 5 (optional) — Author per-chapter visuals

Once you have aligned audio for a book, you have **fragment ids** (`chapter001-s007`, etc.) that the visual system can hang off. That's when you write per-chapter pack JSONs that change the background mid-chapter, swap characters on dialogue, surface key moments at specific sentences. See [creating-a-pack.md](creating-a-pack.md).

You can find fragment ids by opening the aligned chapter XHTML and grepping for `id="…"`:

```bash
grep -oE 'id="[a-z0-9]+-s[0-9]+"' books/<slug>/content/chapter001.xhtml | head
```

## Tips and gotchas

- **Match the edition.** LibriVox often has multiple recordings per title (1818 vs 1831 Frankenstein, different abridgements). The IDs in `tools/fetch-librivox.py` were chosen to match the Gutenberg editions in `book.json`. If you swap one out, the alignment will silently misalign at the divergent passages.
- **Storyteller is opinionated about audio order.** Its current heuristic relies on filename sort order matching reading order. LibriVox MP3s usually start `dracula_01_stoker_64kb.mp3`, `dracula_02_…`, which sort correctly.
- **CPU vs GPU.** Storyteller uses `whisper.cpp` (CPU). On Apple Silicon it's fast enough. On older Intel Macs or modest Linux boxes, budget 2-3× longer.
- **Resume.** Docker container restarts won't lose progress — Storyteller writes intermediate transcripts to a volume.
- **Multiple recordings.** If the default LibriVox ID's narrator doesn't suit you, find another recording on librivox.org and pass its ID as the second argument to `fetch-librivox.py`.
- **Bring your own book.** Anything goes — your own audiobook + EPUB pair. Storyteller takes any EPUB + any audiobook (m4b, mp3, aac). The Storyplay side is identical from Step 4 onward.

## Why this is two steps, not one

In principle Storyplay could automate Storyteller via its REST API and skip the browser UI. We don't, for one reason: **Storyteller's process is the slow, expensive part**. If you have to wait 12 hours regardless, you might as well kick it off with a visible progress bar and full UI controls (cancel, redo a single chapter, swap recordings) rather than through a CLI tool you'll forget about.

If you want full automation anyway, Storyteller's API docs are at https://gitlab.com/smoores/storyteller — a wrapper script could go in `tools/`. PRs welcome.
