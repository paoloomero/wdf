import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// T7.5 acceptance (plan §10.24): @wdf/import is isomorphic — the pipeline
// must run unchanged in the browser, so no module may reach for Node-only
// APIs. Environment access (filesystem, fonts on disk) is injected by the
// host instead.

const srcDir = join(import.meta.dirname, '../src');

describe('@wdf/import stays isomorphic', () => {
  it('imports no node:* module and only depends on @wdf/core', () => {
    for (const name of readdirSync(srcDir).sort()) {
      const text = readFileSync(join(srcDir, name), 'utf8');
      const specifiers = [...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1] ?? '');
      for (const spec of specifiers) {
        expect(spec, `${name} imports ${spec}`).not.toMatch(/^node:/);
        if (!spec.startsWith('./')) {
          expect(spec, `${name} imports ${spec}`).toBe('@wdf/core');
        }
      }
      expect(text, `${name} uses Buffer`).not.toMatch(/\bBuffer\b/);
    }
  });
});
