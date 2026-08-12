# @wdf-dev/import

Import pipeline of [WDF — Web Document Format](https://wdf.dev): converts HTML (word-processor exports, saved web pages, live-page captures) and Markdown into valid, verifiable `.wdf` packages.

Isomorphic (Node ≥ 20 and browsers): all I/O goes through injected loaders (assets, sibling files, stylesheets, fonts), so the same pipeline runs in the CLI, in the browser-based Reader converter and in the browser extension — byte-identical output everywhere.

## Install

```bash
npm install @wdf-dev/import
```

## What it does

- Sanitizes arbitrary HTML into the closed WDF-HTML profile (whitelist, never trust).
- Translates source styling into a generated, deterministic `styles.css`.
- Promotes styled word-processor paragraphs to real headings (outline recovery).
- Packages referenced images with content-hashed names; optional font embedding.
- Optional extensions: embedded original source (`ext/source/`), capture provenance (`ext/capture/`), geometric pre-filtering for live-DOM captures.

## Example

```js
import { importDocument } from '@wdf-dev/import';

const report = [];
const result = await importDocument({ kind: 'html', text: html, baseName: 'document' }, {}, report);
// result.wdfBytes is a complete .wdf package; result.report explains every transformation
```

Most users want the [`@wdf-dev/cli`](https://www.npmjs.com/package/@wdf-dev/cli) `wdf import` command instead of calling this library directly.

Spec: [`spec/wdf-core-0.1.md`](https://github.com/paoloomero/wdf/blob/main/spec/wdf-core-0.1.md) (CC-BY 4.0). Code is Apache-2.0.
