import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { readPackage } from '@wdf-dev/core';
import { describe, expect, it } from 'vitest';

import { makeDocx, W_NS } from '../../import/test/docx-fixtures.js';
import { cmdImport, cmdValidate, type Ctx } from '../src/commands.js';

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

// Plan §10.97: the first command a visitor copies from the home page must give
// the file the page talks about — a .wdf.html anyone can open — and validate.
describe('the import command shown on the home page', () => {
  for (const page of ['site/index.html', 'site/it/index.html']) {
    it(`${page}: produces a valid .wdf.html with the original and the PDF inside`, async () => {
      const html = readFileSync(join(root, page), 'utf8');
      const start = html.indexOf('npx @wdf-dev/cli import');
      expect(start).toBeGreaterThan(-1);
      const command = html.slice(start, html.indexOf('<span', start)).replace(/\\\n/g, ' ');
      const flags = new Set(command.match(/--[a-z-]+/g) ?? []);
      expect([...flags].sort()).toEqual(['--standalone', '--with-pdf', '--with-source']);

      const work = mkdtempSync(join(tmpdir(), 'wdf-home-'));
      const docx = join(work, 'report.docx');
      const pdf = join(work, 'report.pdf');
      writeFileSync(docx, makeDocx({ document: DOCUMENT }));
      writeFileSync(pdf, new TextEncoder().encode('%PDF-1.4\n1 0 obj\nendobj\n%%EOF\n'));
      const run = capture();
      const code = await cmdImport(
        docx,
        {
          output: join(work, 'report.wdf'),
          withSource: flags.has('--with-source'),
          withPdf: pdf,
          standalone: flags.has('--standalone'),
        },
        run,
      );
      expect(code, run.logs.join('\n')).toBe(0);
      const standalone = readdirSync(work).find((f) => f.endsWith('.wdf.html'));
      expect(standalone, readdirSync(work).join(', ')).toBeDefined();
      expect(await cmdValidate(join(work, standalone ?? ''), {}, capture())).toBe(0);
    });
  }
});

// Plan §10.97: validate says it too — a package that carries the author's PDF
// carries it as-is, not compared. Informative: the verdict does not change.
describe("wdf validate on a package with the author's PDF", () => {
  async function build(withPdf: boolean): Promise<string> {
    const work = mkdtempSync(join(tmpdir(), 'wdf-val-'));
    const docx = join(work, 'report.docx');
    writeFileSync(docx, makeDocx({ document: DOCUMENT }));
    const pdf = join(work, 'altro.pdf');
    writeFileSync(pdf, new TextEncoder().encode('%PDF-1.4\n1 0 obj\nendobj\n%%EOF\n'));
    const wdf = join(work, 'report.wdf');
    const opts = withPdf
      ? { output: wdf, withSource: true, withPdf: pdf }
      : { output: wdf, withSource: true };
    expect(await cmdImport(docx, opts, capture())).toBe(0);
    return wdf;
  }

  it('prints the note, and stays VALID', async () => {
    const run = capture();
    expect(await cmdValidate(await build(true), {}, run)).toBe(0);
    expect(run.logs).toContain(
      "note: includes the author's PDF (altro.pdf): included as-is, not compared with the content (docs/ext-source.md)",
    );
    expect(run.logs.at(-1)).toMatch(/^VALID: 0 error\(s\)/);
  });

  it('--json carries it as authorPdf.compared = false', async () => {
    const run = capture();
    expect(await cmdValidate(await build(true), { json: true }, run)).toBe(0);
    const json = JSON.parse(run.logs.join('\n')) as {
      authorPdf?: { name: string; compared: boolean };
    };
    expect(json.authorPdf).toEqual({ name: 'altro.pdf', compared: false });
  });

  it('says nothing without a PDF', async () => {
    const run = capture();
    expect(await cmdValidate(await build(false), {}, run)).toBe(0);
    expect(run.logs.join('\n')).not.toContain("author's PDF");
  });
});
