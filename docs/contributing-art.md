# Sourcing Public-Domain Art for Packs

Public-domain packs are the most valuable to the Storyplay ecosystem — anyone can fork, remix, and redistribute them without legal worry. This is a quick reference for where to find the good stuff.

## Reliable public-domain sources

| Source | What's there | Good for |
|---|---|---|
| **Wikimedia Commons** ([commons.wikimedia.org](https://commons.wikimedia.org)) | Tagged-PD paintings, period photographs, engravings | Backgrounds, portraits, key moments |
| **Internet Archive — Book Images** ([archive.org/details/bookimages](https://archive.org/details/bookimages)) | Millions of scanned illustrations from PD books | Plates and engravings for any pre-1929 book |
| **NYPL Digital Collections** ([digitalcollections.nypl.org](https://digitalcollections.nypl.org)) | Curated, high-res scans, public-domain flag | Period photographs, manuscript pages, atmospheric stuff |
| **Met Open Access** ([metmuseum.org/art/collection](https://metmuseum.org/art/collection)) | 400k+ CC0 artworks | Paintings, sculpture, decorative |
| **Smithsonian Open Access** ([si.edu/openaccess](https://si.edu/openaccess)) | 4M+ CC0 items | Wide-ranging |
| **Public Domain Review** ([publicdomainreview.org](https://publicdomainreview.org)) | Curated themed collections | Inspiration, thematic browsing |
| **Project Gutenberg** ([gutenberg.org](https://gutenberg.org)) | Illustrated editions with embedded plates | Specifically-themed art for that book |
| **LibriVox** ([librivox.org](https://librivox.org)) | Audiobook recordings, public domain | The audio half of any demo book |

## What counts as public domain?

- Anything published in the US **before 1929** (the rolling cutoff advances by one year annually).
- Anything explicitly placed under **CC0** by its creator or institution.
- US federal government works.
- Works whose copyright was never renewed (common pre-1964 US publications).

When in doubt, **check the source's stated license** — Wikimedia Commons, NYPL, the Met, and Smithsonian all flag PD/CC0 clearly. If a source doesn't say "public domain" or "CC0", treat it as copyrighted.

## What does NOT count as public domain

- **AI-generated images** are an open legal question and a community sore spot; don't redistribute them in a pack you're labelling "public domain". (Personal/private packs are fine.)
- **Photographs of 3D PD artworks** (sculptures, buildings) may have a separate photo copyright in some jurisdictions.
- **"Found on Google Images"** — Google doesn't filter for PD reliably.
- **CC-BY images** are open but aren't PD; they need attribution and can't go in a CC0 pack.

## Per-book recipes

### 19th-century gothic (Dracula, Frankenstein, Jekyll & Hyde)

- **Backgrounds**: 19th-century Romantic landscape painting (Caspar David Friedrich, J.M.W. Turner — both 100% PD). Search Wikimedia for "Romantic landscape painting".
- **Atmospheric**: stills from German Expressionist films pre-1929 (*Nosferatu* 1922, *The Cabinet of Dr. Caligari* 1920) — public domain in the US and most jurisdictions.
- **Character portraits**: Victorian-era painted portraits, photographs from the 1880s-1900s (NYPL, Library of Congress).
- **Engravings**: Gustave Doré (1832-1883) for anything biblical / Dante-esque. Theodor von Holst for the 1831 *Frankenstein* frontispiece.

### Sherlock Holmes (Conan Doyle)

- **Sidney Paget's original *Strand Magazine* illustrations** (1891-1908) are the canonical visual reference and 100% PD. They illustrate the actual scenes Doyle wrote. Internet Archive has scans of the original issues. This is the easiest pack to make.

### Victorian / Edwardian English literature

- **Wikimedia Commons → Period photograph categories** by decade.
- **British Library Flickr** (over 1M scans from 17th-19th century books, all PD).

### Ancient/mythological (Greek myths, Norse, etc.)

- Pre-1929 academic illustration plates (W. Crane, A. Rackham → all PD).
- Met / Smithsonian → ancient sculpture, vase paintings.

## Attribution

PD doesn't require attribution, but it's good practice. Keep a `assets-sources.md` in your pack listing per-image: filename, source URL, original creator (if known), original date. This makes the pack auditable and survives the inevitable "wait, where did this come from again?".

## Image sizing

- **Characters**: 600-900 px on the long side. Anything more is wasted bandwidth.
- **Backgrounds**: 1600-2000 px wide is plenty. Reader displays them at viewport size.
- **Key moments**: 1200-1600 px wide.
- Use **JPEG** for photographs and paintings; **PNG** for engravings and high-contrast line art.
- Consider running images through **`mozjpeg`** or **`squoosh`** — a high-res pack can easily blow past 100 MB if you don't compress.
