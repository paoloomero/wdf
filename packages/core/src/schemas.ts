import type { ValidateFunction } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import type { WdfHashes, WdfManifest, WdfOutline } from './types.js';

/**
 * The three JSON Schemas of WDF Core 0.1. The source of truth is
 * `spec/schemas/*.schema.json`; callers load them (fs in Node, fetch or
 * bundling in the browser) and pass them in, keeping this module isomorphic.
 */
export interface SchemaSet {
  manifest: object;
  outline: object;
  hashes: object;
}

export interface SchemaValidators {
  manifest: ValidateFunction<WdfManifest>;
  outline: ValidateFunction<WdfOutline>;
  hashes: ValidateFunction<WdfHashes>;
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
  };
}
