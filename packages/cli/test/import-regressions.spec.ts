import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { readPackage } from '@wdf-dev/core';
import { describe, expect, it } from 'vitest';

import { makeDocx, W_NS } from '../../import/test/docx-fixtures.js';
import { cmdImport, type Ctx } from '../src/commands.js';

// Plan §10.93: regressions fixed after the first checks on the 0.2.0 from
// npm — what the help says, what the CLI says about an attached PDF, and a
// binary .docx never read as text.

const root = resolve(import.meta.dirname, '../../..');
const dec = new TextDecoder();

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

const DOCUMENT =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<w:document xmlns:w="${W_NS}"><w:body>` +
  '<w:p><w:r><w:t>Il testo del documento.</w:t></w:r></w:p>' +
  '</w:body></w:document>';

describe('wdf import --help', () => {
  const src = readFileSync(join(root, 'packages/cli/src/index.ts'), 'utf8');
  const block = src.slice(src.indexOf(".command('import')"), src.indexOf(".command('new')"));

  it('names .docx among the inputs', () => {
    expect(block).toContain("'input file (.docx, .html or .md) or an http(s) URL'");
    expect(block).toMatch(/\.description\(\s*'[^']*Word \.docx/);
  });

  it('quotes no extension version number (the package declares the real one)', () => {
    expect(block).not.toMatch(/ext-source \d|"source" \d/);
  });
});

describe('wdf import --with-pdf: the PDF is not compared', () => {
  it('warns on the console and records it in the conversion report', async () => {
    const work = mkdtempSync(join(tmpdir(), 'wdf-reg-'));
    const docx = join(work, 'report.docx');
    writeFileSync(docx, makeDocx({ document: DOCUMENT }));
    // Any PDF is accepted: nothing ties it to the document.
    const pdf = join(work, 'altro.pdf');
    writeFileSync(pdf, new TextEncoder().encode('%PDF-1.4\n1 0 obj\nendobj\n%%EOF\n'));
    const wdf = join(work, 'report.wdf');
    const run = capture();
    expect(await cmdImport(docx, { output: wdf, withSource: true, withPdf: pdf }, run)).toBe(0);

    expect(run.logs).toContain(
      'warning: altro.pdf is included as-is — it is NOT compared with the document content (docs/ext-source.md)',
    );
    const pkg = readPackage(readFileSync(wdf));
    const report = dec.decode(pkg.files.get('ext/source/report.json'));
    expect(report).toContain('included as-is, not compared with the document content');
  });

  it('says nothing of the kind without a PDF', async () => {
    const work = mkdtempSync(join(tmpdir(), 'wdf-reg-'));
    const docx = join(work, 'report.docx');
    writeFileSync(docx, makeDocx({ document: DOCUMENT }));
    const run = capture();
    expect(await cmdImport(docx, { output: join(work, 'r.wdf'), withSource: true }, run)).toBe(0);
    expect(run.logs.join('\n')).not.toContain('compared');
  });
});

describe('a binary .docx is never read as text', () => {
  for (const name of ['report.docx', 'report.html', 'report.md', 'report']) {
    it(`"${name}": the AI layer holds the document text, no ZIP bytes`, async () => {
      const work = mkdtempSync(join(tmpdir(), 'wdf-reg-'));
      const input = join(work, name);
      writeFileSync(input, makeDocx({ document: DOCUMENT }));
      const wdf = join(work, 'out.wdf');
      expect(await cmdImport(input, { output: wdf }, capture())).toBe(0);
      const pkg = readPackage(readFileSync(wdf));
      const md = dec.decode(pkg.files.get('ai/content.md'));
      expect(md).toContain('Il testo del documento.');
      expect(md).not.toContain('PK');
      expect(md).not.toContain('�');
      expect(md).not.toContain('document.xml');
      // Only printable text and line breaks.
      expect(md).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
    });
  }
});
