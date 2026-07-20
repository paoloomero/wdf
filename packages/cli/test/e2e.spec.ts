import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { readPackage } from '@wdf/core';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  cmdExtract,
  cmdImport,
  cmdNew,
  cmdPack,
  cmdUnpack,
  cmdValidate,
  type Ctx,
} from '../src/commands.js';

const goldenDir = resolve(import.meta.dirname, '../../../fixtures/golden');

interface Capture extends Ctx {
  logs: string[];
  errs: string[];
  stdout: string[];
}

function capture(): Capture {
  const c: Capture = {
    logs: [],
    errs: [],
    stdout: [],
    log: (s) => c.logs.push(s),
    err: (s) => c.errs.push(s),
    out: (s) => c.stdout.push(s),
  };
  return c;
}

let work: string;
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'wdf-e2e-'));
});

describe('new → edit → pack → validate → extract (WP3 acceptance)', () => {
  it('runs the full lifecycle on a tmpdir', async () => {
    const dir = join(work, 'doc');
    expect(cmdNew(dir, capture())).toBe(0);

    // Edit: add a paragraph to the scaffold.
    const indexPath = join(dir, 'content', 'index.html');
    const html = readFileSync(indexPath, 'utf8').replace(
      '</section>',
      '<p id="p-0002">A freshly edited paragraph.</p></section>',
    );
    writeFileSync(indexPath, html);

    const out = join(work, 'doc.wdf');
    expect(await cmdPack(dir, { output: out }, capture())).toBe(0);

    const validation = capture();
    expect(await cmdValidate(out, {}, validation)).toBe(0);
    expect(validation.logs.at(-1)).toContain('VALID');

    const extraction = capture();
    expect(cmdExtract(out, {}, extraction)).toBe(0);
    const markdown = extraction.stdout.join('');
    expect(markdown).toContain('A freshly edited paragraph. {#p-0002}');
    expect(markdown).toContain('# New WDF document {#h-start} {#sec-start}');

    const outlineRun = capture();
    expect(cmdExtract(out, { outline: true }, outlineRun)).toBe(0);
    expect(JSON.parse(outlineRun.stdout.join('')).length).toBeGreaterThan(2);
  });

  it('unpack → pack is byte-identical (pack determinism through the CLI)', async () => {
    const out = join(work, 'doc.wdf');
    const unpacked = join(work, 'doc-unpacked');
    expect(cmdUnpack(out, unpacked, capture())).toBe(0);
    const repacked = join(work, 'doc2.wdf');
    expect(await cmdPack(unpacked, { output: repacked }, capture())).toBe(0);
    expect(readFileSync(repacked)).toEqual(readFileSync(out));
  });

  it('validate detects a tampered package (exit 1)', async () => {
    const out = join(work, 'doc.wdf');
    const bytes = readFileSync(out);
    // Flip one byte in the middle of the archive.
    bytes[Math.floor(bytes.length / 2)] = (bytes[Math.floor(bytes.length / 2)] ?? 0) ^ 0xff;
    const tampered = join(work, 'tampered.wdf');
    writeFileSync(tampered, bytes);
    expect(await cmdValidate(tampered, {}, capture())).toBe(1);
  });
});

describe('pack --standalone (spec §9)', () => {
  it('embeds the canonical package, re-extractable byte-for-byte (§9.2)', async () => {
    const dir = join(work, 'doc');
    const wdfPath = join(work, 'doc3.wdf');
    const htmlPath = join(work, 'doc3.html');
    expect(await cmdPack(dir, { output: wdfPath }, capture())).toBe(0);
    expect(await cmdPack(dir, { output: htmlPath, standalone: true }, capture())).toBe(0);

    const html = readFileSync(htmlPath, 'utf8');
    const match = /<script type="application\/wdf\+zip" id="wdf-package">([^<]*)<\/script>/.exec(
      html,
    );
    expect(match).not.toBeNull();
    const embedded = Uint8Array.from(Buffer.from((match?.[1] ?? '').trim(), 'base64'));
    expect(embedded).toEqual(new Uint8Array(readFileSync(wdfPath)));
    expect(() => readPackage(embedded)).not.toThrow();
  });
});

describe('import (T3.4 acceptance)', () => {
  it.each(['appendix-a', 'delibera-mini', 'report-mini', 'articolo-mini'])(
    'imports golden %s input.html into a package that passes validate',
    async (name) => {
      const out = join(work, `import-${name}.wdf`);
      const code = await cmdImport(
        join(goldenDir, name, 'input.html'),
        { output: out, date: '2026-07-18T12:00:00Z' },
        capture(),
      );
      expect(code).toBe(0);
      expect(await cmdValidate(out, {}, capture())).toBe(0);
    },
  );

  it('imports Markdown into a package that passes validate', async () => {
    const md = [
      '# Relazione di prova',
      '',
      'Un paragrafo con **grassetto**, *corsivo*, `codice` e un [link](https://example.org/x).',
      'Continuazione della riga.',
      '',
      '## Elenco',
      '',
      '- primo',
      '- secondo',
      '  - annidato',
      '',
      '> Una citazione.',
      '',
      '```js',
      'const x = 1;',
      '```',
      '',
      '| anno | importo |',
      '| --- | --- |',
      '| 2025 | 1200.5 |',
      '',
      '---',
      '',
      'Chiusura.',
    ].join('\n');
    const mdPath = join(work, 'relazione.md');
    writeFileSync(mdPath, md);

    const out = join(work, 'relazione.wdf');
    const run = capture();
    const code = await cmdImport(
      mdPath,
      { output: out, lang: 'it', date: '2026-07-18T12:00:00Z' },
      run,
    );
    expect(code, run.errs.join('\n')).toBe(0);
    expect(await cmdValidate(out, {}, capture())).toBe(0);

    const extraction = capture();
    cmdExtract(out, {}, extraction);
    const markdown = extraction.stdout.join('');
    expect(markdown).toContain('# Relazione di prova {#h-relazione-di-prova}');
    expect(markdown).toContain('**grassetto**');
    expect(markdown).toContain('- primo {#li-0001}');
    expect(markdown).toContain('| anno | importo |');
  });

  it('import is deterministic given a fixed date', async () => {
    const a = join(work, 'det-a.wdf');
    const b = join(work, 'det-b.wdf');
    const input = join(goldenDir, 'appendix-a', 'input.html');
    await cmdImport(input, { output: a, date: '2026-07-18T12:00:00Z' }, capture());
    await cmdImport(input, { output: b, date: '2026-07-18T12:00:00Z' }, capture());
    expect(readFileSync(b)).toEqual(readFileSync(a));
  });

  it('sanitizes hostile HTML and reports the drops', async () => {
    const hostile = [
      '<!DOCTYPE html><html><head><title>Hostile</title></head><body>',
      '<div><h1>Title</h1>',
      '<script>alert(1)</script>',
      '<p style="color:red" onclick="x()">Text with <font>font</font> and <b>bold</b>.</p>',
      '<img src="https://evil.example/x.png" alt="ext">',
      '<a href="javascript:alert(1)">bad link</a>',
      '</div></body></html>',
    ].join('\n');
    const input = join(work, 'hostile.html');
    writeFileSync(input, hostile);

    const out = join(work, 'hostile.wdf');
    const run = capture();
    const code = await cmdImport(input, { output: out, date: '2026-07-18T12:00:00Z' }, run);
    expect(code, run.errs.join('\n')).toBe(0);
    expect(await cmdValidate(out, {}, capture())).toBe(0);
    expect(run.logs.some((l) => l.includes('script'))).toBe(true);
    expect(run.logs.some((l) => l.includes('evil.example'))).toBe(true);

    const extraction = capture();
    cmdExtract(out, {}, extraction);
    const markdown = extraction.stdout.join('');
    expect(markdown).toContain('**bold**');
    expect(markdown).not.toContain('alert');
  });
});
