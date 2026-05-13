# Dracula — Public Domain Pack Asset Sources

All images sourced from public-domain works. Verify each URL before fetching; institutions occasionally move or relabel items.

## Characters

| Character | Source | URL / Notes |
|---|---|---|
| **Jonathan Harker** | Generic Victorian gentleman portrait, c.1890. | Wikimedia Commons → "Victorian portrait photography 1890s" |
| **Mina Murray Harker** | Victorian woman portrait, c.1890s. | NYPL Digital Collections → portrait photography |
| **Lucy Westenra** | Lillian Gish in *Broken Blossoms* (1919, PD US). | Wikimedia Commons → "Lillian Gish 1919" |
| **Count Dracula** | Max Schreck as Count Orlok in *Nosferatu* (1922). | Wikimedia Commons → "Nosferatu (1922) film stills" |
| **Abraham Van Helsing** | Sigmund Freud portrait c.1905 (no, kidding — use generic professor portrait). | Library of Congress portraits c.1890 |
| **Dr. John Seward** | Generic Victorian doctor photograph. | Wikimedia |
| **Renfield** | *Nosferatu* (1922) Knock character stills. | Wikimedia Commons |
| **Arthur Holmwood** | Edwardian aristocrat portrait. | NYPL or Wikimedia |
| **Quincey Morris** | Late-19th-century American frontier portrait. | Library of Congress → cowboy / frontier photography |
| **Mrs. Westenra** | Victorian matriarch portrait. | NYPL |

## Backgrounds

| Scene | Source | URL / Notes |
|---|---|---|
| **Carpathian mountains** | Caspar David Friedrich *Wanderer above the Sea of Fog* (1818). | Wikimedia Commons. |
| **Borgo Pass at dusk** | *Nosferatu* exterior stills. | Wikimedia. |
| **Dracula's castle** | *Nosferatu* castle exterior. | Wikimedia. |
| **Dracula's castle interior** | *Nosferatu* interior stills. | Wikimedia. |
| **London streets** | London street photography c.1900 (LOC). | loc.gov/photos |
| **Whitby harbour** | Victorian Whitby photographs. | NYPL or Frances Frith Collection (public domain ones). |
| **Whitby Abbey at storm** | Period engravings of Whitby Abbey. | Internet Archive book scans. |
| **Carfax Abbey** | Generic ruined English abbey engraving. | Internet Archive. |
| **Demeter shipwreck** | *Nosferatu* shipboard scenes. | Wikimedia. |
| **Lucy's bedroom** | Victorian interior photography. | NYPL. |
| **Seward's asylum** | Period Bethlem Royal Hospital photographs. | Wellcome Collection (CC0). |
| **Transylvanian inn** | Romantic painting of rural Eastern Europe. | Wikimedia. |

## Key moments

| Moment | Source | URL / Notes |
|---|---|---|
| **First sight of the castle** | *Nosferatu* castle reveal still. | Wikimedia. |
| **The three brides** | *Nosferatu* (1922) cross stills or 19th-century allegorical paintings of seduction/death. | Wikimedia. |
| **Demeter arrival at Whitby** | Engraving of stormy ship at port. | Internet Archive. |
| **Lucy in the cemetery** | Gustave Doré *Death and the Maiden* style engraving. | Wikimedia → "Doré illustrations". |
| **Van Helsing's first appearance** | Period stage photograph. | NYPL. |
| **Mina's vision** | Symbolist painting (Odilon Redon, Fernand Khnopff — both PD). | Wikimedia. |
| **Dracula in London** | *Nosferatu* climax stills. | Wikimedia. |
| **The chase to Castle Dracula** | Romantic painting of horseback chase through forest. | Wikimedia. |
| **Final stake** | *Nosferatu* climactic dawn scene. | Wikimedia. |

## To do

- [ ] Fetch all images via `tools/fetch-pack-assets.py` (writes to characters/, backgrounds/, moments/)
- [ ] Run Storyteller alignment against the LibriVox Dracula recording
- [ ] Build manifest with `python3 build.py dracula`
- [ ] Write per-chapter JSON files (Dracula has 27 chapters)
- [ ] Verify each image fetch produced an actual image (some sources return HTML 404 pages)
