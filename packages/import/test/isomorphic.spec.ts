import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// T7.5 acceptance (plan §10.24): @wdf-dev/import is isomorphic — the pipeline
// must run unchanged in the browser, so no module may reach for Node-only
// APIs. Environment access (filesystem, fonts on disk) is injected by the
// host instead. External dependencies are the declared, isomorphic ones only
// (saxes and fflate arrived with the docx importer, WP20 T20.1).

const srcDir = join(import.meta.dirname, '../src');
const ALLOWED_EXTERNALS = new Set(['@wdf-dev/core', 'saxes', 'fflate']);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(join(entry.parentPath, entry.name));
    }
  }
  return out.sort();
}

describe('@wdf-dev/import stays isomorphic', () => {
  it('imports no node:* module and only the declared isomorphic externals', () => {
    const files = sourceFiles(srcDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const specifiers = [...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1] ?? '');
      for (const spec of specifiers) {
        expect(spec, `${file} imports ${spec}`).not.toMatch(/^node:/);
        if (!spec.startsWith('./') && !spec.startsWith('../')) {
          expect(ALLOWED_EXTERNALS.has(spec), `${file} imports ${spec}`).toBe(true);
        }
      }
      expect(text, `${file} uses Buffer`).not.toMatch(/\bBuffer\b/);
    }
  });
});
