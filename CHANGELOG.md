# Changelog

The five public packages (`@wdf-dev/core`, `@wdf-dev/import`, `@wdf-dev/viewer`,
`@wdf-dev/cli`, `@wdf-dev/mcp`) share one version number. The package version is
not the format version: every release below reads and writes **WDF Core 0.1**
(`spec/wdf-core-0.1.md`).

## 0.2.0 — 10 November 2026

Everything since 0.1.0 (12 August 2026).

### Convert

- **Word `.docx`, natively** (`wdf import report.docx`): styles, headings,
  lists, tables with merged cells, images, links, bookmarks, headers and
  footers, authored page breaks, notes, fields, equations. Extension
  `pagination` 0.1.
- **The author's PDF**, kept next to the converted document:
  `--with-pdf report.pdf` (extension `source` 0.5, visual rendition).
- **Revisions keep their identity**: `--id <urn:uuid:…>` and
  `--previous <file.wdf>` keep the document id and the ids of unchanged
  elements (spec §4.1, §6.4.4).
- **Conversion report inside the package** with `--with-source` (extension
  `source` 0.6): what was dropped or changed, and why.
- **Layout tables** in `.docx` (borderless grids that only place text,
  as in Europass CVs) become paragraphs, headings and lists instead of
  tables; a one-row section label becomes a heading. Drawn grids stay
  tables, list labels kept as text in their cells.
- `.docx` forms: blank rows of tables are dropped; a one-row table is
  never a data table — a label/value pair becomes one citable paragraph,
  other content becomes paragraphs.
- Page-number fields (PAGE, NUMPAGES) no longer leave stale numbers; the
  alt text Word writes by itself is removed. Every change is in the
  conversion report.
- Pictures inside headings or list items move to their own paragraph
  (§6.2.9): such documents used to fail validation. An empty document
  title no longer breaks the manifest. Tested on 2031 real `.docx` files:
  0 validation errors.
- `--standalone` writes a single self-contained `.wdf.html` next to the
  package.
- Markdown: inline runs across line breaks, list item continuation lines,
  GitHub-style heading anchors.
- HTML: `<time datetime>` values normalised to RFC 3339.

### Read

- **Original view**: the author's PDF rendered page by page (PDF.js, as
  same-origin lazy assets of the Reader deployment); in a `.wdf.html`, the
  browser's own PDF viewer. Download links for the original file and the PDF.
- **Plain view**: the document without the author's stylesheet (spec §6.7.4).
- New home with two entry points, Read and Convert; English and Italian
  interface.
- Citations: persistent mark on the cited element, `wdf:` URIs resolved from
  the search box, documents open at a `#anchor`.
- Installable app (PWA): install button and `.wdf` file association.

### Share

- **A `.wdf.html` an agent can read** (spec §9.5–§9.7, errata 2026-11-10):
  the document's canonical Markdown is also plain text in the page, so an
  agent or text extractor that runs no script finds the document, not only
  the viewer. The embedded package stays the verifiable original; `wdf
validate` now accepts `.wdf.html` and checks that the copy matches it.

### Verify

- One verification pipeline, `validatePackage()`, shared by the CLI, the
  Reader and the MCP server; spec §8.2 errata.

### Fixed

- Agent and Original views scroll again.
- The author's PDF attaches whatever its file name.

## 0.1.0 — 12 August 2026

First public release.
