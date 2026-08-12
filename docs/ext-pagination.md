# WDF extension: `pagination` (version 0.1)

Status: extension specification (outside WDF Core, per core spec §10).
Producers MAY use it; conforming consumers MAY ignore it entirely (§10.3).
Sections are numbered so validators can cite them (`ext-pagination §4`),
the same way core violations cite core sections.

## §1. Purpose

WDF Core is deliberately **page-agnostic**: extraction (§7), citations
(§6.4) and determinism know nothing about pages, because pages are a
property of one rendering, not of the document. Some source formats,
however, carry **authored** page breaks — a `.docx` records explicit
breaks (`w:br type="page"`) and section boundaries (`sectPr`) that the
author placed on purpose. Discarding them loses real intent; encoding
them in the core would break its page-agnosticism.

The `pagination` extension carries that intent **outside the core**,
anchored to the stable element ids the format already guarantees (§6.4):
"a new page begins before the element with this id". Paged renderings (a
paper-like view, print/PDF) SHOULD honor it; continuous renderings and
the AI layer are unaffected. Extraction and citations MUST NOT change in
any way because of this extension (§10.3).

## §2. Manifest declaration

```json
"extensions": [{ "name": "pagination", "version": "0.1" }]
```

## §3. Files

- `ext/pagination/pagination.json` — REQUIRED. The authored break list
  (§4). A package that declares the `pagination` extension without this
  file is invalid.

## §4. `pagination.json`

Machine-validated: the reference schema is
`spec/schemas/pagination.schema.json`. When the manifest declares
`pagination`, validators MUST check `pagination.json` against it and
report each violation citing this section.

```json
{
  "pagination": "0.1",
  "breakBefore": ["h-scope", "tbl-commitments", "sec-annex-a"]
}
```

- `pagination` — extension version (`"0.1"`).
- `breakBefore` — non-empty array of element ids (§6.4.2 syntax), each
  meaning: a page begins immediately **before** the element carrying
  that id. Ids MUST be unique, MUST reference elements that exist in the
  entry document, and MUST be listed in **document order** (the order in
  which their elements appear in the entry document) — one canonical
  encoding for one set of breaks, per the determinism rule (§7.1).
  Validators MUST check existence and order against the entry document.

A break before the document's first rendered element is meaningless
(every rendering starts a page there); producers SHOULD NOT emit it and
consumers MAY ignore it. Serialization follows the package convention:
canonical JSON, two-space indent, trailing newline.

## §5. Producer guidance

A producer converting a paged source SHOULD emit one entry per authored
break that survives conversion, anchored to the id of the first element
of the new page. Breaks whose following content was dropped entirely (so
no element exists to anchor to) are dropped with a report — never
guessed. Implicit breaks caused by content overflow are NOT authored
intent and MUST NOT be recorded.

## §6. Consumer guidance (viewers)

A paged rendering (paper view, print, PDF) SHOULD begin a new page
before each referenced element, in addition to any breaks the rendering
inserts on its own (e.g. section-per-page policies, content overflow). A
continuous rendering ignores the extension and remains conforming
(§10.3). The AI layer, extraction and citations are unaffected by
design; a consumer MUST NOT alter canonical content based on this
extension.
