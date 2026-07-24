import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { readPackage } from '@wdf/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { cmdImport, cmdValidate, type Ctx } from '../src/commands.js';
import { embedFonts } from '../src/import/fonts.js';

// WP9 acceptance (plan §10.19): --embed-fonts embeds metric-compatible open
// clones of referenced families, prepends them to the stacks, and declares
// the "fonts" extension; without the flag nothing changes.

const fixturesDir = resolve(import.meta.dirname, '../../../fixtures/import');

interface Capture extends Ctx {
  logs: string[];
}
function capture(): Capture {
  const c: Capture = {
    logs: [],
    log: (s) => c.logs.push(s),
    err: (s) => c.logs.push(s),
    out: () => undefined,
  };
  return c;
}

async function imp(
  name: string,
  extra: { embedFonts?: boolean; withSource?: boolean },
): Promise<{ bytes: Buffer; pkg: ReturnType<typeof readPackage>; run: Capture }> {
  const work = mkdtempSync(join(tmpdir(), 'wdf-fonts-'));
  const wdf = join(work, `${name}.wdf`);
  const run = capture();
  const code = await cmdImport(
    join(fixturesDir, `${name}.html`),
    { output: wdf, date: '2026-07-22T12:00:00Z', ...extra },
    run,
  );
  expect(code, run.logs.join('\n')).toBe(0);
  expect(await cmdValidate(wdf, {}, capture())).toBe(0);
  const bytes = readFileSync(wdf);
  return { bytes, pkg: readPackage(bytes), run };
}

const dec = new TextDecoder();

describe('fonts extension (WP9)', () => {
  let pkg: ReturnType<typeof readPackage>;
  let bytes: Buffer;

  beforeAll(async () => {
    // word-headings-it declares font-family:"Calibri",sans-serif.
    ({ pkg, bytes } = await imp('word-headings-it', { embedFonts: true }));
  });

  it('declares the extension and embeds the four Carlito faces', () => {
    expect(pkg.manifest.extensions).toEqual([{ name: 'fonts', version: '0.1' }]);
    for (const face of ['400-normal', '400-italic', '700-normal', '700-italic']) {
      expect(pkg.files.has(`ext/fonts/carlito-latin-${face}.woff2`)).toBe(true);
    }
    expect(pkg.files.has('ext/fonts/fonts.css')).toBe(true);
    expect(pkg.files.has('ext/fonts/fonts.json')).toBe(true);
  });

  it('prepends the clone to the stack in content/styles.css', () => {
    const css = dec.decode(pkg.files.get('content/styles.css'));
    expect(css).toContain('font-family: "Carlito", "Calibri",sans-serif');
    // The clone is declared under its own name only.
    const fontsCss = dec.decode(pkg.files.get('ext/fonts/fonts.css'));
    expect(fontsCss).toContain('font-family: "Carlito"');
    expect(fontsCss).not.toContain('Calibri');
  });

  it('embeds only referenced families (no Caladea for a Calibri document)', () => {
    expect([...pkg.files.keys()].some((p) => p.includes('caladea'))).toBe(false);
  });

  it('substitutes Arimo for a Google-Docs Arial document', async () => {
    const arial = await imp('gdocs-headings-en', { embedFonts: true });
    const css = dec.decode(arial.pkg.files.get('content/styles.css'));
    expect(css).toContain('"Arimo", "Arial"');
    expect(arial.pkg.files.has('ext/fonts/arimo-latin-400-normal.woff2')).toBe(true);
  });

  it('is byte-deterministic', async () => {
    const again = await imp('word-headings-it', { embedFonts: true });
    expect(again.bytes.equals(bytes)).toBe(true);
  });

  it('composes with --with-source, extensions sorted by name', async () => {
    const both = await imp('word-headings-it', { embedFonts: true, withSource: true });
    expect(both.pkg.manifest.extensions).toEqual([
      { name: 'fonts', version: '0.1' },
      { name: 'source', version: '0.2' },
    ]);
  });

  it('adds nothing when no family is substitutable', async () => {
    // word-styled-it uses Verdana/Garamond only.
    const none = await imp('word-styled-it', { embedFonts: true });
    expect(none.pkg.manifest.extensions).toBeUndefined();
    expect(none.run.logs.some((l) => l.includes('no substitutable font family'))).toBe(true);
  });

  it('leaves the default import untouched', async () => {
    const plain = await imp('word-headings-it', {});
    expect(plain.pkg.manifest.extensions).toBeUndefined();
    expect([...plain.pkg.files.keys()].some((p) => p.startsWith('ext/'))).toBe(false);
  });
});

describe('embedFonts unit behavior', () => {
  it('does not double-prepend when the clone is already in the stack', () => {
    const out = embedFonts('p { font-family: "Carlito", "Calibri", sans-serif; }');
    expect(out).toBeUndefined();
  });

  it('matches case-insensitively and unquoted names', () => {
    const out = embedFonts('p { font-family: times new roman, serif; }');
    expect(out?.stylesheet).toContain('"Tinos", times new roman, serif');
  });
});
