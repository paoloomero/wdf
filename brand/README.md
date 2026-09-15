# WDF brand assets

Vector sources in `svg/` — everything else is generated from them.

- `svg/wdf-document.svg` — the `.wdf` file type
- `svg/wdf-reader.svg` — the WDF Reader app tile (radius 14 on a 64 artboard)
- `svg/wdf-reader-macos.svg` — same tile with the margins macOS requires (824 on 1024)
- `svg/wdf-favicon.svg` — compact mark for the site

`icns/` for macOS (ready for the future native reader), `ico/` for Windows.
The PWA icons in `site/icons/` are rasterized from these sources with
`node scripts/gen-icons.mjs` (headless Chrome, no image dependencies).

Colors: ink `#101418`, paper `#FFFFFF`. Nothing else.

Designed August 2026 (Paolo Omero with Claude Design).

## Illustrations (`illustrations/`)

Feature illustrations for wdf.dev, in the site's illustrative identity
(ratified 9 Sep 2026): hand-drawn continuous line, a baseline thread under
every subject, exactly one element in signal yellow (#F5C24A) — the thing
WDF adds. Generated from the prompts in
`project-docs/WDF - Sito - Prompt icone caratteristiche (9 set 2026).md`;
`reference-handdrawn-set.png` is the first full set, kept as the style
reference. PNG 1254×1254 for now — to be vectorised (single stroke width)
before shipping. Below 48 px use the marks in `svg/`, not these.

Files: one-file, ai-mcp, responsive, capture, pdf-view, source-download,
verified, citations, typed-data, offline, accessible, open. Still to
generate: reader-app, standalone-html, from-word (prompts 13–15).
