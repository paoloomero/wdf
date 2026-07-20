# MCP demo: an agent reading a WDF package (T6.1)

A recorded, reproducible session with the `@wdf/mcp` server (stdio, JSON-RPC/MCP) reading
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
      "path": "/var/folders/qr/b8_044zd73l_f8nwrwlvhn200000gn/T/wdf-mcp-demo-HUB4jZ/delibera-pa.wdf"
    }
  }
}
```

```
Opened: Determinazione n. 87/2026 — Affidamento servizi di digitalizzazione documentale
Document id: urn:uuid:7d444840-9dc0-5d1c-b745-1a56c4e5f6a7
Language: it · 22 citable elements · 16 blocks
Verification: VERIFIED (hashes ok, AI layer is the canonical extraction of the content)
Top-level sections: sec-premesse — Premesse, sec-dispositivo — Dispositivo, sec-pubblicazione — Pubblicazione ed efficacia
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
    "id": "p-intestazione",
    "type": "paragraph",
    "parent": null
  },
  {
    "id": "h-titolo",
    "type": "heading",
    "level": 1,
    "title": "Determinazione n. 87/2026 — Affidamento servizi di digitalizzazione documentale",
    "parent": null
  },
  {
    "id": "p-data",
    "type": "paragraph",
    "parent": null
  },
  {
    "id": "sec-premesse",
    "type": "section",
    "title": "Premesse",
    "parent": null
  },
  {
    "id": "h-premesse",
    "type": "heading",
    "level": 2,
    "title": "Premesse",
    "parent": "sec-premesse"
  },
  {
    "id": "p-0001",
    "type": "paragraph",
    "parent": "sec-premesse"
  },
  {
    "id": "bq-norma",
    "type": "blockquote",
    "parent": "sec-premesse"
  },
  {
    "id": "p-0002",
    "type": "paragraph",
    "parent": "bq-norma"
  },
  {
    "id": "p-0003",
    "type": "paragraph",
    "parent": "sec-premesse"
  },
  {
    "id": "sec-dispositivo",
    "type": "section",
    "title": "Dispositivo",
    "parent": null
  },
  {
    "id": "h-dispositivo",
    "type": "heading",
    "level": 2,
    "title": "Dispositivo",
    "parent": "sec-dispositivo"
  },
  {
    "id": "p-0004",
    "type": "paragraph",
    "parent": "sec-dispositivo"
  },
  {
    "id": "li-0001",
    "type": "list-item",
    "parent": "sec-dispositivo"
  },
  {
    "id": "li-0002",
    "type": "list-item",
    "parent": "sec-dispositivo"
  },
  {
    "id": "li-0003",
    "type": "list-item",
    "parent": "sec-dispositivo"
  },
  {
    "id": "li-0004",
    "type": "list-item",
    "parent": "sec-dispositivo"
  },
  {
    "id": "tbl-impegni",
    "type": "table",
    "title": "Impegni di spesa per capitolo ed esercizio",
    "parent": "sec-dispositivo"
  },
  {
    "id": "p-0005",
    "type": "paragraph",
    "parent": "sec-dispositi
… (truncated; 2250 chars)
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
## Dispositivo {#h-dispositivo} {#sec-dispositivo}

Per le motivazioni espresse in premessa, che qui si intendono integralmente richiamate, il Responsabile **determina**: {#p-0004}

1. di affidare a Esempio Digitale S.r.l. il servizio di digitalizzazione documentale per il periodo 2026-2027, per un corrispettivo complessivo di **24400 euro** oneri inclusi; {#li-0001}
2. di impegnare la spesa come indicato nella tabella degli impegni, con esigibilità nelle annualità di riferimento; {#li-0002}
3. di destinare una quota pari a **1830 euro** alla formazione del personale interno sull'utilizzo della piattaforma; {#li-0003}
4. di dare atto che il presente provvedimento sarà pubblicato secondo quanto indicato nella sezione [Pubblicazione](<#sec-pubblicazione>). {#li-0004}

Impegni di spesa per capitolo ed esercizio {#tbl-impegni}

| capitolo | esercizio | importo | esigibile |
| --- | --- | --- | --- |
| 1042.3 — Servizi informatici | 2026 | 14640 | 2026-12-31 |
| 1042.3 — Servizi informatici | 2027 | 9760 | 2027-06-30 |
| 1015.1 — Formazione del personale | 2026 | 1830 | 2026-12-31 |

Gli importi in tabella sono espressi in euro, IVA inclusa; la tabella è collegata al dataset tipizzato `data/impegni.json` del pacchetto: i valori visualizzati e i dati leggibili dalle macchine sono, verificabilmente, la stessa cosa. {#p-0005}
```

## Cite a table, verifiably

```json
{
  "method": "tools/call",
  "params": {
    "name": "wdf_cite",
    "arguments": {
      "id": "tbl-impegni"
    }
  }
}
```

```
Citation: wdf:urn:uuid:7d444840-9dc0-5d1c-b745-1a56c4e5f6a7#tbl-impegni
Verified: yes — the cited content is provably what the human-view document shows
Resolves to:
Impegni di spesa per capitolo ed esercizio {#tbl-impegni}
```

**Why this matters:** the agent never parsed HTML or guessed at structure — it navigated by
stable ids, read canonical Markdown whose fidelity to the rendered document is
machine-verified, and produced citations any reviewer can resolve and check.
