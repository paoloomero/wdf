# WDF Core 0.1 — Web Document Format Core Specification

**Status:** Editor's Draft · **Version:** 0.1.0-draft · **Date:** 2026-07-18
**Editor:** Paolo Omero (infoFACTORY)
**License:** CC-BY 4.0 (planned)

This document defines WDF Core 0.1, a portable document format built as a
constrained profile of existing web technologies. A WDF document is a ZIP
package containing semantic HTML content, typed datasets, a deterministically
derived AI representation (Markdown and a structural outline with stable
element identifiers), and integrity hashes.

The central guarantee of the format:

> **What the human reads and what an AI agent reads are the same thing —
> verifiably.** The AI representation is derived from the human-readable
> content by a canonical, byte-deterministic algorithm, and the derivation is
> machine-checkable.

---

## Table of contents

1. [Introduction](#1-introduction) _(non-normative)_
2. [Conformance and terminology](#2-conformance-and-terminology)
3. [Container](#3-container)
4. [Manifest](#4-manifest)
5. [Datasets](#5-datasets)
6. [WDF-HTML profile](#6-wdf-html-profile)
7. [AI layer and canonical extraction](#7-ai-layer-and-canonical-extraction)
8. [Integrity](#8-integrity)
9. [Standalone distribution profile](#9-standalone-distribution-profile)
10. [Extensions](#10-extensions)
11. [Security considerations](#11-security-considerations)

- [Appendix A — Minimal complete document](#appendix-a--minimal-complete-document) _(informative)_

---

## 1. Introduction

_This section is non-normative._

### 1.1 Design goals

- **Web-native.** Content is semantic HTML and CSS. No new markup language,
  no new rendering engine: any conforming viewer is a thin shell over a
  browser engine.
- **AI-ready by construction.** Every document carries a Markdown
  representation and a structural outline, both derived from the HTML by the
  canonical extraction algorithm of §7. Agents never parse HTML heuristically,
  and citations resolve to stable element identifiers.
- **Deterministic and verifiable.** The extraction algorithm is
  byte-deterministic. A validator can prove that the AI representation
  matches the human-readable content, and package hashes detect tampering.
- **Boring on purpose.** WDF invents as little as possible: ZIP for the
  container (the EPUB/OCF model), JSON plus JSON Schema for metadata,
  CommonMark plus GFM tables for the AI layer, SHA-256 for integrity.
- **Small core, versioned extensions.** Everything not needed for the above
  is out of the core (§10).

### 1.2 Non-goals of version 0.1

Editing formats and editors; live/refreshable data; digital signatures and
provenance (a hook for C2PA is anticipated as an extension); multilingual
documents; semantic versioning of document revisions; vertical profiles
(public administration, scientific, legal); scripted interactivity of any
kind.

### 1.3 A WDF document at a glance

```
document.wdf                   (ZIP archive)
├── manifest.json              REQUIRED  package metadata (§4)
├── content/
│   ├── index.html             REQUIRED  WDF-HTML content (§6)
│   ├── styles.css             OPTIONAL  single stylesheet (§6.7)
│   └── assets/…               OPTIONAL  local images
├── data/
│   └── *.json                 OPTIONAL  typed datasets (§5)
├── ai/
│   ├── content.md             REQUIRED  canonical Markdown (§7)
│   └── outline.json           REQUIRED  structure map (§7.8)
├── ext/
│   └── <name>/…               OPTIONAL  extension data (§10)
└── integrity/
    └── hashes.json            REQUIRED  SHA-256 of every file (§8)
```

## 2. Conformance and terminology

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT,
RECOMMENDED, MAY, and OPTIONAL in this document are to be interpreted as
described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

**Conformance classes.**

- A **conforming document** is a `.wdf` package satisfying every MUST-level
  requirement of §3–§8.
- A **conforming producer** is software that emits conforming documents,
  including the AI layer derived exactly per §7.
- A **conforming consumer** (e.g. a viewer) is software that reads conforming
  documents, satisfies the consumer requirements of §8 and §11, and does not
  rely on any extension (§10) to present core content.
- A **conforming validator** is software that checks every machine-checkable
  requirement of this specification and reports each violation with a
  reference to the section that defines the violated rule.

**Terminology.**

- _Package_: the ZIP archive constituting the document.
- _Package path_: the path of a file inside the package (§3.2).
- _Entry document_: the file `content/index.html`.
- _Citable element_: an element of the entry document that carries a stable
  identifier and can be the target of a citation (§6.4).
- _Document order_: pre-order, depth-first traversal order of the DOM.
- _Whitespace character_: one of U+0009 TAB, U+000A LF, U+000C FF,
  U+000D CR, U+0020 SPACE.
- _Normalized text_ of a node: the result of applying §7.3 to the node's
  text content.

All text files in a package MUST be encoded as UTF-8 without a byte order
mark. All JSON files MUST conform to RFC 8259.

## 3. Container

### 3.1 Archive requirements

A WDF package MUST be a ZIP archive as defined by the PKWARE APPNOTE.
Additionally:

- **3.1.1** Each entry MUST be either uncompressed (method 0, _stored_) or
  compressed with method 8 (_deflate_).
- **3.1.2** Entry file names MUST be encoded in UTF-8 and MUST be valid
  package paths (§3.2). _(In practice, package paths are restricted to
  ASCII.)_
- **3.1.3** Entry file names MUST be unique within the archive. A validator
  MUST reject a package containing duplicate entry names.
- **3.1.4** The archive MUST NOT contain directory entries (names ending in
  `/`), and MUST NOT use ZIP encryption or multi-volume features.
- **3.1.5** The first entry of the archive SHOULD be `manifest.json`.
  _(Unlike EPUB's `mimetype`, WDF does not require the first entry to be
  stored uncompressed; this is a deliberate simplification.)_

### 3.2 Package paths

- **3.2.1** A package path is a sequence of one or more segments separated by
  `/` (U+002F). Each segment MUST match `[A-Za-z0-9][A-Za-z0-9._-]*`.
- **3.2.2** Consequently, paths MUST NOT be absolute, MUST NOT contain `.`
  or `..` segments, MUST NOT contain backslashes, whitespace, or control
  characters, and segments MUST NOT begin with a dot. A validator MUST
  reject any entry whose name violates these rules (see also §11.2).
- **3.2.3** The first segment MUST be one of `manifest.json` (as the whole
  path), `content`, `data`, `ai`, `ext`, or `integrity`. Files outside these
  locations MUST NOT be present.

### 3.3 Required and permitted files

- **3.3.1** A package MUST contain exactly: `manifest.json` (§4),
  `content/index.html` (§6), `ai/content.md` and `ai/outline.json` (§7),
  and `integrity/hashes.json` (§8).
- **3.3.2** A package MAY contain: `content/styles.css` (§6.7), image files
  under `content/assets/` (§6.3.6), dataset files under `data/` (§5), and
  extension files under `ext/<name>/` (§10).
- **3.3.3** The directory `integrity/` MUST contain only `hashes.json`.
- **3.3.4** Every file under `content/` other than `index.html` and
  `styles.css` MUST be listed in the manifest's `resources` array; every
  file under `data/` MUST be listed in the manifest's `datasets` array
  (§4.1).

### 3.4 Canonical packing

Producers MUST pack deterministically, so that packing the same file set
twice yields byte-identical archives (_pack → unpack → pack_ is the
identity):

- **3.4.1** Entry order: `manifest.json` first, then all other entries
  sorted by entry name in ascending code point order.
- **3.4.2** All entry modification dates and times MUST be set to
  1980-01-01 00:00:00 (the DOS epoch). No high-resolution timestamp,
  Unix permission, or other platform-specific extra fields may be emitted.
- **3.4.3** A given producer MUST use fixed compression settings, so its
  output is stable across runs and platforms.

Byte-identical archives across _different_ implementations are NOT required
(deflate output varies between compressors); interoperability of
verification rests on the integrity hashes, which are computed over
uncompressed file contents (§8).

### 3.5 Media type and extension

The media type of a WDF package is `application/wdf+zip` (registration
pending); the file extension is `.wdf`. The media type of a standalone
distribution file (§9) is `text/html`.

## 4. Manifest

`manifest.json` MUST validate against `spec/schemas/manifest.schema.json`
(JSON Schema 2020-12), which is normative. This section defines field
semantics.

### 4.1 Fields

| Field                 | Req.       | Semantics                                                                                                                                                                                                          |
| --------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `wdf`                 | MUST       | Spec version; the string `"0.1"`.                                                                                                                                                                                  |
| `id`                  | MUST       | Stable document identifier, a UUID URN (`urn:uuid:…`, lowercase hex). It identifies the _document_, not a revision: it MUST NOT change when content is revised. It is the authority part of citation URIs (§7.10). |
| `title`               | MUST       | Human-readable document title. SHOULD equal the normalized text of the entry document's `title` element.                                                                                                           |
| `language`            | MUST       | Primary language, a BCP 47 tag. MUST equal the `lang` attribute of the entry document's `html` element.                                                                                                            |
| `authors`             | MAY        | Ordered list of `{ name, role? }`. `role` values are free-form; `"author"` and `"contributor"` are RECOMMENDED.                                                                                                    |
| `created`, `modified` | MUST       | RFC 3339 date-times. `modified` MUST be greater than or equal to `created`.                                                                                                                                        |
| `entry`               | MUST       | The string `"content/index.html"` (fixed in 0.1).                                                                                                                                                                  |
| `resources`           | see §3.3.4 | `{ path, mediaType }` for each additional file under `content/`. `mediaType` MUST be the correct media type of the file.                                                                                           |
| `datasets`            | see §3.3.4 | `{ path, title?, schema }` for each file under `data/`. `schema.columns` declares the typed columns (§5).                                                                                                          |
| `extensions`          | MAY        | Extensions used by the document (§10).                                                                                                                                                                             |

- **4.1.1** Paths in `resources` and `datasets` MUST reference files present
  in the package, and every file requiring a listing (§3.3.4) MUST be listed
  exactly once. A validator MUST reject dangling or duplicate listings.

## 5. Datasets

Datasets make tabular content available as typed data. The visible table and
the dataset are the same information, verifiably (§6.5).

### 5.1 Dataset files

A dataset file is a JSON file under `data/` with this shape:

```json
{
  "columns": [
    { "name": "anno", "type": "integer" },
    { "name": "importo", "type": "number" }
  ],
  "rows": [
    [2024, 1250000.5],
    [2025, 1310000.0]
  ]
}
```

- **5.1.1** `columns` MUST be identical (same order, names, and types) to
  `schema.columns` declared for this path in the manifest.
- **5.1.2** Column names MUST be unique within a dataset.
- **5.1.3** Each row MUST be an array with exactly one cell per column.
- **5.1.4** Each cell MUST be `null` (missing value) or a value of the
  column's type per §5.2.

### 5.2 Value types and canonical text rendering

| Type      | JSON representation                                            | Canonical text rendering            |
| --------- | -------------------------------------------------------------- | ----------------------------------- |
| `string`  | string                                                         | the string itself                   |
| `integer` | number with no fractional part, magnitude ≤ 2⁵³ − 1            | ECMAScript `ToString` of the number |
| `number`  | finite number                                                  | ECMAScript `ToString` of the number |
| `boolean` | `true` / `false`                                               | `true` / `false`                    |
| `date`    | string `YYYY-MM-DD`, a valid proleptic Gregorian calendar date | the string itself                   |
| (null)    | `null`                                                         | the empty string                    |

The _canonical text rendering_ is the exact cell text a bound table must
display (§6.5). ECMAScript `ToString` is the Number-to-String conversion
defined by ECMA-262 (the output of `String(x)` in JavaScript); it is
deterministic and locale-independent.

> _Note (non-normative):_ locale-formatted display of values (thousands
> separators, currency symbols) is intentionally out of scope for 0.1 and is
> a candidate for a future extension.

## 6. WDF-HTML profile

The entry document MUST conform to this profile. The profile is a **closed
whitelist**: anything not explicitly permitted is forbidden. A validator
MUST reject a document containing an element, attribute, or construct not
permitted here, citing the relevant subsection.

### 6.1 Document structure

- **6.1.1** The entry document MUST be a valid HTML document parseable by
  the WHATWG HTML parsing algorithm, beginning with `<!DOCTYPE html>`.
- **6.1.2** The `html` element MUST carry a `lang` attribute equal to the
  manifest `language` (§4.1).
- **6.1.3** The `head` MUST contain: a `meta` element with `charset="utf-8"`
  as its first child, and exactly one non-empty `title` element. It SHOULD
  contain `<meta name="viewport" content="width=device-width, initial-scale=1">`.
  It MAY contain exactly one `link` element per §6.7. No other children are
  permitted in `head`.
- **6.1.4** The `body` MUST contain exactly one child element: an `article`
  element containing the entire document content. The `article` MUST contain
  at least one block element.
- **6.1.5** The document SHOULD contain exactly one `h1`.

### 6.2 Element whitelist

The following elements, and no others, are permitted:

- **Document:** `html`, `head`, `meta`, `title`, `link`, `body`.
- **Sectioning and grouping:** `article`, `section`, `header`, `footer`,
  `nav`.
- **Blocks:** `h1`–`h6`, `p`, `blockquote`, `figure`, `figcaption`, `pre`,
  `hr`, `ul`, `ol`, `li`, `dl`, `dt`, `dd`, `table`, `caption`, `thead`,
  `tbody`, `tfoot`, `tr`, `th`, `td`, `img`.
- **Inline:** `a`, `em`, `strong`, `code`, `sub`, `sup`, `time`, `cite`,
  `q`, `abbr`, `span`, `br`.

Explicitly forbidden (non-exhaustive, per the whitelist principle):
`script`, `style`, `iframe`, `object`, `embed`, `video`, `audio`, `canvas`,
`svg`, `math`, `form` and all form controls, `template`, `slot`, custom
elements. _(MathML support is deferred to a future version or extension.)_

**Content model constraints** (in addition to the HTML content models):

- **6.2.1** `section` MAY contain `header`, `footer`, and any block or
  sectioning element; it SHOULD begin with a heading.
- **6.2.2** `header`, `footer`, and `nav` are _transparent containers_: they
  MAY contain block elements but are not citable and add no structure of
  their own (§7.8).
- **6.2.3** `p`, `h1`–`h6`, `dt`, `dd`, `figcaption`, `caption`, `th`, `td`
  MUST contain phrasing content only (text and inline elements).
- **6.2.4** `li` MUST contain phrasing content, optionally followed by
  exactly one nested `ul` or `ol`.
- **6.2.5** `blockquote` MUST contain one or more `p` elements only.
- **6.2.6** `figure` MUST contain exactly one `img`, optionally followed by
  exactly one `figcaption`.
- **6.2.7** `pre` MUST contain either text only, or exactly one `code`
  element containing text only.
- **6.2.8** `table` MUST contain, in order: exactly one `caption`, exactly
  one `thead` containing exactly one `tr` of `th` cells, exactly one
  `tbody`, and optionally one `tfoot`. `br` is not permitted inside `th` or
  `td`. The table's **column count** is the sum of the `colspan` values
  (default 1) of the header row's cells. Cells are laid out by the
  following grid algorithm: rows are processed in document order; within a
  row, each cell occupies the leftmost slot not already covered by an
  earlier cell's `colspan` or `rowspan`, and covers `colspan` columns and
  `rowspan` rows. The resulting grid MUST be exactly rectangular: every
  slot of every row covered exactly once (no overlaps, no holes), no cell
  extending past the column count, and no `rowspan` extending past the last
  row of the cell's row group (`thead`, `tbody`, or `tfoot`).
- **6.2.9** `img` MUST NOT appear outside `figure` except inline inside
  `p`, `th`, or `td` (an inline image in a table cell serializes per
  §7.4.2, which GFM permits in cells).

### 6.3 Attribute rules

Attributes not listed here are forbidden. In particular: all event handler
attributes (`on*`), `style`, and all `data-*` attributes other than
`data-wdf-dataset` are forbidden.

- **6.3.1** Global: `id` (per §6.4), `class`, `lang`, `dir` are permitted on
  any element in `body`.
- **6.3.2** `a`: `href` REQUIRED. Its value MUST match one of:
  `https://…` or `http://…` (no whitespace, `<`, or `>`), `mailto:…`, or a
  fragment `#<id>` where `<id>` is an `id` attribute value present in this
  document (§6.4.5). All other schemes — including `javascript:`, `data:`,
  `file:` — are forbidden.
- **6.3.3** `img`: `src` REQUIRED, a package path under `content/assets/`
  referencing a file present in the package with media type `image/png`,
  `image/jpeg`, `image/svg+xml`, or `image/webp`; `alt` REQUIRED (MAY be
  empty for decorative images); `width` and `height` MAY be present
  (positive integers).
- **6.3.4** `time`: `datetime` MAY be present (a valid RFC 3339 date or
  date-time). `abbr`: `title` MAY be present. `blockquote`: `cite` MAY be
  present (same value rules as `a href`, external forms only). `th`:
  `scope` MAY be present (`col` or `row`). `th`, `td`: `colspan` and
  `rowspan` MAY be present, as decimal integers between 2 and 1000
  inclusive — the value 1 is expressed by omitting the attribute, so that
  every table has exactly one encoding — subject to the grid rules of
  §6.2.8, and forbidden in dataset-bound tables (§6.5.2). `table`:
  `data-wdf-dataset` MAY be present (§6.5). `meta`, `link`, `html`: as in
  §6.1/§6.7.
- **6.3.5** No attribute value may contain a control character other than
  TAB.
- **6.3.6** The document MUST NOT reference any resource outside the
  package, in any form. All referenced resources MUST live under
  `content/`.

### 6.4 Identifier rules

- **6.4.1** The following elements are **citable** and MUST carry an `id`
  attribute: `section`, `h1`–`h6`, `p`, `table`, `figure`, `blockquote`,
  and every `li` belonging to a _top-level list_ (a `ul` or `ol` that is not
  contained in another `ul`, `ol`, or `li`).
- **6.4.2** An `id` attribute on any element MUST match
  `^[a-z]+-[a-z0-9][a-z0-9-]*$` and MUST be unique in the document.
- **6.4.3** The prefix SHOULD reflect the element type. RECOMMENDED
  prefixes: `sec-` (section), `h-` (heading), `p-` (paragraph), `tbl-`
  (table), `fig-` (figure), `bq-` (blockquote), `li-` (list item).
  Producers SHOULD use meaningful slugs for sections, headings, tables and
  figures (`sec-introduction`, `tbl-spesa-2025`) and zero-padded counters
  for the rest (`p-0012`).
- **6.4.4** Identifiers are **stable**: across revisions of the same
  document (same manifest `id`), an identifier MUST keep referring to the
  same logical element. Producers MUST NOT renumber unchanged elements.
- **6.4.5** Non-citable elements MAY carry an `id` (subject to 6.4.2), e.g.
  as targets for internal links.

### 6.5 Tables and dataset binding

A `table` element MAY carry `data-wdf-dataset="<path>"`, binding it to a
dataset. For a bound table:

- **6.5.1** The path MUST be declared in the manifest's `datasets` (§4.1).
- **6.5.2** The table MUST NOT contain a `tfoot`, and no cell may carry
  `colspan` or `rowspan`: a bound table is a full grid in which every cell
  is one typed value (merged cells are permitted only in unbound tables,
  §6.3.4).
- **6.5.3** The `thead` row MUST have exactly one `th` per dataset column,
  in order, and the normalized text (§7.3) of each `th` MUST equal the
  column `name`.
- **6.5.4** The `tbody` MUST have exactly one `tr` per dataset row, in
  order, and the normalized text of each `td` MUST equal the canonical text
  rendering (§5.2) of the corresponding cell value.

A validator MUST check 6.5.1–6.5.4; this is the machine-checkable guarantee
that the visible table and the typed data are the same information.

### 6.6 Reserved

_(Reserved for future profile additions; numbering kept stable.)_

### 6.7 Stylesheet rules

- **6.7.1** The document MAY reference at most one stylesheet, via
  `<link rel="stylesheet" href="content/styles.css">`; `href` MUST be
  exactly that path. Inline `style` attributes and `style` elements are
  forbidden.
- **6.7.2** The stylesheet MUST NOT contain: `@import`, `@font-face`,
  `url(…)` in any form, `position: fixed`, or `position: sticky`.
- **6.7.3** Everything else in CSS is permitted. Responsive layout is a
  feature, not a risk: `@media` queries are explicitly encouraged.
- **6.7.4** Consumers MUST render the document acceptably with the
  stylesheet disabled (the content is semantic HTML; the stylesheet is
  presentational only).

## 7. AI layer and canonical extraction

The AI layer is the differentiating core of WDF. It consists of two files
derived from the entry document by the **canonical extraction algorithm**:

- `ai/content.md` — the document as CommonMark (plus GFM tables), with
  every citable block carrying its identifier as an anchor;
- `ai/outline.json` — the ordered structure map of citable elements.

### 7.1 The determinism rule

- **7.1.1** `ai/content.md` MUST be byte-identical to the output of the
  extraction algorithm (§7.2–§7.7) applied to `content/index.html`.
- **7.1.2** `ai/outline.json` MUST be byte-identical to the canonical JSON
  serialization (§7.9) of the outline (§7.8) of `content/index.html`.
- **7.1.3** The algorithm is a pure function of the entry document's bytes.
  Implementations MUST NOT let platform, locale, time zone, hash-map
  iteration order, or any other environmental factor influence the output.
- **7.1.4** A validator MUST recompute both derivations and reject the
  package on any byte difference (§8.2).

### 7.2 Extraction: overview

Extraction is defined only for entry documents that conform to §6; behavior
on non-conforming input is undefined (validators reject such documents
before extraction).

The algorithm has four stages:

1. **Parse** the entry document with the WHATWG HTML parsing algorithm,
   yielding a DOM.
2. **Walk** the `article` element (§6.1.4), mapping elements to _blocks_
   per §7.5, in document order.
3. **Serialize** each block to one or more lines of text per §7.4–§7.6.
4. **Assemble** per §7.7: blocks joined with single blank lines, LF line
   endings, one trailing LF, UTF-8.

### 7.3 Text normalization

Applied to every run of text except inside `pre` (§7.5.8):

- **7.3.1** Within a block's phrasing content, taken as one character
  stream in document order, each maximal run of whitespace characters (§2)
  is replaced by a single U+0020, _including_ runs that span inline element
  boundaries and runs inside `code` spans.
- **7.3.2** Leading and trailing whitespace of the block's stream is
  removed.
- **7.3.3** For each inline element, leading and trailing spaces of its own
  content are moved _outside_ the element, so that serialization delimiters
  (§7.4) always hug non-space content. An inline element whose content is
  empty after this step produces no output at all.
- **7.3.4** No Unicode normalization (NFC/NFD) is applied, ever. U+00A0
  NO-BREAK SPACE is not a whitespace character and is preserved.

The _normalized text_ of an element (used by §4.1, §6.5, §7.8) is the
result of 7.3.1–7.3.2 on its text content, with all markup ignored.

### 7.4 Inline serialization

#### 7.4.1 Text escaping

In text runs (everywhere except inside `code` spans and `pre` blocks), each
occurrence of the following characters is prefixed with `\` (U+005C):

```
\  `  *  _  [  ]  {  }  <  >  &  |  #
```

Additionally, when the first character of an output line's textual content
(after any block prefix such as `> ` or a list marker, see §7.5) would be:

- `-` or `+` followed by a space or end of line → that character is escaped;
- a decimal digit sequence followed by `.` or `)` and then a space or end of
  line → the `.` or `)` is escaped.

No other characters are ever escaped. _(This set is deliberately larger than
the minimum CommonMark requires; uniform over-escaping buys determinism and
unambiguous anchors at a small cost in raw readability.)_

#### 7.4.2 Inline element mapping

| Element                              | Output                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `em`                                 | `*` + content + `*`                                                                      |
| `strong`                             | `**` + content + `**`                                                                    |
| `cite`                               | `*` + content + `*`                                                                      |
| `q`                                  | `"` + content + `"` (U+0022)                                                             |
| `code`                               | see §7.4.3                                                                               |
| `a`                                  | `[` + content + `](<` + href value + `>)`                                                |
| `img` (inline)                       | `![` + escaped alt value + `](<` + src value + `>)`                                      |
| `br`                                 | `\` + line break (CommonMark hard break); the new line receives the current block prefix |
| `sub`, `sup`, `span`, `time`, `abbr` | content only (element dropped)                                                           |

Nested elements serialize inside-out in the natural way. URL values in
`(<…>)` are emitted verbatim (the profile forbids `<`, `>`, and whitespace
in them, §6.3.2).

Two hard-break clarifications: space items immediately adjacent to a hard
break are dropped (a consequence of §7.7's no-trailing-whitespace rule,
applied symmetrically); and in contexts that serialize to a single line —
headings, table captions and cells, figure captions, list items, definition
terms and descriptions — `br` renders as a single space instead of a break.

#### 7.4.3 Code spans

Content of `code` is emitted without escaping, delimited by a run of
backticks one longer than the longest run of backticks in the content
(minimum one). If the content begins or ends with a backtick, a single
space is added inside both delimiters.

### 7.5 Block serialization

Blocks are the children of `article`, of `section`, and of the transparent
containers `header`, `footer`, `nav` — plus the inner blocks of
`blockquote`, `li`, `dl`, `figure`, and `table` as defined below.
`section`, `header`, `footer`, `nav` produce no output of their own: they
serialize their children as consecutive blocks (but see §7.6 for section
anchors).

- **7.5.1 Headings.** `h1`–`h6` → `#` × level + space + inline content +
  anchors (§7.6). One line.
- **7.5.2 Paragraphs.** `p` → inline content + anchors. One line, unless
  hard breaks (`br`) produce more; anchors go on the last line.
- **7.5.3 Blockquotes.** Serialize the child paragraphs; join consecutive
  children with a separator line containing only `>`; prefix every content
  line with `> `. The blockquote's own anchor: §7.6.
- **7.5.4 Unordered lists.** Each `li` → `- ` + inline content + anchors
  (§7.6, only for citable items), then, if a nested list is present, its
  lines each indented by two spaces.
- **7.5.5 Ordered lists.** As 7.5.4, with markers `1.`, `2.`, … in item
  order (numbering always starts at 1), followed by one space. Nested list
  lines are indented by the width of the parent item's marker plus one
  space.
- **7.5.6 Definition lists.** Each `dt` → a paragraph `**` + inline content
  - `**`; each `dd` → a paragraph. All emitted as consecutive blocks.
- **7.5.7 Figures.** First line: the `img` per §7.4.2. If a `figcaption` is
  present, a second line with its inline content. Anchors on the last line.
- **7.5.8 Code blocks.** `pre` → a fenced code block. The fence is a run of
  backticks one longer than the longest backtick run in the content, with a
  minimum of three. If the `pre` contains a `code` child with a class
  matching `language-<x>`, `<x>` is the info string. Content is emitted
  verbatim — §7.3 does not apply — except that every CRLF and lone CR is
  normalized to LF, and a trailing LF is removed if present.
- **7.5.9 Tables.** First, a paragraph: the `caption` inline content +
  the table's anchors (§7.6). Then a blank line, then GFM rows: header row
  from the `thead` cells, a delimiter row with `---` per column (no
  alignment colons), then one row per `tbody` (and then `tfoot`, if any)
  `tr`. Every row emits exactly one cell per grid column (§6.2.8): a cell's
  inline content appears in its **origin slot** (its first row, leftmost
  column); every other slot covered by its `colspan`/`rowspan` — like every
  hole in a non-conforming grid — is emitted as an empty cell. GFM cannot
  express merged cells; this expansion is the canonical rendering. Each row
  is `|` + (space + cell inline content + space + `|`) per cell. Empty
  cells produce two spaces between pipes. Alignment is a stylesheet concern
  and never encoded.
- **7.5.10 Thematic breaks.** `hr` → the line `---`. No anchor.

### 7.6 Anchors

- **7.6.1** An anchor is the string `{#` + id + `}`. Anchors are appended
  to a line, each preceded by exactly one space. (The braces are escaped in
  ordinary text by §7.4.1, so anchors are unambiguous.)
- **7.6.2** Every citable _leaf_ block — heading, paragraph, top-level list
  item, figure, table — appends its own anchor to its designated line:
  headings and single-line paragraphs on that line; multi-line paragraphs
  on the last line; list items on the item's own line (before any nested
  list); figures on the last line; tables on the caption paragraph.
- **7.6.3** Every citable _container_ — `section` and `blockquote` —
  appends its anchor to the **first** output line produced by its content,
  after that line's existing anchors. When several containers start at the
  same line, anchors are appended innermost first. A citable container
  producing no output lines emits a line containing only its anchor(s).
- **7.6.4** Consequently a section whose first block is its heading yields,
  e.g.: `## Results {#h-results} {#sec-results}`.

### 7.7 Assembly

The output is the concatenation of all top-level serialized blocks, in
document order, separated by exactly one blank line, with LF (U+000A) line
endings, exactly one trailing LF at the end of the file, no trailing
whitespace on any line, and no leading or trailing blank lines. The file
contains no front matter: document metadata lives in the manifest only.
The result, encoded as UTF-8 without BOM, is the required content of
`ai/content.md`.

### 7.8 Outline

The outline is an ordered array with exactly one node per citable element,
in document order. Each node is an object with these fields (in this
order):

| Field    | Presence              | Value                                                                              |
| -------- | --------------------- | ---------------------------------------------------------------------------------- |
| `id`     | always                | the element's `id`                                                                 |
| `type`   | always                | `section`, `heading`, `paragraph`, `table`, `figure`, `blockquote`, or `list-item` |
| `level`  | iff type is `heading` | 1–6                                                                                |
| `title`  | see below             | normalized text (§7.3)                                                             |
| `parent` | always                | `id` of the nearest citable ancestor, or `null`                                    |

`title` is present for: `heading` (its own normalized text), `section` (the
normalized text of its first heading in document order that is not inside a
nested section; absent if none), `table` (the caption's normalized text),
`figure` (the figcaption's normalized text; absent if none). It is absent —
never empty — for `paragraph`, `blockquote`, and `list-item`.
`ai/outline.json` MUST validate against `spec/schemas/outline.schema.json`.

### 7.9 Canonical JSON serialization

Wherever this specification requires canonical JSON (`ai/outline.json`,
`integrity/hashes.json`), the serialization is the one produced by the
ECMA-262 `JSON.stringify(value, null, 2)` algorithm — two-space indent,
no trailing spaces, `\uXXXX` escapes only where JSON requires escaping,
non-ASCII characters emitted as literal UTF-8 — with object properties in
the exact order given by the defining section, followed by exactly one
trailing LF.

### 7.10 Citations

A citation is a URI of the form:

```
wdf:<document-id>#<element-id>
```

where `<document-id>` is the manifest `id` (§4.1) and `<element-id>` is the
identifier of a citable element. Example:

```
wdf:urn:uuid:a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d#tbl-spesa-2025
```

A citation resolves within a given package by locating the element with
that `id` in the entry document, the block carrying the anchor `{#id}` in
`ai/content.md`, and the node with that `id` in `ai/outline.json` — which
are, by §7.1, the same content. Consumers presenting a citation SHOULD
verify package integrity (§8) first.

## 8. Integrity

### 8.1 Hash manifest

`integrity/hashes.json` MUST validate against
`spec/schemas/hashes.schema.json` and MUST contain, for **every** file in
the package except itself, the lowercase hexadecimal SHA-256 digest of the
file's (uncompressed) bytes:

```json
{
  "algorithm": "sha256",
  "files": {
    "manifest.json": "…64 hex digits…",
    "content/index.html": "…",
    "ai/content.md": "…",
    "ai/outline.json": "…"
  }
}
```

Keys of `files` are sorted in ascending code point order. The file is
serialized as canonical JSON (§7.9), with `algorithm` before `files`.

### 8.2 Verification

A verifier MUST perform, in order:

1. **Structure**: §3 and §4 checks (paths, required files, manifest
   validity, listings).
2. **Hashes**: every package file except `integrity/hashes.json` has a
   matching digest; no digest lacks its file; no file lacks its digest.
3. **Determinism**: re-run extraction (§7) on `content/index.html` and
   compare byte-for-byte with `ai/content.md` and `ai/outline.json`.

The package is **verified** only if all three pass. Viewers SHOULD display
the verification status prominently (e.g. _verified_ / _tampered_ /
_not verifiable_) and MUST NOT display _verified_ without having performed
all three checks.

### 8.3 Limits of 0.1

Hashes detect accidental corruption and naive tampering, but an attacker
who rewrites the content can rewrite the hashes too: 0.1 provides
_consistency_, not _authenticity_. Digital signatures and C2PA content
credentials are planned as an extension (§10); the `integrity/` directory
is the designated attachment point.

## 9. Standalone distribution profile

A `.wdf` file is not directly openable by double click in today's browsers.
The _standalone distribution profile_ addresses this for dissemination:

- **9.1** A standalone file is a single HTML file embedding (a) a
  conforming viewer and (b) the complete package bytes, base64-encoded
  (RFC 4648, standard alphabet), inside
  `<script type="application/wdf+zip" id="wdf-package">…</script>`.
  The encoded text MAY contain line feeds.
- **9.2** The embedded package is the canonical artifact: integrity (§8)
  and citations (§7.10) refer to it. Consumers MUST be able to re-extract
  the byte-identical `.wdf` from a standalone file.
- **9.3** A standalone file MUST function without network access and MUST
  NOT reference any external resource. Its embedded viewer is subject to
  the consumer requirements of §8.2 and §11.
- **9.4** The standalone form is a _distribution profile_, not the
  canonical format: tooling interoperates on `.wdf` packages.

## 10. Extensions

- **10.1** An extension has a name matching `^[a-z][a-z0-9-]*$` and a
  version. A document using an extension MUST declare it in the manifest's
  `extensions` array.
- **10.2** Extension data lives under `ext/<name>/` and is covered by the
  integrity hashes like any other file. An `ext/` directory entry without a
  corresponding manifest declaration, or vice versa, is a validation error.
- **10.3** Extensions MUST be _ignorable_: a conforming consumer that
  ignores every extension MUST still be able to render, extract, verify,
  and cite the document fully. Extensions MUST NOT alter the semantics of
  any core section of this specification.
- **10.4** Anticipated extensions (non-normative): digital
  signatures/C2PA provenance, live-data refresh, multilingual variants,
  MathML content, vertical profiles (PA, scientific, legal).
- **10.5** Published extensions (non-normative): the reference
  distribution ships extension specifications alongside this document,
  as `docs/ext-*.md` — currently `source` (byte-for-byte embedding of
  the conversion input), `fonts` (embedded metric-compatible font
  clones), `capture` (provenance of a live-page capture) and
  `pagination` (authored page breaks anchored to stable element ids).

## 11. Security considerations

- **11.1 No code execution.** WDF documents contain no scripts by
  construction (§6.2), and consumers MUST NOT execute any content of the
  package as code. Viewers MUST render the entry document in a sandboxed
  context (e.g. an `iframe` with the `sandbox` attribute allowing neither
  scripts nor forms, plus a Content-Security-Policy forbidding all external
  requests).
- **11.2 Archive handling.** Package paths (§3.2) exclude absolute paths
  and `..` traversal; validators MUST enforce this _before_ any extraction
  to a filesystem. Implementations MUST reject duplicate entries (§3.1.3)
  and SHOULD enforce resource limits when decompressing untrusted packages
  (RECOMMENDED ceilings: 10 000 entries, 512 MiB total uncompressed, and a
  compression ratio limit) to mitigate decompression bombs.
- **11.3 No network.** A conforming document cannot reference external
  resources (§6.3.6), and conforming viewers make no network requests when
  rendering. Opening a document neither leaks the reader's IP address to a
  third party nor exposes reading behavior. Hyperlinks (§6.3.2) navigate
  outside the document only on explicit user activation.
- **11.4 Integrity is not authenticity.** See §8.3. Consumers SHOULD make
  the distinction visible to users.
- **11.5 Standalone files are HTML.** A standalone file (§9) runs its
  embedded viewer's own code. Recipients trust the standalone file's
  _producer_, exactly as with any HTML attachment; the embedded package
  remains independently extractable and verifiable by external tools.

---

## Appendix A — Minimal complete document

_This appendix is informative, but the derivation shown is exact: it is a
worked example of §7 and doubles as a conformance test vector._

`content/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Hello WDF</title>
  </head>
  <body>
    <article>
      <section id="sec-hello">
        <h1 id="h-hello">Hello, WDF</h1>
        <p id="p-0001">
          A document whose <em>human</em> and <em>agent</em> views are the same thing.
        </p>
      </section>
    </article>
  </body>
</html>
```

`ai/content.md` (exactly these bytes, LF endings, trailing newline):

```markdown
# Hello, WDF {#h-hello} {#sec-hello}

A document whose _human_ and _agent_ views are the same thing. {#p-0001}
```

`ai/outline.json`:

```json
[
  {
    "id": "sec-hello",
    "type": "section",
    "title": "Hello, WDF",
    "parent": null
  },
  {
    "id": "h-hello",
    "type": "heading",
    "level": 1,
    "title": "Hello, WDF",
    "parent": "sec-hello"
  },
  {
    "id": "p-0001",
    "type": "paragraph",
    "parent": "sec-hello"
  }
]
```

`manifest.json` declares `wdf: "0.1"`, an `id`, `title: "Hello WDF"`,
`language: "en"`, timestamps, and `entry: "content/index.html"`;
`integrity/hashes.json` lists the SHA-256 of the four other files. A
citation to the paragraph reads `wdf:<document-id>#p-0001`.
