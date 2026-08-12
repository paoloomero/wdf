// Precompiles the JSON Schema validators with ajv standalone
// (T18.4): MV3 service workers forbid eval/new Function, so the runtime
// ajv compile of getSchemaValidators cannot run inside the extension's
// background. The generated module contains plain functions — same
// semantics, no code generation at runtime. A parity test
// (test/schemas.spec.ts) asserts it agrees with the runtime compiler on
// every fixture.
//
// Regenerate with: pnpm sync:schemas (root) — runs after schemas.data.ts.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';
import addFormats from 'ajv-formats';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const schemasDir = join(root, 'spec/schemas');

const load = (name) => JSON.parse(readFileSync(join(schemasDir, name), 'utf8'));

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
  code: { source: true, esm: true },
  schemas: {
    manifest: load('manifest.schema.json'),
    outline: load('outline.schema.json'),
    hashes: load('hashes.schema.json'),
    capture: load('capture.schema.json'),
    pagination: load('pagination.schema.json'),
  },
});
addFormats.default(ajv);

const code = standaloneCode(ajv, {
  validateManifest: 'manifest',
  validateOutline: 'outline',
  validateHashes: 'hashes',
  validateCapture: 'capture',
  validatePagination: 'pagination',
});

// ajv standalone still emits require() for its runtime helpers even in
// esm mode (upstream limitation): rewrite them as ESM imports so the
// module works in bundlers and service workers alike.
const esm = code
  .replaceAll('require("ajv/dist/runtime/ucs2length")', '__ucs2length')
  .replaceAll('require("ajv-formats/dist/formats")', '__formats');
if (esm.includes('require(')) {
  throw new Error(`unhandled require() in generated code: ${/require\([^)]*\)/.exec(esm)?.[0]}`);
}

const out = `// @ts-nocheck
/* eslint-disable */
// GENERATED FILE — do not edit. Precompiled ajv validators (no runtime
// code generation: MV3-safe). Source of truth: spec/schemas/*.json.
// Regenerate with: pnpm sync:schemas
import __ucs2lengthModule from 'ajv/dist/runtime/ucs2length.js';
import __formatsModule from 'ajv-formats/dist/formats.js';
// CJS/ESM interop differs between Node, vitest and bundlers: normalize.
const __ucs2length = {
  default: typeof __ucs2lengthModule === 'function' ? __ucs2lengthModule : __ucs2lengthModule.default,
};
const __formats = {
  fullFormats: __formatsModule.fullFormats ?? __formatsModule.default.fullFormats,
};
${esm}`;

writeFileSync(join(here, '../src/schemas.compiled.ts'), out);
console.log('packages/core/src/schemas.compiled.ts regenerated');
