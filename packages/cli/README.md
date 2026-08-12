# @wdf/cli

Command-line tool for [WDF — Web Document Format](https://wdf.dev): an open, web-native, AI-ready document format with verifiable human/AI equivalence.

## Quick start

```bash
# validate a document (one-shot, nothing to install)
npx @wdf/cli validate document.wdf

# or install the `wdf` command globally
npm install -g @wdf/cli
wdf validate document.wdf
```

## Commands

| Command                    | What it does                                                                                                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wdf validate <file>`      | Full validation: structure, WDF-HTML profile, canonical extraction, integrity, datasets. Every violation cites the spec section it enforces.                                                                                                      |
| `wdf import <file-or-url>` | Convert HTML (Word / Google Docs exports, saved or live web pages) or Markdown into a valid `.wdf`. Options: `--standalone` (self-contained `.wdf.html`), `--with-source` (embed the original), `--embed-fonts`, `--full-page`, `--fetch-remote`. |
| `wdf extract <file>`       | Emit the canonical Markdown (AI layer) of a package.                                                                                                                                                                                              |
| `wdf pack` / `wdf unpack`  | Build a package from a directory / explode one.                                                                                                                                                                                                   |
| `wdf new`                  | Scaffold a minimal valid document.                                                                                                                                                                                                                |

Determinism is the contract: the same input produces a byte-identical package on any platform.

## CI example

Validate published documents in GitHub Actions:

```yaml
- uses: actions/setup-node@v4
  with: { node-version: 22 }
- run: npx @wdf/cli validate docs/report.wdf
```

Spec: [`spec/wdf-core-0.1.md`](https://github.com/paoloomero/wdf/blob/main/spec/wdf-core-0.1.md) (CC-BY 4.0). Code is Apache-2.0. Bundled fallback fonts are OFL-1.1 (license texts in `fonts/`).
