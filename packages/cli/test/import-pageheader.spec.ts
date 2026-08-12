import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { readPackage } from '@wdf-dev/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { cmdExtract, cmdImport, cmdValidate, type Ctx } from '../src/commands.js';
import {
  el,
  promoteHeadings,
  isPageResidue,
  preprocessHeaderHtml,
  STYLE_TMP_ATTR,
} from '@wdf-dev/import';

// T14.1 acceptance (plan §10.21): Word page headers/footers from the
// support folder's header.html enter the document once, as <header> and
// <footer>; page-number fields and their residue are dropped.

const fixturesDir = resolve(import.meta.dirname, '../../../fixtures/import');

interface Capture extends Ctx {
  logs: string[];
  stdout: string[];
}
function capture(): Capture {
  const c: Capture = {
    logs: [],
    stdout: [],
    log: (s) => c.logs.push(s),
    err: (s) => c.logs.push(s),
    out: (s) => c.stdout.push(s),
  };
  return c;
}

let run: Capture;
let indexHtml: string;
let md: string;
let pkg: ReturnType<typeof readPackage>;

beforeAll(async () => {
  const work = mkdtempSync(join(tmpdir(), 'wdf-pagehdr-'));
  const wdf = join(work, 'word-header-it.wdf');
  run = capture();
  const code = await cmdImport(
    join(fixturesDir, 'word-header-it.html'),
    { output: wdf, date: '2026-07-23T12:00:00Z' },
    run,
  );
  expect(code, run.logs.join('\n')).toBe(0);
  expect(await cmdValidate(wdf, {}, capture())).toBe(0);
  pkg = readPackage(readFileSync(wdf));
  indexHtml = new TextDecoder().decode(pkg.files.get('content/index.html'));
  const extraction = capture();
  cmdExtract(wdf, {}, extraction);
  md = extraction.stdout.join('');
});

describe('page header/footer import (T14.1)', () => {
  it('places the first-page header at the top of the article', () => {
    expect(indexHtml).toMatch(/<article>\s*<header>/);
    expect(indexHtml).toContain('Ente di Prova — Direzione Generale');
    // The first-page variant wins over the running header.
    expect(indexHtml).not.toContain('Intestazione delle pagine correnti');
  });

  it('recovers the header logo hidden in the VML conditional comment', () => {
    expect(indexHtml).toMatch(/<header>[\s\S]*?<img src="content\/assets\/[0-9a-f]+\.svg"/);
    expect([...pkg.files.keys()].some((p) => /^content\/assets\/[0-9a-f]+\.svg$/.test(p))).toBe(
      true,
    );
  });

  it('places the footer at the end and drops page-number content', () => {
    expect(indexHtml).toMatch(/<footer>[\s\S]*?<\/footer>\s*<\/article>/);
    expect(indexHtml).toContain('Società Esempio S.r.l.');
    expect(indexHtml).not.toMatch(/>2 di 6</);
    expect(indexHtml).not.toContain(' di 6');
    expect(run.logs.some((l) => l.includes('page-number paragraph'))).toBe(true);
  });

  it('reports the import and keeps the AI layer aligned', () => {
    expect(run.logs.some((l) => l.includes('imported the Word page header'))).toBe(true);
    expect(run.logs.some((l) => l.includes('imported the Word page footer'))).toBe(true);
    expect(md).toContain('Ente di Prova');
    expect(md).toContain('Società Esempio S.r.l.');
  });
});

describe('page header helpers', () => {
  it('preprocessHeaderHtml removes PAGE fields, keeps other fields', () => {
    const page =
      "<!--[if supportFields]><span style='mso-element:field-begin'></span> PAGE <span style='mso-element:field-separator'></span><![endif]--><span>7</span><!--[if supportFields]><span style='mso-element:field-end'></span><![endif]-->";
    const other =
      "<!--[if supportFields]><span style='mso-element:field-begin'></span> DATE <span style='mso-element:field-separator'></span><![endif]--><span>23/07/2026</span><!--[if supportFields]><span style='mso-element:field-end'></span><![endif]-->";
    expect(preprocessHeaderHtml(page)).toBe('');
    expect(preprocessHeaderHtml(other)).toContain('23/07/2026');
  });

  it('preprocessHeaderHtml reveals VML conditional comments', () => {
    const vml = '<!--[if gte vml 1]><v:shape><v:imagedata src="x.png"/></v:shape><![endif]-->';
    expect(preprocessHeaderHtml(vml)).toBe('<v:shape><v:imagedata src="x.png"/></v:shape>');
  });

  it('isPageResidue matches counter leftovers, not real content', () => {
    expect(isPageResidue('di')).toBe(true);
    expect(isPageResidue('Pag. di')).toBe(true);
    expect(isPageResidue('2 / 6')).toBe(true);
    expect(isPageResidue('Società Esempio S.r.l.')).toBe(false);
  });

  it('never promotes a header paragraph to a heading', () => {
    const report: string[] = [];
    const blocks = [
      el('header', {}, [el('p', { [STYLE_TMP_ATTR]: 'font-size:24.0pt' }, ['Big letterhead'])]),
      el('p', { [STYLE_TMP_ATTR]: 'font-size:12.0pt' }, [
        'Body text long enough to dominate the statistics.',
      ]),
    ];
    promoteHeadings(blocks, report);
    const inner = blocks[0]?.children[0];
    expect(typeof inner !== 'string' && inner?.tag).toBe('p');
  });
});
