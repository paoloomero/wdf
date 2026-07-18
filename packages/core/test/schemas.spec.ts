import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createSchemaValidators, wdfSchemas, type SchemaValidators } from '../src/schemas.js';

const repoRoot = resolve(import.meta.dirname, '../../..');
const schemasDir = join(repoRoot, 'spec/schemas');
const fixturesDir = join(repoRoot, 'fixtures/schemas');

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const validators = createSchemaValidators({
  manifest: loadJson(join(schemasDir, 'manifest.schema.json')) as object,
  outline: loadJson(join(schemasDir, 'outline.schema.json')) as object,
  hashes: loadJson(join(schemasDir, 'hashes.schema.json')) as object,
});

describe('embedded schemas', () => {
  it.each(['manifest', 'outline', 'hashes'] as const)(
    'schemas.data.ts matches spec/schemas/%s.schema.json (source of truth)',
    (name) => {
      const specSchema = loadJson(join(schemasDir, `${name}.schema.json`));
      expect(wdfSchemas[name], 'run `pnpm sync:schemas` to regenerate').toEqual(specSchema);
    },
  );
});

function fixtureFiles(schema: string, kind: 'valid' | 'invalid'): string[] {
  return readdirSync(join(fixturesDir, schema))
    .filter((f) => f.startsWith(`${kind}-`) && f.endsWith('.json'))
    .sort();
}

describe.each(['manifest', 'outline', 'hashes'] as const)('%s.schema.json', (schema) => {
  const validate = validators[schema as keyof SchemaValidators];

  it('has enough fixtures (≥3 valid, ≥5 invalid)', () => {
    expect(fixtureFiles(schema, 'valid').length).toBeGreaterThanOrEqual(3);
    expect(fixtureFiles(schema, 'invalid').length).toBeGreaterThanOrEqual(5);
  });

  describe('accepts valid fixtures', () => {
    it.each(fixtureFiles(schema, 'valid'))('%s', (file) => {
      const data = loadJson(join(fixturesDir, schema, file));
      const ok = validate(data);
      expect(ok, JSON.stringify(validate.errors, null, 2)).toBe(true);
    });
  });

  describe('rejects invalid fixtures', () => {
    it.each(fixtureFiles(schema, 'invalid'))('%s', (file) => {
      const data = loadJson(join(fixturesDir, schema, file));
      expect(validate(data)).toBe(false);
    });
  });
});
