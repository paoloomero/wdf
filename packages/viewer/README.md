# @wdf/viewer

The single-file viewer of [WDF — Web Document Format](https://wdf.dev). This package ships two prebuilt, self-contained HTML files — no external requests at runtime, ever:

- **`viewer.html`** — the full WDF Reader: opens `.wdf` packages, verifies integrity, shows the human view, the canonical AI layer, the embedded original, paged/print views — and converts HTML exports to `.wdf` entirely client-side (zero network).
- **`standalone.html`** — the template used to produce self-contained `.wdf.html` documents (document + viewer in one file that opens in any browser).

## Install

```bash
npm install @wdf/viewer
```

```js
import { readFileSync } from 'node:fs';

const url = new URL(import.meta.resolve('@wdf/viewer/standalone.html'));
const template = readFileSync(url, 'utf8');
```

Hosted Reader: <https://wdf.dev> (installable as a PWA; associates with `.wdf` files).

Spec: [`spec/wdf-core-0.1.md`](https://github.com/paoloomero/wdf/blob/main/spec/wdf-core-0.1.md) (CC-BY 4.0). Code is Apache-2.0.
