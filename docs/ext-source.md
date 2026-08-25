# WDF extension: `source` (version 0.5)

Status: extension specification (outside WDF Core, per core spec §10).
Producers MAY use it; conforming consumers MAY ignore it entirely (§10.3).

## Purpose

A WDF package produced by conversion (e.g. `wdf import` of a word-processor
HTML export) contains the _canonical_ document — rewritten into the WDF-HTML
profile. The `source` extension embeds the **original input byte-for-byte**,
so that nothing is ever lost in conversion and the delta between original
and canonical is inspectable by anyone. All extension files are covered by
the package integrity hashes like any other file (§10.2).

## Manifest declaration

```json
"extensions": [{ "name": "source", "version": "0.5" }]
```

Each version is a strict superset of the previous one: a producer using
only the features of an earlier version MAY declare that earlier
version, and packages declaring earlier versions stay valid unchanged.

## Files

- `ext/source/source.json` — REQUIRED. Metadata and resource map (below).
- `ext/source/<hash>.<ext>` — REQUIRED. The original main file, stored
  unmodified in its **original encoding** (never re-encoded; for a
  binary original, the exact bytes). `<hash>` is the first 16 hex digits
  of the SHA-256 of the bytes; `<ext>` is `html` or `md` — or, for
  `"kind": "binary"` (0.4), the original file extension lowercased
  (e.g. `docx`), subject to the package path rules (§3.2). Original file
  names (which may contain characters §3.2 forbids in package paths)
  survive only as _values_ inside `source.json`.

Referenced images are **not duplicated**: the import pipeline already
copies them unmodified into `content/assets/` under content-hashed names;
`source.json` maps the original references onto those copies. A producer
using this extension keeps every loaded asset in the package, even assets
the canonical document does not reference.

**External stylesheets** (version 0.2): a web page's look lives in linked
CSS files; they are embedded byte-for-byte as `ext/source/<hash>.css` and
recorded in the `stylesheets` map, so a consumer can restore the original
appearance offline. Declared limits: `url()` and `@import` _inside_ the
CSS are not localized (site backgrounds and webfonts may be missing under
the no-network CSP). Version 0.1 consumers ignore the extra field.

**Kind of source** (version 0.3): not every original is a served file. A
browser-extension capture embeds a **serialization of the rendered DOM**
— what one browser displayed at one moment, not what the server sent.
The `kind` field declares which of the two the embedded main file is, so
consumers never present a DOM snapshot as the server's bytes. Absent
`kind` means `"fetched-html"` (the pre-0.3 behavior — older packages
stay valid unchanged, older consumers ignore the field).

**Binary originals** (version 0.4): not every original is text. A
package converted from a word-processor file (e.g. `wdf import` of a
`.docx`) embeds the original **as-is**: `"kind": "binary"` declares that
the main file is an opaque byte stream, `encoding` is omitted (there is
nothing to decode), and the OPTIONAL `mediaType` field records the IANA
media type when known. A consumer cannot render a binary original; see
the consumer guidance below.

**Author visual rendition** (version 0.5): a converted document can carry,
next to the source, a **visual rendition produced by the author** — today
a PDF saved from the original application (e.g. Word → Save as PDF). It is
the author's frozen page image of the same document: WDF tooling never
generates it and **never parses it** — a consumer may only display it or
offer it for download. The rendition is embedded byte-for-byte as
`ext/source/<hash>.pdf` (same hash-addressing as the main file) and
declared in the OPTIONAL `visual` field. It is allowed with any `kind`.
Fidelity is the author's responsibility: package integrity attests that
the bytes have not changed, not that the rendition matches the canonical
content (same honesty rule as the `capture` extension).

## `source.json`

```json
{
  "source": "0.3",
  "kind": "fetched-html",
  "main": "ext/source/8fda6be18a3c2f10.html",
  "mainName": "test doc accessibilit.html",
  "encoding": "windows-1252",
  "resources": {
    "test%20doc%20accessibilit.fld/image001.jpg": "content/assets/dba84c2ce51eb884.jpg"
  },
  "stylesheets": {
    "styles/site.css": "ext/source/1a2b3c4d5e6f7081.css"
  }
}
```

- `source` — extension version.
- `kind` — OPTIONAL (0.3). How the embedded original was obtained:
  `"fetched-html"` (a file obtained as bytes — downloaded, exported or
  provided; the default when absent), `"dom-snapshot"` (a
  serialization of the rendered DOM captured from a live page, e.g. by
  the browser extension; see docs/ext-capture.md) or `"binary"` (0.4 —
  an opaque, non-text original such as a `.docx`). Any other value is
  reserved.
- `main` — package path of the embedded original main file.
- `mainName` — the original file name (or URL, for `wdf import <url>`).
- `encoding` — the encoding detected at import time (WHATWG label);
  consumers use it to decode `main` for display. REQUIRED for text
  kinds; OMITTED for `"kind": "binary"`.
- `mediaType` — OPTIONAL (0.4, `"binary"` only). IANA media type of the
  original when known (e.g.
  `application/vnd.openxmlformats-officedocument.wordprocessingml.document`).
- `visual` — OPTIONAL (0.5). The author-supplied visual rendition:
  `{ "path": "ext/source/<hash>.pdf", "mediaType": "application/pdf",
"name": "<original file name>" }`. `path` MUST point to a file in the
  package; `mediaType` is currently always `application/pdf` (other types
  are reserved); `name` is the original file name (display only).
- `resources` — original `src` value (verbatim, URL-encoding included) →
  package path. Keys are sorted; serialization is canonical JSON with
  two-space indent and a trailing newline, so identical input produces
  identical bytes.
- `stylesheets` — OPTIONAL (0.2). Original stylesheet `href` (verbatim) →
  embedded `ext/source/*.css` path. Keys sorted, same canonical rules.

## Consumer guidance (viewers)

A viewer offering an "original" view MUST render the decoded main file in
the same sandbox it uses for canonical content (no scripts, no external
requests), resolving `resources` references from the package. It MUST NOT
inject its own styling: the point of the view is the untouched original.

For `"kind": "binary"` (0.4) there is nothing to render: the view SHOULD
instead present the original's metadata (`mainName`, `mediaType`, size)
and offer the embedded bytes for download, so the user can open the
original in its native application. The no-network rule is unaffected —
the bytes come from the package. A consumer MUST NOT attempt to render a
binary original as text.

For `visual` (0.5) two consumer profiles are legitimate: a **rich viewer**
(e.g. the installed WDF Reader) MAY render the rendition with a PDF
renderer **bundled with the application** — never loaded from the network
at runtime; the no-network rule of the document view applies unchanged. A
**lean consumer** (e.g. the standalone distribution file) SHOULD offer the
rendition for download alongside the source, and MAY point the user to an
installable rich viewer. A consumer MUST NOT fetch renderer code from a
remote origin to display the rendition.
