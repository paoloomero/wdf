---
name: wdf-from-artifact
description: Turn a Claude artifact (a published HTML page or a Claude Docs document at a claude.ai/artifact/… link) into a verified WDF document — a `.wdf` package plus a self-contained `.wdf.html` that opens in any browser. Use when the user asks to convert, export or save an artifact ("this artifact", "this page", "this doc", a claude.ai/artifact link) as WDF / .wdf / .wdf.html, or wants a verifiable, citable copy of one. Italian triggers — "trasforma / converti l'artifact in wdf", "salvalo come .wdf.html", "fammi il wdf di questo documento". Not for slides, designs, dashboards or apps (they are not documents), and not for plain files (docx, html, md) — those go straight to `wdf import`.
---

# Claude artifact → WDF

You produce two files from one artifact:

- `<slug>.wdf` — the canonical package (semantic HTML on a closed whitelist, a machine layer
  derived from it by a deterministic algorithm, SHA-256 hashes).
- `<slug>.wdf.html` — the standalone distribution file (spec §9): the same package embedded in a
  single HTML file with the offline Reader built in. Double-click opens it; no network.

The artifact is never modified. You never write a package by hand: the `wdf` CLI derives the machine
layer and the hashes; you only supply the content and check the validator's verdict. The Reader's
"Verified" badge attests integrity and derivation (human view = machine view), **never** the truth
of the content — say so if the user asks what "verified" means.

## 0. Tools

Resolve the CLI once, in this order:

1. A local checkout of the WDF monorepo (preferred: newest importer, conversion report in the
   package): `$WDF_REPO/packages/cli/dist/index.js`, where `WDF_REPO` is `~/wdf` or the current
   repository. If `dist/` is missing, build it: `pnpm build` in the repo root (Node ≥ 20; on a
   machine where the default `node` is older, look for `~/.local/node22/bin` and prepend it to
   `PATH`).
2. Otherwise the published package: `npx -y @wdf-dev/cli` (0.1.0 on npm: same commands, older
   importer — no conversion report inside the package, and `--standalone` there writes
   `<slug>.html`, which you rename to `<slug>.wdf.html`).

Below, `wdf` stands for whichever you resolved. Work in a scratch directory; deliver into the
directory the user names, or the working directory.

## 1. Identify what the artifact is

Call the Artifact tool, `action: "read"`, with the link. Three outcomes:

| The read returns…                                                                                                                  | It is…                                                                                | Go to                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| raw HTML (`<!doctype html>…`)                                                                                                      | a published HTML page                                                                 | §2B                                                                                                                |
| "created from an Artifact type … Claude Docs" (the page is left out; the type's instructions talk about the Claude Docs connector) | a **doc** — its content lives in the Claude Docs service, not in the artifact's files | §2A                                                                                                                |
| a Slides, Design, Dashboard or other app type; or a page whose `<body>` is an empty mount point filled by JavaScript               | not a document                                                                        | stop: tell the user WDF carries documents, not apps, and offer to write the content as a document first (then §3B) |

Never fetch a claude.ai/artifact link with curl or WebFetch; the Artifact tool is the only reader.

## 2A. A doc (Claude Docs): export Markdown

1. Claude Docs connector `read` with `ref: {"object":"project","id":"<artifact id>"}` (the id is the
   last path segment of the `claude.ai/code/artifact/<uuid>` form; the Artifact read result states
   it). The result lists the tabs (`files[].id`).
2. `export` with `container: {"kind":"project","id":"<id>"}`, `file: "<tab id>"`,
   `format: "markdown"`. The result carries the file base64-encoded in `bytes_b64`.
3. Decode it to `<slug>.md` (`base64 -d < doc.b64 > <slug>.md` — on macOS `base64 -d <file>` as a
   positional argument fails; use stdin). One doc tab = one WDF; for a multi-tab doc ask which tab,
   or produce one file per tab.
4. Markdown is the right export: headings, emphasis, links, lists, code blocks, blockquotes and
   GFM tables import losslessly. Images do not (the importer drops Markdown images: assets must
   live under `content/assets/`); if the doc has images that matter, say so — the text still
   converts.

Then §3A with the `.md` file.

## 2B. A published HTML page: fetch the file, judge the markup

1. Artifact `read` with the link and `path: "index.html"` saves the page to a local file (the
   result gives the path). Copy it to `<slug>.html`.
2. Judge the markup before importing — the importer keeps what the WDF-HTML profile can express
   and drops the rest, and it cannot invent structure the page does not have:

   ```bash
   grep -o '<h[1-6]\|<p\b\|<table\|<ul\|<ol\|<div\|<span\|<section\|<aside\|<nav\|<header\|<script\|<svg\|<canvas\|<main\|<article' <slug>.html | sort | uniq -c
   ```

   The tally alone is not decisive: a page with a real `h1`, `p` and `main` can still carry all
   its section headings as `div`/`span` constructs (an eyebrow label, a number and a title in three
   spans). Open the file and look at how the sections start before deciding.

   - Semantic page (`h1`–`h6`, `p`, lists, tables carry the content; a `<main>` or `<article>`
     wraps it): **§3A**, direct import. The importer extracts the main landmark and drops the page
     chrome (nav, sidebars) around it.
   - Styled-span page (headings are `div`/`span` constructs, numbers and labels in separate spans,
     cards built from `div`s — even when `p` and `main` are real): a direct import still
     validates, but every pseudo-heading becomes a paragraph and the outline is empty — **§3B**,
     re-author the structure.
   - Content drawn by scripts, SVG charts or canvas: that content is lost in any import. Say what
     will be missing; if the page is mostly that, treat it as "not a document" (§1).

## 3A. Direct import

```bash
wdf import <slug>.md  --standalone --with-source --lang <bcp47> --title "<title>" -o <slug>.wdf
wdf import <slug>.html --standalone --with-source --lang <bcp47> --title "<title>" -o <slug>.wdf
```

- `--standalone` writes `<slug>.wdf.html` next to the package.
- `--with-source` embeds the artifact's own file byte-for-byte (extension `source`) plus the
  conversion report: the Reader's **Original** view then shows the artifact as published, offline
  (its inline CSS works; Google Fonts links and scripts are not loaded — no network, ever).
- `--lang` from the artifact's `<html lang>` or its language; `--title` from the artifact's title
  (the HTML page's `<title>` often sits in the body after publication and is not picked up).
- Never pass `--fetch-remote` unless the user asks: a local import must not touch the network.
- Converting the same artifact again later? Pass `--previous <old>.wdf` so the document keeps
  its id and unchanged elements keep theirs (spec §4.1, §6.4.4). Never invent an id.

Read the `note:` lines the CLI prints: they are the conversion report (what was extracted,
translated, dropped, renamed). A package can be VALID and still have lost something the notes
name (an unwrapped link, a dropped image): treat them as fix triggers in §3B and as facts to report
in §5.

## 3B. Re-author the structure, then import

When the page's structure is presentational (§2B), write `<slug>.semantic.html`: the artifact's
text, in document order, with the structure it visibly has, in the WDF-HTML profile
(`spec/wdf-core-0.1.md` §6 is the source of truth; this is the working subset):

- Head: `<meta charset="utf-8">`, one `<title>`, `<html lang="…">`. Body: one `<article>`.
- Blocks: `h1`–`h6` (exactly one `h1`), `p`, `ul`/`ol`/`li`, `blockquote` (containing `p` only),
  `pre` (text, or one `code`), `hr`, `dl`/`dt`/`dd`, `table`, `figure` (one `img`, optional
  `figcaption`), `section` (begin it with a heading), `header`/`footer`/`nav` (transparent
  containers: allowed, not citable).
- Inline: `a` (`href` = `https://…`, `mailto:…` or `#id` present in the document), `em`,
  `strong`, `code`, `sub`, `sup`, `time`, `cite`, `q`, `abbr`, `span`, `br`.
- Attributes: `id`, `class`, `lang`, `dir` on anything; a mixed-language page gets one `--lang`
  and `lang="…"` on the elements in the other language.
- Tables: `caption` + `thead` with one `tr` of `th` + `tbody`; rectangular grid; `colspan`/`rowspan`
  only ≥ 2.
- Ids: optional (the importer assigns stable ones), but any id you keep — in particular the
  targets of internal links — must match `^[a-z]+-[a-z0-9][a-z0-9-]*$` (`sec-intro`, not `f0`
  or `Intro`). An id that does not match is replaced and every `#link` to it is unwrapped to plain
  text, reported only as a `note:` while the package stays VALID.
- Not in the profile — map, don't drop: `aside` → `blockquote` (with `p` inside) or a `section`;
  `small`, a subtitle inside `h1` → a separate `p`; `b`/`i` → `strong`/`em`; `div` wrappers →
  unwrap. Forbidden outright: `style` attributes, `script`, `style` elements with anything but flat
  `tag`, `.class` and `tag.class` rules (the importer translates only those), `svg`, `iframe`,
  forms, `data-*`, `on*`. Images only if you can place the file next to the HTML
  (`<img src="…" alt="…">`; the importer packs it under `content/assets/`).
- Do not add, drop or reword text. Pseudo-headings become real headings; a "card" becomes a
  section with a heading; a label + value pair becomes a `dl` or a two-column table. Two
  exceptions, to be named in the report: placeholders that a script would have filled (counters
  such as "— / 1000", "Loading…") go; page chrome (a table of contents, a sticky header) is kept
  as `nav` + list when it is part of the document and dropped when it only duplicates the
  headings.
- Before importing, check fidelity: strip the tags from the artifact's `<body>` and from your file
  and compare the word multisets (a few lines of shell or node); the only differences allowed are
  the two exceptions above.

Then:

```bash
wdf import <slug>.semantic.html --standalone --lang <bcp47> --title "<title>" -o <slug>.wdf
```

(no `--with-source` here: the semantic file is yours, not the artifact). In the reply, say that the
structure was re-authored from the artifact and that the Original view is therefore absent.

## 4. Validate and correct

```bash
wdf validate <slug>.wdf
```

- Errors cite the spec section (`[§6.2.8] … table …`). Fix the cause in the input (§3B file) or
  the options and re-import. At most three rounds; if it still fails, report the remaining
  violations verbatim and stop.
- Warnings (`section should begin with a heading`, `exactly one <h1>`) are acceptable for a direct
  import; in §3B fix them.
- `VALID … status verified … integrity ok, determinism ok` is the target. Optional proof of the
  machine layer: `wdf extract <slug>.wdf` prints the canonical Markdown; `wdf extract --outline`
  prints `ai/outline.json`, a JSON array of every citable block with its id — filter
  `type == "heading"` to see the heading tree.

## 5. Deliver

- Make sure the standalone is named `<slug>.wdf.html` (rename if an older CLI wrote `<slug>.html`).
- Send `<slug>.wdf.html` (and `<slug>.wdf` if asked) with SendUserFile.
- Report, in a few lines: source (doc or page, link), path taken (direct / re-authored), the
  validator's verdict, and what did not make it across — scripts, charts, SVG, images, interactive
  parts, visual design beyond typography (the importer keeps fonts, sizes, colours, alignment;
  layout is intentionally not preserved: the document is recognisable and responsive, never a
  pixel copy). Mention the Original view when `--with-source` was used.
- Citations: every paragraph, heading, table and list item has a stable id; a citation is
  `wdf:<doc-id>#<element-id>` (spec §7.10). Point this out when the user wants to quote the document.

## Don'ts

- Don't edit the artifact, and don't republish anything.
- Don't hand-write `manifest.json`, `ai/*` or `integrity/*`; don't unpack, tweak and repack.
- Don't present the result as "verified" in the sense of facts.
- Don't widen the profile: if the validator rejects an element, the element goes, not the rule.
