# Changelog

The five public packages (`@wdf-dev/core`, `@wdf-dev/import`, `@wdf-dev/viewer`,
`@wdf-dev/cli`, `@wdf-dev/mcp`) share one version number. The package version is
not the format version: every release below reads and writes **WDF Core 0.1**
(`spec/wdf-core-0.1.md`).

## 0.2.5 — 11 November 2026

- **`.docx` numbering, as Word shows it.** A WDF `ol` has no type and no
  start: a browser numbers it 1., 2., 3. from one. So far the importer left
  every numbering to it, and:
  - numbered headings lost their number — "1.1. Scope" is now the heading's
    text;
  - letters and roman numerals turned into 1., 2., 3. — "a)", "ii." are now
    written at the start of the item;
  - a numbering resumed after other text restarted at 1 — it now goes on
    ("3.").
    A list stays an `ol` only where 1., 2., 3. from one is exactly what Word
    shows; elsewhere the label is text and the list is bulleted. The report
    counts both. Counters follow Word's model over the whole document.

## 0.2.4 — 11 November 2026

- **Footnotes and endnotes** of a `.docx` go to the end of the document as a
  numbered list **with no heading**: the "Notes" title the importer used to
  add was text the author did not write.
- `wdf validate` on a package that carries the author's PDF says so: included
  as-is, not compared with the content (`authorPdf` in `--json`). The verdict
  does not change.
- The import command on the home page adds `--standalone`: it now gives the
  `.wdf.html` anyone can open, next to the `.wdf`.
- Known limit, kept on purpose: the browser's own File → Print on the Reader
  window prints a notice, not the document (the document stays inside its
  isolated frame). Ctrl/Cmd+P and the PDF button print the whole document.

## 0.2.3 — 11 November 2026

- **Reader, file picker**: choosing a `.docx` together with its `.pdf` now
  converts both, as dropping them does (the PDF used to be lost, and in the
  other order nothing converted).
- **`.docx` images without a description**: a picture with no alternative
  text in Word, not marked decorative, keeps an empty `alt` — nothing is made
  up — and the conversion report now says how many there are.
- `wdf extract` reads a standalone `.wdf.html` too, like `validate` and `cite`.
- Reader status bar: shows the SHA-256 of `ai/content.md`, the one `wdf cite`
  and the MCP server print, and names it.
- `docs/field-test-pa-docx.md`: the importer on 16 public `.docx` files of
  Italian public bodies — what is found, what is lost, how it was measured.

## 0.2.2 — 11 November 2026

- **`.docx` text boxes**: their text is now converted — it used to be dropped,
  with nothing in the report. It enters the flow right after the paragraph
  the box is anchored to (once: a box Word writes twice counts once); the
  report says how many, and that the position on the page is not kept.
- **`.docx` form fields** (content controls): the prompt of an empty field
  ("Click or tap here to enter text") is removed everywhere and reported;
  table rows and cells wrapped in a content control are no longer skipped.

## 0.2.1 — 11 November 2026

- **`wdf cite <file> <id>`**: the verifiable citation of one element from the
  command line — `wdf:` URI, SHA-256 of `ai/content.md` (pins the revision
  the quote comes from), verdict, quoted content. Same answer as the MCP tool
  `wdf_cite`; reads `.wdf` and `.wdf.html`; `--json`.
- `wdf import --help` names `.docx` among the inputs and quotes no extension
  version number.
- `--with-pdf`: the CLI warns that the PDF is included as-is and is **not
  compared** with the document content; the conversion report records it.
- **Printing from the browser's own menu or shortcut**: Ctrl/Cmd+P in the
  Reader now prints the whole document (it used to print the Reader window:
  one page, the document cut at the first screen). File → Print on the window
  prints a notice saying how to print the document, never a cut page.
- `.docx` with one paragraph in the **Title** style and **Heading 1**
  chapters: the Title stays the only `h1`, the other headings move one level
  down (it used to give several `h1`). The report says how many moved.
  Documents with no Title are left as they are — no title is invented.
- `.docx` written by scripts, citing `Title` / `Heading1…6` (or `Titolo`,
  `Titolo1…6`) without defining the styles: read as headings, with a note in
  the report. A defined style is still read by its name only.

## 0.2.0 — 10 November 2026

Everything since 0.1.0 (12 August 2026).

### Convert

- **Word `.docx`, natively** (`wdf import report.docx`): styles, headings,
  lists, tables with merged cells, images, links, bookmarks, headers and
  footers, authored page breaks, notes, fields, equations. Extension
  `pagination` 0.1.
- **The author's PDF**, kept next to the converted document:
  `--with-pdf report.pdf` (extension `source`, visual rendition).
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
  title no longer breaks the manifest. Run on 2031 real `.docx` files of a
  private collection (not published, so not checkable from outside): 0
  validation errors. For a test anyone can repeat, on 16 public documents,
  see `docs/field-test-pa-docx.md`.
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
