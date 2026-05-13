# Sherlock Holmes (A Scandal in Bohemia) — Paget Pack Asset Sources

Sidney Paget (1860–1908) illustrated 38 Sherlock Holmes stories for *The Strand Magazine* between 1891 and 1908. All his illustrations are in the public domain (creator died 1908; works published before 1929).

## Best source

**Internet Archive** has full scans of *The Strand Magazine* from 1891 onwards. *A Scandal in Bohemia* appeared in the **July 1891** issue (Volume 2, No. 7), pages 61–75, with **6 Paget illustrations**.

URL: https://archive.org/details/StrandMagazine1891-2

The Paget illustrations from this specific issue are:

1. **"He gave a most prodigious yawn"** — Holmes lounging in his chair, opening scene
2. **"It was a quarter past six when we left Baker Street"** — Holmes and Watson in cab/street
3. **"Three gentlemen of Pall Mall"** — disguised Holmes encountering club members (street scene)
4. **"I gave a cry of dismay"** — Watson reacts in the church / Adler / Norton wedding scene
5. **"He tore the mask from his face"** — the King of Bohemia unmasking
6. **"A slim youth in an Ulster"** — Irene Adler's farewell appearance

Plus Paget's general portraits:

- **Sherlock Holmes** — the canonical hawk-profile drawing
- **Dr. John Watson** — moustached, professional military bearing
- **Mrs. Hudson** — appears in later stories

## Character mapping for this pack

| Character | Paget illustration | Notes |
|---|---|---|
| **Sherlock Holmes** | Crop from "He gave a most prodigious yawn" | Canonical face shot |
| **Dr. John Watson** | Crop from any Watson appearance | Reliable face |
| **King of Bohemia (Wilhelm)** | Crop from "He tore the mask from his face" | Iconic |
| **Irene Adler** | "A slim youth in an Ulster" + any Strand portrait of her from later editions | Both scenes |
| **Godfrey Norton** | Hard to find — substitute generic Paget gentleman | Or omit and let speaker default to scene |
| **Coachman** | Crop from "three gentlemen" street scene | Background figure |

## Background mapping

| Scene | Source | Notes |
|---|---|---|
| **221B Baker Street** | Paget's standard Baker Street interior (from "A Case of Identity" and others) | Multiple options |
| **Briony Lodge exterior** | "Three gentlemen of Pall Mall" street scene | |
| **St. Monica's Church** | "I gave a cry of dismay" — Paget drew the wedding scene | |
| **London street** | Any Paget street scene | |
| **Foggy London** | Paget's smoke-scrape scenes from later stories | |

## Key moments

| Moment | Paget illustration |
|---|---|
| **Holmes' opening monologue / "You see but you do not observe"** | Yawn illustration |
| **The King's letter arrives** | The unmasking scene |
| **Holmes in disguise** | "Three gentlemen of Pall Mall" — clergyman disguise |
| **The smoke trick at Briony Lodge** | Original Paget? Or one of the dramatic scenes |
| **Adler's note discovered** | A note-reading Holmes Paget illustration (multiple in catalogue) |

## To do

- [ ] Download The Strand Vol. 2 (1891) from Internet Archive
- [ ] Extract Paget illustrations as individual images (PDF → page extraction → image crop)
- [ ] Storyteller-align LibriVox recording (~45 min — very short story, fast alignment)
- [ ] `python3 build.py sherlock-bohemia`
- [ ] Write per-chapter JSON (single chapter, since this is one short story)
