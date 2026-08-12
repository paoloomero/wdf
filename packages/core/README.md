# @wdf/core

Core library of [WDF — Web Document Format](https://wdf.dev): an open, web-native, AI-ready document format. One `.wdf` package carries a human rendering and a canonical AI layer, with hashes binding the two — same document for people and machines, verifiably.

Isomorphic (Node ≥ 20 and browsers). No Node-only APIs; deterministic by contract: the same input produces byte-identical output on any platform.

## Install

```bash
npm install @wdf/core
```

## What it does

- **Package I/O** — `readPackage` / `writePackage`: deterministic ZIP + JSON manifest, structural validation with errors citing spec sections.
- **WDF-HTML profile** — `validateProfile`: closed whitelist of elements/attributes (spec §6).
- **Canonical extraction** — `extract`: HTML → canonical Markdown (spec §7), byte-deterministic, with stable anchors for verifiable citations.
- **Integrity** — content hashes and verification (spec §8).
- **Datasets** — table/dataset correspondence checks (spec §6.5).
- **Extensions** — `capture` provenance (live-page captures) and `source` (embedded original) parsing/validation.

## Example

```js
import { readPackage, verifyPackage } from '@wdf/core';

const pkg = readPackage(bytes); // Uint8Array of a .wdf file
const result = await verifyPackage(pkg); // integrity + profile + extraction (spec §8.2)
```

The specification lives in the repository under [`spec/wdf-core-0.1.md`](https://github.com/paoloomero/wdf/blob/main/spec/wdf-core-0.1.md) (CC-BY 4.0). Code is Apache-2.0.
