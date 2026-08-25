import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { readPackage } from '@wdf-dev/core';
import { describe, expect, it } from 'vitest';

import { makeDocx, W_NS } from '../../import/test/docx-fixtures.js';
import { cmdImport, cmdValidate, type Ctx } from '../src/commands.js';

// WP21 (plan §10.57, docs/ext-source.md 0.5): --with-pdf embeds the
// author's PDF rendition next to the source. The pipeline never generates
// or parses a PDF — it embeds the author's bytes verbatim; the rendition
// cannot travel without the source extension.

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

interface SourceJson {
  source: string;
  kind?: string;
  visual?: { path: string; mediaType: string; name: string };
}

const PDF_BYTES = new TextEncoder().encode('%PDF-1.4\n1 0 obj\nendobj\n%%EOF\n');

function writePdf(dir: string, name = 'delibera.pdf'): string {
  const path = join(dir, name);
  writeFileSync(path, PDF_BYTES);
  return path;
}

describe('wdf import --with-pdf (ext-source 0.5, WP21)', () => {
  it('refuses --with-pdf without --with-source', async () => {
    const work = mkdtempSync(join(tmpdir(), 'wdf-visual-'));
    const run = capture();
    const code = await cmdImport(
      join(fixturesDir, 'cell-image-it.html'),
      { output: join(work, 'x.wdf'), withPdf: writePdf(work) },
      run,
    );
    expect(code).toBe(2);
    expect(run.logs.join('\n')).toContain('--with-pdf requires --with-source');
  });

  it('refuses a file without the %PDF- signature', async () => {
    const work = mkdtempSync(join(tmpdir(), 'wdf-visual-'));
    const notPdf = join(work, 'fake.pdf');
    writeFileSync(notPdf, 'just text');
    const run = capture();
    const code = await cmdImport(
      join(fixturesDir, 'cell-image-it.html'),
      { output: join(work, 'x.wdf'), withSource: true, withPdf: notPdf },
      run,
    );
    expect(code).toBe(2);
    expect(run.logs.join('\n')).toContain('not a PDF');
  });

  it('embeds the rendition verbatim and bumps the extension to 0.5 (html input)', async () => {
    const work = mkdtempSync(join(tmpdir(), 'wdf-visual-'));
    const wdf = join(work, 'doc.wdf');
    const run = capture();
    const code = await cmdImport(
      join(fixturesDir, 'cell-image-it.html'),
      {
        output: wdf,
        date: '2026-08-25T12:00:00Z',
        withSource: true,
        withPdf: writePdf(work),
      },
      run,
    );
    expect(code, run.logs.join('\n')).toBe(0);
    expect(await cmdValidate(wdf, {}, capture())).toBe(0);

    const pkg = readPackage(readFileSync(wdf));
    expect(pkg.manifest.extensions).toEqual([{ name: 'source', version: '0.5' }]);
    const sourceJson = JSON.parse(
      new TextDecoder().decode(pkg.files.get('ext/source/source.json')),
    ) as SourceJson;
    expect(sourceJson.source).toBe('0.5');
    expect(sourceJson.visual).toBeDefined();
    expect(sourceJson.visual?.mediaType).toBe('application/pdf');
    expect(sourceJson.visual?.name).toBe('delibera.pdf');
    expect(sourceJson.visual?.path).toMatch(/^ext\/source\/[0-9a-f]{16}\.pdf$/);
    const embedded = pkg.files.get(sourceJson.visual?.path ?? '');
    expect(embedded).toBeDefined();
    expect(Buffer.from(embedded ?? new Uint8Array()).equals(Buffer.from(PDF_BYTES))).toBe(true);
    expect(run.logs.join('\n')).toContain("embedded the author's PDF rendition");
  });

  it('rides along a binary docx source (the ratified use case)', async () => {
    const work = mkdtempSync(join(tmpdir(), 'wdf-visual-'));
    const docxPath = join(work, 'doc.docx');
    writeFileSync(
      docxPath,
      makeDocx({
        document:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          `<w:document xmlns:w="${W_NS}"><w:body>` +
          '<w:p><w:r><w:t>Un paragrafo.</w:t></w:r></w:p>' +
          '</w:body></w:document>',
      }),
    );
    const wdf = join(work, 'doc.wdf');
    const run = capture();
    const code = await cmdImport(
      docxPath,
      { output: wdf, withSource: true, withPdf: writePdf(work, 'doc.pdf') },
      run,
    );
    expect(code, run.logs.join('\n')).toBe(0);
    expect(await cmdValidate(wdf, {}, capture())).toBe(0);

    const pkg = readPackage(readFileSync(wdf));
    expect(pkg.manifest.extensions).toEqual([{ name: 'source', version: '0.5' }]);
    const sourceJson = JSON.parse(
      new TextDecoder().decode(pkg.files.get('ext/source/source.json')),
    ) as SourceJson;
    expect(sourceJson.kind).toBe('binary');
    expect(sourceJson.visual?.name).toBe('doc.pdf');
    expect(pkg.files.has(sourceJson.visual?.path ?? '')).toBe(true);
  });
});
