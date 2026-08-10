import type { ValidateFunction } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import {
  validateCapture,
  validateHashes,
  validateManifest,
  validateOutline,
} from './schemas.compiled.js';
import { captureSchema, hashesSchema, manifestSchema, outlineSchema } from './schemas.data.js';
import type { WdfCapture, WdfHashes, WdfManifest, WdfOutline } from './types.js';

/**
 * The three JSON Schemas of WDF Core 0.1, plus the schema of the `capture`
 * extension (an extension spec, docs/ext-capture.md — shipped here so the
 * reference validator can check declared capture metadata). The source of
 * truth is `spec/schemas/*.schema.json`; callers load them (fs in Node,
 * fetch or bundling in the browser) and pass them in, keeping this module
 * isomorphic.
 */
export interface SchemaSet {
  manifest: object;
  outline: object;
  hashes: object;
  capture: object;
}

export interface SchemaValidators {
  manifest: ValidateFunction<WdfManifest>;
  outline: ValidateFunction<WdfOutline>;
  hashes: ValidateFunction<WdfHashes>;
  capture: ValidateFunction<WdfCapture>;
}

export function createSchemaValidators(schemas: SchemaSet): SchemaValidators {
  // strictRequired is an ajv-only lint that rejects `required` inside `then`
  // without a sibling `properties`; the outline schema uses that (valid) pattern.
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  // ajv-formats is CJS: under NodeNext the callable plugin lives on `.default`,
  // which at runtime resolves to the same function in Node, vitest and bundlers.
  addFormats.default(ajv);
  return {
    manifest: ajv.compile<WdfManifest>(schemas.manifest),
    outline: ajv.compile<WdfOutline>(schemas.outline),
    hashes: ajv.compile<WdfHashes>(schemas.hashes),
    capture: ajv.compile<WdfCapture>(schemas.capture),
  };
}

/** The embedded schemas (generated from spec/schemas). */
export const wdfSchemas: SchemaSet = {
  manifest: manifestSchema,
  outline: outlineSchema,
  hashes: hashesSchema,
  capture: captureSchema,
};

/**
 * Validators for the embedded schemas — PRECOMPILED with ajv standalone
 * (scripts/compile-schemas.mjs): no code generation at runtime, so they
 * run where eval/new Function is forbidden (MV3 service workers, strict
 * CSP). `createSchemaValidators` above stays the runtime path for custom
 * schema sets; a parity test keeps the two in agreement on every fixture.
 */
export function getSchemaValidators(): SchemaValidators {
  return compiledValidators;
}

const compiledValidators: SchemaValidators = {
  manifest: validateManifest as unknown as ValidateFunction<WdfManifest>,
  outline: validateOutline as unknown as ValidateFunction<WdfOutline>,
  hashes: validateHashes as unknown as ValidateFunction<WdfHashes>,
  capture: validateCapture as unknown as ValidateFunction<WdfCapture>,
};
