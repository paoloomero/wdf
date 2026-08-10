import type { ValidateFunction } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

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

let defaultValidators: SchemaValidators | undefined;

/** Memoized validators for the embedded WDF Core 0.1 schemas. */
export function getSchemaValidators(): SchemaValidators {
  return (defaultValidators ??= createSchemaValidators(wdfSchemas));
}
