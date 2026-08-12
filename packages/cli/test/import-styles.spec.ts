import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { readPackage, validateStylesheet } from '@wdf-dev/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { cmdImport, cmdValidate, type Ctx } from '../src/commands.js';
import { parseStylesheet, sanitizeDeclarations, parseDeclarations } from '@wdf-dev/import';

// T7.2 acceptance (plan §10.7): the imported document keeps its typographic
// identity via a generated stylesheet; hostile constructs never survive;
// same fixture → byte-identical CSS.

const fixturesDir = resolve(import.meta.dirname, '../../../fixtures/import');

function silent(): Ctx {
  return { log: () => undefined, err: () => undefined, out: () => undefined };
}

let work: string;
let css: string;
let indexHtml: string;

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'wdf-styles-'));
  const out = join(work, 'styled.wdf');
  const code = await cmdImport(
    join(fixturesDir, 'word-styled-it.html'),
    { output: out, date: '2026-07-21T12:00:00Z' },
    silent(),
  );
  expect(code).toBe(0);
  expect(await cmdValidate(out, {}, silent())).toBe(0);
  const pkg = readPackage(readFileSync(out));
  css = new TextDecoder().decode(pkg.files.get('content/styles.css'));
  indexHtml = new TextDecoder().decode(pkg.files.get('content/index.html'));
});

describe('style translation (T7.2 acceptance)', () => {
  it('generates a stylesheet linked from the entry document', () => {
    expect(indexHtml).toContain('<link rel="stylesheet" href="content/styles.css" />');
    expect(css).toContain('article {');
  });

  it('preserves typographic identity: fonts, colors, alignment, table look', () => {
    expect(css).toContain('color: #1F3864');
    expect(css).toContain('font-family: "Verdana", sans-serif');
    expect(css).toContain('font-family: "Garamond",serif');
    expect(css).toContain('text-align: center');
    expect(css).toContain('text-align: right');
    expect(css).toContain('background-color: #FFF2CC');
    expect(css).toContain('border: 1pt solid #BF9000');
    expect(css).toContain('background-color: #EEF2F7');
    // Inline span color survives too.
    expect(css).toContain('color: red');
  });

  it('assigns deterministic classes in document order', () => {
    expect(indexHtml).toMatch(/<h1 class="w\d+" id="h-circolare-interna-n-12-2026">/);
    // Same input → byte-identical CSS and HTML.
  });

  it('never lets hostile or layout-breaking constructs through', () => {
    expect(css).not.toContain('url(');
    expect(css).not.toContain('position');
    expect(css).not.toContain('mso-');
    expect(css).not.toContain('@page');
    expect(validateStylesheet(css)).toEqual([]);
  });

  it('is byte-deterministic across runs', async () => {
    const again = join(work, 'styled-2.wdf');
    await cmdImport(
      join(fixturesDir, 'word-styled-it.html'),
      { output: again, date: '2026-07-21T12:00:00Z' },
      silent(),
    );
    expect(readFileSync(again)).toEqual(readFileSync(join(work, 'styled.wdf')));
  });
});

describe('style primitives', () => {
  it('drops non-whitelisted and unsafe declarations', () => {
    const decls = sanitizeDeclarations(
      parseDeclarations(
        'color: navy; position: fixed; background: url(https://x/y.png); mso-pagination: none; font-family: Consolas',
      ),
    );
    expect([...decls.keys()]).toEqual(['color', 'font-family']);
    expect(decls.get('font-family')).toBe('Consolas, monospace');
  });

  it('parses Word stylesheets, skipping @page and comments', () => {
    const rules = parseStylesheet(
      '/* c */ @page X {size:1pt;} p.MsoNormal, h1 {color:red;} .cls {font-size:12pt;}',
    );
    expect(rules).toHaveLength(3);
    expect(rules[0]).toMatchObject({ tag: 'p', cls: 'MsoNormal' });
    expect(rules[1]).toMatchObject({ tag: 'h1' });
    expect(rules[2]).toMatchObject({ cls: 'cls' });
  });
});
