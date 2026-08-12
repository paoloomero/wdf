# WDF — Web Document Format

**An open, web-native, AI-ready document format.**

WDF is a constrained profile of existing web technologies — not a new invention.
A `.wdf` file is a ZIP package containing semantic HTML content, typed datasets,
a deterministically derived AI layer (Markdown + outline with stable element
IDs), and integrity hashes. The guarantee at its core:

> _What the human reads and what the AI agent reads are the same thing —
> verifiably._

## Why

Documents that people read and documents that machines read have drifted apart:
an entire industry exists to reconstruct structure from PDFs before feeding them
to language models, heuristically and unverifiably. WDF closes the gap by
construction — the machine-readable view is _derived from_ the human-readable
one by a canonical, byte-deterministic algorithm, and the derivation is
machine-checkable. Responsive on any phone, offline by design, no new rendering
engine.

## What works today (v0.1 prototype)

The full chain runs end to end:

1. **Author** in Word / Google Docs / Pages → export to HTML.
2. **Convert** — `wdf import file.html` produces a valid `.wdf` (encoding,
   style translation, local + remote images, Word VML images).
3. **Read** — an installable **WDF Reader** (PWA) opens `.wdf` files on a double
   click, offline, like any document reader: verified badge, Human/Agent view
   toggle, outline navigation, copyable citations (`wdf:<doc-id>#<element-id>`).
4. **Query** — `wdf extract` (and an MCP server) give an agent the canonical
   Markdown with stable, verifiable citations — no parsing heuristics.

Still a prototype: the spec is a draft awaiting review, and interfaces may
change.

## Repository layout

- `spec/` — the WDF Core 0.1 specification and JSON Schemas (the source of truth)
- `packages/core` — `@wdf-dev/core`: isomorphic library (Node + browser): packaging,
  profile validation, canonical extraction, integrity, datasets
- `packages/cli` — `@wdf-dev/cli`: the `wdf` command (validate, pack, unpack,
  extract, import, new)
- `packages/viewer` — single-file HTML viewer + installable Reader (PWA)
- `packages/mcp` — `@wdf-dev/mcp`: MCP server exposing packages to AI agents
- `examples/` — three example documents (source + built `.wdf` + comparison PDF)
- `fixtures/` — golden files and valid/invalid documents for testing
- `site/` — demo site (assembled into `_site/` by `pnpm demo`)
- `docs/` — LLM-extraction comparison, MCP demo, Reader install guide

## Install

The tools are published on npm (Node ≥ 20):

```sh
# validate a document, nothing to install
npx @wdf-dev/cli validate document.wdf

# convert an HTML export (Word, Google Docs, saved web page) or Markdown
npx @wdf-dev/cli import mydoc.html -o mydoc.wdf

# or install the `wdf` command globally
npm install -g @wdf-dev/cli
```

Give AI agents verifiable access to `.wdf` documents via MCP:

```sh
claude mcp add wdf -- npx -y @wdf-dev/mcp
```

Libraries: [`@wdf-dev/core`](packages/core) (validation, extraction, integrity — isomorphic) and
[`@wdf-dev/import`](packages/import) (HTML/Markdown → `.wdf` pipeline); [`@wdf-dev/viewer`](packages/viewer)
ships the prebuilt single-file Reader. Validate documents in CI with the same
one-liner: `npx @wdf-dev/cli validate docs/report.wdf`.

## Working on the repo

Requirements: Node ≥ 20, pnpm ≥ 9.

```sh
pnpm install
pnpm test          # 219 tests
pnpm lint
pnpm build
pnpm demo          # build the demo site into _site/
node scripts/serve-site.mjs   # then open http://localhost:8642
```

Convert a document and open it:

```sh
node packages/cli/dist/index.js import mydoc.html -o mydoc.wdf
node packages/cli/dist/index.js validate mydoc.wdf
# open http://localhost:8642/viewer.html and drop mydoc.wdf in,
# or install the page as the "WDF Reader" app and double-click the file
```

See `docs/reader-install.md` for the installable-Reader walkthrough and
`CLAUDE.md` for the engineering ground rules (determinism, whitelist thinking,
dependency budget).

## License

- Code: [Apache-2.0](LICENSE) — maximum embeddability for a reference
  implementation, with an explicit patent grant.
- Specification (`spec/`): [CC-BY 4.0](LICENSE-SPEC).

WDF is developed by [infoFACTORY](https://www.infofactory.it/) in the context of
the European Open Internet Stack / NLnet ecosystem.
