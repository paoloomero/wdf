# WDF extension: `fonts` (version 0.1)

Status: extension specification (outside WDF Core, per core spec §10).
Producers MAY use it; conforming consumers MAY ignore it entirely (§10.3).

## Purpose

The core profile forbids `@font-face` in `content/styles.css` (§6.7.2), so
imported documents keep their typographic identity through font _stacks_
with system fallbacks. The `fonts` extension embeds **open, freely
licensed** font files in the package so the document renders with the same
face everywhere — while staying fully valid for consumers that ignore the
extension, which simply fall back to the stacks.

The first application is metric-compatible substitution (the LibreOffice
table): a document set in Calibri embeds **Carlito**, declared under its
own name and _prepended_ to the stack —
`font-family: "Carlito", "Calibri", sans-serif`. No proprietary font is
ever embedded and no trademarked family name is claimed by an embedded
face.

Substitution table (version 0.1, all clones licensed OFL-1.1):

| Referenced family     | Embedded clone |
| --------------------- | -------------- |
| Calibri               | Carlito        |
| Cambria               | Caladea        |
| Arial, Helvetica      | Arimo          |
| Times New Roman/Times | Tinos          |
| Courier New, Courier  | Cousine        |

## Manifest declaration

```json
"extensions": [{ "name": "fonts", "version": "0.1" }]
```

## Files

- `ext/fonts/fonts.css` — REQUIRED. Only `@font-face` rules; every `src`
  is a package-local path under `ext/fonts/` (`format("woff2")`).
- `ext/fonts/fonts.json` — REQUIRED. Metadata (below).
- `ext/fonts/<family>-latin-<weight>-<style>.woff2` — the font files.
  Version 0.1 ships the latin subset at weights 400/700, normal/italic.
  Per-document glyph subsetting is a planned refinement.

All files are covered by the package integrity hashes (§10.2).

## `fonts.json`

```json
{
  "fonts": "0.1",
  "css": "ext/fonts/fonts.css",
  "faces": [
    {
      "family": "Carlito",
      "substitutesFor": "Calibri",
      "weight": 400,
      "style": "normal",
      "path": "ext/fonts/carlito-latin-400-normal.woff2",
      "license": "OFL-1.1"
    }
  ]
}
```

Faces are sorted by family, then weight, then style (normal before
italic); serialization is canonical JSON with two-space indent and a
trailing newline.

## Consumer guidance (viewers)

A viewer supporting the extension applies `fonts.css` inside the same
sandbox it renders the document in, resolving the `src` paths from the
package (e.g. as `data:` URIs) — no network requests, ever. A viewer that
does not support it changes nothing: the stacks in `content/styles.css`
degrade exactly as without the extension.

## Licensing

Embedded fonts MUST be redistributable (open licenses such as OFL or
Apache-2.0). The `license` field records the license per face; the WDF
tooling repository carries the full license texts of every font it can
embed.
