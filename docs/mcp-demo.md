# MCP demo: an agent reading a WDF package (T6.1)

A recorded, reproducible session with the `@wdf-dev/mcp` server (stdio, JSON-RPC/MCP) reading
the example decree. Regenerate with `pnpm build && node scripts/mcp-demo.mjs`.
Register the server in an MCP client, e.g. Claude Code:

```sh
claude mcp add wdf -- node <repo>/packages/mcp/dist/index.js
```

## Handshake

```json
{
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-06-18",
    "capabilities": {}
  }
}
```

```
{
  "protocolVersion": "2025-06-18",
  "capabilities": {
    "tools": {}
  },
  "serverInfo": {
    "name": "wdf-mcp",
    "version": "0.1.0"
  },
  "instructions": "Tools for reading WDF (Web Document Format) packages. Start with wdf_open(path); then wdf_outline to navigate, wdf_read to read canonical content, wdf_cite for verifiable citations of the form wdf:<document-id>#<element-id>."
}
```

## Discover the tools

```json
{
  "method": "tools/list",
  "params": {}
}
```

```
[
  "wdf_open",
  "wdf_outline",
  "wdf_read",
  "wdf_cite"
]
```

## Open and verify the document

```json
{
  "method": "tools/call",
  "params": {
    "name": "wdf_open",
    "arguments": {
      "path": "/var/folders/qr/b8_044zd73l_f8nwrwlvhn200000gn/T/wdf-mcp-demo-me1Vn5/municipal-decree.wdf"
    }
  }
}
```

```
Opened: Decree no. 87/2026 — Award of document digitisation services
Document id: urn:uuid:7d444840-9dc0-5d1c-b745-1a56c4e5f6a7
Language: en · 22 citable elements · 16 blocks
Verification: VERIFIED (hashes ok, AI layer is the canonical extraction of the content)
Top-level sections: sec-recitals — Recitals, sec-operative — Operative part, sec-publication — Publication and effect
Use wdf_outline to navigate, wdf_read to read, wdf_cite for verifiable citations.
```

## Navigate: the structure map

```json
{
  "method": "tools/call",
  "params": {
    "name": "wdf_outline",
    "arguments": {}
  }
}
```

```
[
  {
    "id": "p-letterhead",
    "type": "paragraph",
    "parent": null
  },
  {
    "id": "h-title",
    "type": "heading",
    "level": 1,
    "title": "Decree no. 87/2026 — Award of document digitisation services",
    "parent": null
  },
  {
    "id": "p-date",
    "type": "paragraph",
    "parent": null
  },
  {
    "id": "sec-recitals",
    "type": "section",
    "title": "Recitals",
    "parent": null
  },
  {
    "id": "h-recitals",
    "type": "heading",
    "level": 2,
    "title": "Recitals",
    "parent": "sec-recitals"
  },
  {
    "id": "p-0001",
    "type": "paragraph",
    "parent": "sec-recitals"
  },
  {
    "id": "bq-law",
    "type": "blockquote",
    "parent": "sec-recitals"
  },
  {
    "id": "p-0002",
    "type": "paragraph",
    "parent": "bq-law"
  },
  {
    "id": "p-0003",
    "type": "paragraph",
    "parent": "sec-recitals"
  },
  {
    "id": "sec-operative",
    "type": "section",
    "title": "Operative part",
    "parent": null
  },
  {
    "id": "h-operative",
    "type": "heading",
    "level": 2,
    "title": "Operative part",
    "parent": "sec-operative"
  },
  {
    "id": "p-0004",
    "type": "paragraph",
    "parent": "sec-operative"
  },
  {
    "id": "li-0001",
    "type": "list-item",
    "parent": "sec-operative"
  },
  {
    "id": "li-0002",
    "type": "list-item",
    "parent": "sec-operative"
  },
  {
    "id": "li-0003",
    "type": "list-item",
    "parent": "sec-operative"
  },
  {
    "id": "li-0004",
    "type": "list-item",
    "parent": "sec-operative"
  },
  {
    "id": "tbl-commitments",
    "type": "table",
    "title": "Spending commitments by chapter and year",
    "parent": "sec-operative"
  },
  {
    "id": "p-0005",
    "type": "paragraph",
    "parent": "sec-operative"
  },
  {
    "id": "sec-publicatio
… (truncated; 2200 chars)
```

## Read one section, precisely

```json
{
  "method": "tools/call",
  "params": {
    "name": "wdf_read",
    "arguments": {
      "id": "sec-dispositivo"
    }
  }
}
```

```
No citable element "sec-dispositivo" in this document. Use wdf_outline to list elements.
```

## Cite a table, verifiably

```json
{
  "method": "tools/call",
  "params": {
    "name": "wdf_cite",
    "arguments": {
      "id": "tbl-commitments"
    }
  }
}
```

```
Citation: wdf:urn:uuid:7d444840-9dc0-5d1c-b745-1a56c4e5f6a7#tbl-commitments
Verified: yes — the cited content is provably what the human-view document shows
Resolves to:
Spending commitments by chapter and year {#tbl-commitments}
```

**Why this matters:** the agent never parsed HTML or guessed at structure — it navigated by
stable ids, read canonical Markdown whose fidelity to the rendered document is
machine-verified, and produced citations any reviewer can resolve and check.
