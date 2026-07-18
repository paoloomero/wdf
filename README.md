# WDF — Web Document Format

**An open, web-native, AI-ready document format.**

WDF is a constrained profile of existing web technologies — not a new invention. A `.wdf` file is a ZIP package containing semantic HTML content, typed datasets, a deterministically derived AI layer (Markdown + outline with stable element IDs), and integrity hashes. The guarantee at its core:

> _What the human reads and what the AI agent reads are the same thing — verifiably._

## Status

**Early prototype (v0.1, pre-release).** Nothing here is stable yet. The goal of this phase is a public one-file demo: a `.wdf` document that opens with a double click, renders responsively on mobile, contains real typed data, is verifiable via hashes, and from which an LLM extracts perfect content with fine-grained citations — side by side with the same document as PDF failing on all four points.

## Repository layout

- `spec/` — the WDF Core 0.1 specification and JSON Schemas (the source of truth)
- `packages/core` — `@wdf/core`: isomorphic library (Node + browser)
- `packages/cli` — `@wdf/cli`: the `wdf` command (validate, pack, unpack, extract, import)
- `packages/viewer` — single-file HTML viewer, zero installation
- `fixtures/` — valid and invalid documents for testing
- `examples/` — example documents (source + built `.wdf`)
- `site/` — public demo site

## Development

Requirements: Node ≥ 20, pnpm ≥ 9.

```sh
pnpm install
pnpm test
pnpm lint
pnpm build
```

See `CLAUDE.md` for ground rules (determinism, whitelist thinking, dependency budget).

## License

- Specification: CC-BY 4.0 (planned)
- Code: MIT or EUPL — **to be decided before the first public release**
