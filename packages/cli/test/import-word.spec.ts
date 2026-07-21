import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { cmdExtract, cmdImport, cmdValidate, type Ctx } from '../src/commands.js';
import { decodeHtml } from '../src/import/encoding.js';

// T7.1 acceptance (plan §10.7): real-world Word "filtered web page" exports
// and saved web pages import into valid packages; charset declarations are
// honored; Word spacer paragraphs never survive.

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

let work: string;
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'wdf-word-'));
});

async function importFixture(name: string): Promise<{ run: Capture; wdf: string; md: string }> {
  const wdf = join(work, `${name}.wdf`);
  const run = capture();
  const code = await cmdImport(
    join(fixturesDir, `${name}.html`),
    { output: wdf, date: '2026-07-21T12:00:00Z' },
    run,
  );
  expect(code, run.logs.join('\n')).toBe(0);
  expect(await cmdValidate(wdf, {}, capture())).toBe(0);
  const extraction = capture();
  cmdExtract(wdf, {}, extraction);
  return { run, wdf, md: extraction.stdout.join('') };
}

describe('decodeHtml', () => {
  it('honors a windows-1252 charset declaration', () => {
    const bytes = new Uint8Array([
      // "<meta charset=windows-1252>è€"
      ...new TextEncoder().encode('<meta charset=windows-1252>'),
      0xe8, // è in cp1252
      0x80, // € in cp1252
    ]);
    const { text, encoding } = decodeHtml(bytes);
    expect(encoding).toBe('windows-1252');
    expect(text.endsWith('è€')).toBe(true);
  });

  it('falls back to windows-1252 when bytes are not valid UTF-8', () => {
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('<p>caff'),
      0xe8,
      0x3c,
      0x2f,
      0x70,
      0x3e,
    ]);
    const { text, encoding } = decodeHtml(bytes);
    expect(encoding).toBe('windows-1252');
    expect(text).toContain('caffè');
  });

  it('strips a UTF-8 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('<p>ok</p>')]);
    expect(decodeHtml(bytes).text.startsWith('<p>ok')).toBe(true);
  });
});

describe('Word filtered export (T7.1 acceptance)', () => {
  it('imports into a valid package with title mapping and no spacer paragraphs', async () => {
    const { run, md } = await importFixture('word-filtered-it');
    // MsoTitle became the h1.
    expect(md).toContain('# Verbale della riunione di coordinamento');
    expect(run.logs.some((l) => l.includes('MsoTitle'))).toBe(true);
    // Spacer paragraphs (<o:p>&nbsp;</o:p>) are gone: no anchor-only blocks.
    expect(md).not.toMatch(/^\{#p-\d+\}$/m);
    expect(md).not.toMatch(/^ \{#p-\d+\}$/m);
    expect(run.logs.some((l) => l.includes('spacer paragraph'))).toBe(true);
    // Structure survived.
    expect(md).toContain('- approvazione del verbale precedente; {#li-0001}');
    expect(md).toContain('| Migrazione archivio | 2026-09-15 |');
    expect(md).toContain('**area tecnica**');
  });
});

describe('windows-1252 Word export', () => {
  it('decodes accented characters and the euro sign correctly', async () => {
    const { run, md } = await importFixture('word-1252-it');
    expect(run.logs.some((l) => l.includes('windows-1252'))).toBe(true);
    expect(md).toContain('# Nota spese di missione — città di Périgueux');
    expect(md).toContain('350€');
    expect(md).toContain('Perché la trasferta è durata più di un giorno');
    // The curly apostrophe (cp1252 0x92) survives as ’.
    expect(md).toContain('l’indennità');
  });
});

describe('saved web page', () => {
  it('imports the article content and drops chrome/scripts/external images', async () => {
    const { run, md } = await importFixture('saved-webpage-en');
    expect(md).toContain('# How rivers shape valleys');
    expect(md).toContain('**erosion**');
    expect(md).toContain('1. youthful, with steep gradients; {#li-0001}');
    // The head (with its script tag) is never traversed; the external image
    // in the body is reported as dropped.
    expect(run.logs.some((l) => l.includes('images.example.org'))).toBe(true);
    expect(md).not.toContain('analytics');
  });
});
