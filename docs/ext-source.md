# WDF extension: `source` (version 0.1)

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
"extensions": [{ "name": "source", "version": "0.1" }]
```

## Files

- `ext/source/source.json` — REQUIRED. Metadata and resource map (below).
- `ext/source/<hash>.<ext>` — REQUIRED. The original main file, stored
  unmodified in its **original encoding** (never re-encoded). `<hash>` is
  the first 16 hex digits of the SHA-256 of the bytes; `<ext>` is `html`
  or `md`. Original file names (which may contain characters §3.2 forbids
  in package paths) survive only as _values_ inside `source.json`.

Referenced images are **not duplicated**: the import pipeline already
copies them unmodified into `content/assets/` under content-hashed names;
`source.json` maps the original references onto those copies. A producer
using this extension keeps every loaded asset in the package, even assets
the canonical document does not reference.

## `source.json`

```json
{
  "source": "0.1",
  "main": "ext/source/8fda6be18a3c2f10.html",
  "mainName": "test doc accessibilit.html",
  "encoding": "windows-1252",
  "resources": {
    "test%20doc%20accessibilit.fld/image001.jpg": "content/assets/dba84c2ce51eb884.jpg"
  }
}
```

- `source` — extension version.
- `main` — package path of the embedded original main file.
- `mainName` — the original file name (or URL, for `wdf import <url>`).
- `encoding` — the encoding detected at import time (WHATWG label);
  consumers use it to decode `main` for display.
- `resources` — original `src` value (verbatim, URL-encoding included) →
  package path. Keys are sorted; serialization is canonical JSON with
  two-space indent and a trailing newline, so identical input produces
  identical bytes.

## Consumer guidance (viewers)

A viewer offering an "original" view MUST render the decoded main file in
the same sandbox it uses for canonical content (no scripts, no external
requests), resolving `resources` references from the package. It MUST NOT
inject its own styling: the point of the view is the untouched original.
