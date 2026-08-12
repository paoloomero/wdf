// Regenerates packages/core/src/schemas.data.ts from spec/schemas/*.json.
// The spec files are the source of truth; a test asserts the copies match.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const load = (name) =>
  JSON.stringify(JSON.parse(readFileSync(join(root, 'spec/schemas', name), 'utf8')), null, 2);

const out = `// GENERATED FILE — do not edit. Source of truth: spec/schemas/*.json.
// Regenerate with: pnpm sync:schemas

export const manifestSchema: object = ${load('manifest.schema.json')};

export const outlineSchema: object = ${load('outline.schema.json')};

export const hashesSchema: object = ${load('hashes.schema.json')};

export const captureSchema: object = ${load('capture.schema.json')};

export const paginationSchema: object = ${load('pagination.schema.json')};
`;

writeFileSync(join(root, 'packages/core/src/schemas.data.ts'), out);
console.log('packages/core/src/schemas.data.ts regenerated');
