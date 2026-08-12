import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parsePaginationExt, readPackage } from '@wdf-dev/core';
import { describe, expect, it } from 'vitest';

import { makeDocx, W_NS } from '../../import/test/docx-fixtures.js';
import { cmdImport, cmdValidate, type Ctx } from '../src/commands.js';

// WP20 T20.8 (plan §10.47): ingress — `wdf import file.docx` routes by
// CONTENT to the native importer; the package carries the pagination
// extension and (with --with-source) the original as an ext-source 0.4
// binary; the manifest date comes from docProps/core.xml, so the same
// file yields a byte-identical package with no --date.

function silent(): Ctx {
  return { log: () => undefined, err: () => undefined, out: () => undefined };
}

const dec = new TextDecoder();

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<w:styles xmlns:w="${W_NS}">` +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/><w:lang w:val="it-IT"/></w:rPr></w:rPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:styleId="Titolo1"><w:name w:val="heading 1"/>' +
  '<w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>' +
  '</w:styles>';

const CORE_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
  'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
  '<dc:title>Delibera di prova</dc:title>' +
  '<dcterms:modified xsi:type="dcterms:W3CDTF">2026-08-01T09:30:00Z</dcterms:modified>' +
  '</cp:coreProperties>';

function fixtureDocx(): Uint8Array {
  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W_NS}"><w:body>` +
    '<w:p><w:pPr><w:pStyle w:val="Titolo1"/></w:pPr><w:r><w:t>Delibera di prova</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Prima pagina.</w:t><w:br w:type="page"/></w:r></w:p>' +
    '<w:p><w:r><w:t>Seconda pagina.</w:t></w:r></w:p>' +
    '<w:sectPr/></w:body></w:document>';
  return makeDocx({
    document,
    extra: { 'word/styles.xml': STYLES_XML, 'docProps/core.xml': CORE_XML },
  });
}

async function importFixture(
  bytes: Uint8Array,
  extraArgs: Parameters<typeof cmdImport>[1] = {},
): Promise<Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), 'wdf-docx-'));
  const inputPath = join(dir, 'documento.docx');
  const outputPath = join(dir, 'out.wdf');
  writeFileSync(inputPath, bytes);
  const code = await cmdImport(inputPath, { output: outputPath, ...extraArgs }, silent());
  expect(code).toBe(0);
  return readFileSync(outputPath);
}

describe('wdf import <file.docx> (T20.8)', () => {
  it('produces a VALID package with pagination ext and core.xml metadata', async () => {
    const wdf = await importFixture(fixtureDocx());
    const dir = mkdtempSync(join(tmpdir(), 'wdf-val-'));
    const file = join(dir, 'x.wdf');
    writeFileSync(file, wdf);
    expect(await cmdValidate(file, silent())).toBe(0);

    const pkg = readPackage(wdf);
    expect(pkg.manifest.title).toBe('Delibera di prova');
    expect(pkg.manifest.language).toBe('it-IT');
    expect(pkg.manifest.created).toBe('2026-08-01T09:30:00Z');
    expect(pkg.manifest.extensions).toEqual([{ name: 'pagination', version: '0.1' }]);
    const pagination = parsePaginationExt(pkg.files);
    expect(pagination?.breakBefore).toHaveLength(1);
    const entry = dec.decode(pkg.files.get('content/index.html'));
    expect(entry).toContain('<h1');
    expect(entry).toContain(`id="${pagination?.breakBefore[0] ?? ''}"`);
  });

  it('is deterministic: the same file yields byte-identical packages', async () => {
    const bytes = fixtureDocx();
    const a = await importFixture(bytes);
    const b = await importFixture(bytes);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('--with-source embeds the original as an ext-source 0.4 binary', async () => {
    const bytes = fixtureDocx();
    const wdf = await importFixture(bytes, { withSource: true });
    const pkg = readPackage(wdf);
    expect(pkg.manifest.extensions).toEqual([
      { name: 'pagination', version: '0.1' },
      { name: 'source', version: '0.4' },
    ]);
    const source = JSON.parse(dec.decode(pkg.files.get('ext/source/source.json'))) as {
      kind: string;
      main: string;
      mainName: string;
      mediaType: string;
      encoding?: string;
    };
    expect(source.kind).toBe('binary');
    expect(source.mainName).toBe('documento.docx');
    expect(source.mediaType).toContain('wordprocessingml');
    expect(source.encoding).toBeUndefined();
    expect(source.main).toMatch(/^ext\/source\/[0-9a-f]{16}\.docx$/);
    // The embedded original is the input, byte for byte.
    const embedded = pkg.files.get(source.main);
    expect(Buffer.from(embedded ?? new Uint8Array()).equals(Buffer.from(bytes))).toBe(true);
  });

  it('routes by content: a docx behind a wrong extension still converts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wdf-mis-'));
    const inputPath = join(dir, 'documento.html'); // lies about its format
    const outputPath = join(dir, 'out.wdf');
    writeFileSync(inputPath, fixtureDocx());
    expect(await cmdImport(inputPath, { output: outputPath }, silent())).toBe(0);
    const pkg = readPackage(readFileSync(outputPath));
    expect(pkg.manifest.title).toBe('Delibera di prova');
  });

  it('promotes fake styled headings (T7.7 heuristic on the docx path)', async () => {
    const document =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<w:document xmlns:w="${W_NS}"><w:body>` +
      '<w:p><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>Titolo finto</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Corpo del documento con testo normale.</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Altro paragrafo di corpo.</w:t></w:r></w:p>' +
      '<w:sectPr/></w:body></w:document>';
    const bytes = makeDocx({ document, extra: { 'word/styles.xml': STYLES_XML } });
    const wdf = await importFixture(bytes);
    const entry = dec.decode(readPackage(wdf).files.get('content/index.html'));
    expect(entry).toMatch(/<h1[^>]*>Titolo finto<\/h1>/);
  });
});
