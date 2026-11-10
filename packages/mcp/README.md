# @wdf-dev/mcp

MCP (Model Context Protocol) server for [WDF — Web Document Format](https://wdf.dev) packages. Lets AI agents open, navigate and quote `.wdf` documents through the canonical AI layer — verifiable citations with stable anchors, no parsing heuristics, no hallucinated page numbers.

Zero runtime dependencies beyond `@wdf-dev/core`; speaks MCP over stdio.

## Tools

- `wdf_open` — open a `.wdf` package or a standalone `.wdf.html` and verify it (conformance, hashes, derivation of the AI layer)
- `wdf_outline` — document outline with stable section anchors
- `wdf_read` — read a section's canonical content
- `wdf_cite` — produce a verifiable citation: `wdf:<document-id>#<element-id>`, the quoted content, and the SHA-256 of `ai/content.md` that pins the revision (the digest `integrity/hashes.json` lists)

A package that does not verify stays readable, but every answer is marked NOT VERIFIED.

## Setup

Claude Code:

```bash
claude mcp add wdf -- npx -y @wdf-dev/mcp
```

Any MCP client: run `npx @wdf-dev/mcp` as a stdio server.

Spec: [`spec/wdf-core-0.1.md`](https://github.com/paoloomero/wdf/blob/main/spec/wdf-core-0.1.md) (CC-BY 4.0). Code is Apache-2.0.
