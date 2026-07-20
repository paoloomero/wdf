import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { readPackage } from '@wdf/core';
import { describe, expect, it } from 'vitest';

import { cmdPack, cmdValidate, type Ctx } from '../src/commands.js';
import { readDirFiles } from '../src/lib/fsutil.js';

// CI guard for plan T5.1: the three public example documents must always
// pack into fully valid, verified packages.

const examplesDir = resolve(import.meta.dirname, '../../../examples');
const EXAMPLES = ['delibera-pa', 'report-dati', 'articolo-tecnico'];

function silent(): Ctx {
  return { log: () => undefined, err: () => undefined, out: () => undefined };
}

describe('example documents (T5.1 acceptance)', () => {
  const work = mkdtempSync(join(tmpdir(), 'wdf-examples-'));

  it.each(EXAMPLES)('%s packs and validates', async (name) => {
    const out = join(work, `${name}.wdf`);
    expect(await cmdPack(join(examplesDir, name), { output: out }, silent())).toBe(0);
    expect(await cmdValidate(out, {}, silent())).toBe(0);
  });

  it('delibera-pa exercises the dataset binding', async () => {
    const out = join(work, 'delibera-check.wdf');
    await cmdPack(join(examplesDir, 'delibera-pa'), { output: out }, silent());
    const pkg = readPackage(readFileSync(out));
    expect(pkg.manifest.datasets?.[0]?.path).toBe('data/impegni.json');
    expect(pkg.files.has('data/impegni.json')).toBe(true);
  });

  it('a broken dataset cell is caught end-to-end', async () => {
    // Copy the delibera and corrupt one displayed value: validation must fail.
    const src = readDirFiles(join(examplesDir, 'delibera-pa'));
    const dir = join(work, 'delibera-broken');
    for (const [path, data] of src) {
      const full = join(dir, ...path.split('/'));
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(
        full,
        path === 'content/index.html'
          ? new TextEncoder().encode(
              new TextDecoder().decode(data).replace('<td>14640</td>', '<td>14.640,00</td>'),
            )
          : data,
      );
    }
    const out = join(work, 'delibera-broken.wdf');
    expect(await cmdPack(dir, { output: out }, silent())).toBe(0);
    expect(await cmdValidate(out, {}, silent())).toBe(1);
  });
});
