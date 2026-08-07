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
