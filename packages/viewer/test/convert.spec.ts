import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { readPackage } from '@wdf-dev/core';
import { describe, expect, it } from 'vitest';

import { cmdImport, type Ctx } from '../../cli/src/commands.js';
import { hasViewerTemplate } from '../../cli/src/lib/build.js';
import { convertFiles, mapAssetLoader, pickMainFile, toStandalone } from '../src/convert.js';

// T7.6 acceptance (plan §10.24): the Reader's converter runs the same
// isomorphic pipeline as the CLI over an in-memory map of the dropped files
// — same input, same date → byte-identical package — and never touches the
// network: remote references are refused.

const fixturesDir = resolve(import.meta.dirname, '../../../fixtures/import');
const DATE = '2026-08-05T12:00:00Z';

function silent(): Ctx {
  return { log: () => undefined, err: () => undefined, out: () => undefined };
}

/** Reads fixture files into the shape a drag-and-drop produces. */
function mapOf(names: string[], prefix = ''): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const add = (rel: string): void => {
    const full = join(fixturesDir, rel);
    if (statSync(full).isDirectory()) {
      for (const child of readdirSync(full).sort()) add(`${rel}/${child}`);
    } else {
      out.set(prefix + rel, readFileSync(full));
    }
  };
  for (const name of names) add(name);
  return out;
}

describe('pickMainFile', () => {
  it('picks the document, not files inside support folders', () => {
    const files = mapOf(['word-header-it.html', 'word-header-it.fld']);
    expect(pickMainFile(files)).toBe('word-header-it.html');
  });

  it('prefers the shallowest candidate, ties broken alphabetically', () => {
    const files = new Map<string, Uint8Array>([
      ['folder/deep.html', new Uint8Array()],
      ['b.html', new Uint8Array()],
      ['a.html', new Uint8Array()],
    ]);
    expect(pickMainFile(files)).toBe('a.html');
  });

  it('returns undefined when the set has no document', () => {
    expect(pickMainFile(new Map([['image.png', new Uint8Array()]]))).toBeUndefined();
  });
});

describe('no network, ever', () => {
  it('refuses remote and protocol-relative references', async () => {
    const loader = mapAssetLoader(new Map(), 'doc.html', 1024);
    for (const src of ['https://example.org/a.png', '//example.org/a.png', 'ftp://x/a.png']) {
      const load = await loader(src);
      expect('reason' in load && load.reason).toContain('no network');
    }
  });
});

describe('browser converter ↔ CLI parity', () => {
  async function cliBytes(input: string, withSource: boolean): Promise<Uint8Array> {
    const out = join(mkdtempSync(join(tmpdir(), 'wdf-conv-')), 'out.wdf');
    const opts = withSource
      ? { output: out, date: DATE, withSource: true }
      : { output: out, date: DATE };
    const code = await cmdImport(join(fixturesDir, input), opts, silent());
    expect(code).toBe(0);
    return readFileSync(out);
  }

  it('Word export with support folder (header/footer + images) is byte-identical', async () => {
    const files = mapOf(['word-header-it.html', 'word-header-it.fld']);
    const result = await convertFiles(files, { withSource: true, date: DATE });
    expect(result).toBeDefined();
    expect(new Uint8Array(result?.wdfBytes ?? [])).toEqual(
      new Uint8Array(await cliBytes('word-header-it.html', true)),
    );
    // The package really carries the assets and the page header content.
    const pkg = readPackage(result?.wdfBytes ?? new Uint8Array());
    expect([...pkg.files.keys()].some((p) => p.startsWith('content/assets/'))).toBe(true);
  });

  it('a saved page with a local stylesheet embeds it in the source extension', async () => {
    const files = mapOf(['saved-page-css.html', 'saved-page-css_files']);
    const result = await convertFiles(files, { withSource: true, date: DATE });
    expect(new Uint8Array(result?.wdfBytes ?? [])).toEqual(
      new Uint8Array(await cliBytes('saved-page-css.html', true)),
    );
    const pkg = readPackage(result?.wdfBytes ?? new Uint8Array());
    expect([...pkg.files.keys()].some((p) => /^ext\/source\/.*\.css$/.test(p))).toBe(true);
  });

  it('a folder-wrapped drop resolves relative paths from the main file', async () => {
    const flat = await convertFiles(mapOf(['word-header-it.html', 'word-header-it.fld']), {
      withSource: true,
      date: DATE,
    });
    const wrapped = await convertFiles(
      mapOf(['word-header-it.html', 'word-header-it.fld'], 'Documenti/'),
      { withSource: true, date: DATE },
    );
    expect(new Uint8Array(wrapped?.wdfBytes ?? [])).toEqual(new Uint8Array(flat?.wdfBytes ?? []));
  });

  it('a plain Word export without source matches the CLI too', async () => {
    const files = mapOf(['word-headings-it.html']);
    const result = await convertFiles(files, { date: DATE });
    expect(result?.fileName).toBe('word-headings-it.wdf');
    expect(new Uint8Array(result?.wdfBytes ?? [])).toEqual(
      new Uint8Array(await cliBytes('word-headings-it.html', false)),
    );
  });
});

describe('browser converter ↔ CLI parity — docx (T20.8)', () => {
  it('a dropped .docx converts byte-identically to the CLI, source included', async () => {
    const { makeDocx, W_NS } = await import('../../import/test/docx-fixtures.js');
    const document =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<w:document xmlns:w="${W_NS}"><w:body>` +
      '<w:p><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>Documento docx</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Contenuto di prova del convertitore.</w:t><w:br w:type="page"/></w:r></w:p>' +
      '<w:p><w:r><w:t>Seconda pagina del documento.</w:t></w:r></w:p>' +
      '<w:sectPr/></w:body></w:document>';
    const bytes = makeDocx({ document });

    const files = new Map([['delibera.docx', bytes]]);
    expect(pickMainFile(files)).toBe('delibera.docx');
    const result = await convertFiles(files, { withSource: true, date: DATE });
    expect(result).toBeDefined();

    const dir = mkdtempSync(join(tmpdir(), 'wdf-docx-par-'));
    const inputPath = join(dir, 'delibera.docx');
    writeFileSync(inputPath, bytes);
    const out = join(dir, 'out.wdf');
    expect(
      await cmdImport(inputPath, { output: out, date: DATE, withSource: true }, silent()),
    ).toBe(0);
    expect(new Uint8Array(result?.wdfBytes ?? [])).toEqual(new Uint8Array(readFileSync(out)));

    // The package carries the pagination extension and the binary original.
    const pkg = readPackage(result?.wdfBytes ?? new Uint8Array());
    expect(pkg.manifest.extensions?.map((e) => e.name)).toEqual(['pagination', 'source']);
  });
});

describe('author PDF rendition on drop (ext-source 0.5, WP21)', () => {
  const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj\nendobj\n%%EOF\n');

  async function docxDrop(): Promise<Map<string, Uint8Array>> {
    const { makeDocx, W_NS } = await import('../../import/test/docx-fixtures.js');
    const document =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<w:document xmlns:w="${W_NS}"><w:body>` +
      '<w:p><w:r><w:t>Documento con istantanea.</w:t></w:r></w:p>' +
      '</w:body></w:document>';
    return new Map([
      ['delibera.docx', makeDocx({ document })],
      ['delibera.pdf', PDF],
    ]);
  }

  it('a same-basename PDF attaches as the visual rendition, byte-identical to the CLI', async () => {
    const files = await docxDrop();
    const result = await convertFiles(files, { withSource: true, date: DATE });
    expect(result).toBeDefined();

    const pkg = readPackage(result?.wdfBytes ?? new Uint8Array());
    expect(pkg.manifest.extensions).toEqual([{ name: 'source', version: '0.6' }]);
    const sourceJson = JSON.parse(
      new TextDecoder().decode(pkg.files.get('ext/source/source.json')),
    ) as { visual?: { path: string; name: string } };
    expect(sourceJson.visual?.name).toBe('delibera.pdf');
    expect(pkg.files.has(sourceJson.visual?.path ?? '')).toBe(true);

    const dir = mkdtempSync(join(tmpdir(), 'wdf-visual-par-'));
    const docxPath = join(dir, 'delibera.docx');
    const pdfPath = join(dir, 'delibera.pdf');
    writeFileSync(docxPath, files.get('delibera.docx') ?? new Uint8Array());
    writeFileSync(pdfPath, PDF);
    const out = join(dir, 'out.wdf');
    expect(
      await cmdImport(
        docxPath,
        { output: out, date: DATE, withSource: true, withPdf: pdfPath },
        silent(),
      ),
    ).toBe(0);
    expect(new Uint8Array(result?.wdfBytes ?? [])).toEqual(new Uint8Array(readFileSync(out)));
  });

  it('without the source the PDF is ignored (the rendition cannot travel alone)', async () => {
    const result = await convertFiles(await docxDrop(), { date: DATE });
    expect(result).toBeDefined();
    const pkg = readPackage(result?.wdfBytes ?? new Uint8Array());
    expect(pkg.manifest.extensions ?? []).toEqual([]);
    expect(result?.visualName).toBeUndefined();
    expect(result?.report.some((r) => r.startsWith('PDF not attached'))).toBe(true);
  });

  // Plan §10.78: a name is no content check, it only disambiguates.
  function visualOf(wdf: Uint8Array | undefined): string | undefined {
    const pkg = readPackage(wdf ?? new Uint8Array());
    const raw = pkg.files.get('ext/source/source.json');
    if (raw === undefined) return undefined;
    return (JSON.parse(new TextDecoder().decode(raw)) as { visual?: { name: string } }).visual
      ?.name;
  }

  it('the only dropped PDF attaches whatever its name, byte-identical to the CLI', async () => {
    const files = await docxDrop();
    files.delete('delibera.pdf');
    files.set('Delibera stampa.pdf', PDF);
    const result = await convertFiles(files, { withSource: true, date: DATE });
    expect(result?.visualName).toBe('Delibera stampa.pdf');
    expect(visualOf(result?.wdfBytes)).toBe('Delibera stampa.pdf');

    const dir = mkdtempSync(join(tmpdir(), 'wdf-visual-any-'));
    const docxPath = join(dir, 'delibera.docx');
    const pdfPath = join(dir, 'Delibera stampa.pdf');
    writeFileSync(docxPath, files.get('delibera.docx') ?? new Uint8Array());
    writeFileSync(pdfPath, PDF);
    const out = join(dir, 'out.wdf');
    expect(
      await cmdImport(
        docxPath,
        { output: out, date: DATE, withSource: true, withPdf: pdfPath },
        silent(),
      ),
    ).toBe(0);
    expect(new Uint8Array(result?.wdfBytes ?? [])).toEqual(new Uint8Array(readFileSync(out)));
  });

  it('among several PDFs the same-basename one attaches', async () => {
    const files = await docxDrop();
    files.set('allegato.pdf', PDF);
    const result = await convertFiles(files, { withSource: true, date: DATE });
    expect(result?.visualName).toBe('delibera.pdf');
  });

  it('several PDFs and none named like the document: nothing attaches, the report says so', async () => {
    const files = await docxDrop();
    files.delete('delibera.pdf');
    files.set('a.pdf', PDF);
    files.set('b.pdf', PDF);
    const result = await convertFiles(files, { withSource: true, date: DATE });
    expect(result?.visualName).toBeUndefined();
    expect(visualOf(result?.wdfBytes)).toBeUndefined();
    expect(result?.report).toContain(
      'PDF not attached: 2 PDF files dropped and none is named delibera.pdf',
    );
  });
});

describe('.wdf.html from the Reader (spec §9, plan §10.80)', () => {
  it('embeds the package and the escaped title in the template, like every producer', async () => {
    const files = mapOf(['word-headings-it.html']);
    const result = await convertFiles(files, { date: DATE });
    expect(result).toBeDefined();
    if (result === undefined) return;
    const template =
      '<title>__WDF_TITLE__</title><script id="wdf-package">__WDF_PACKAGE_BASE64__</script>';
    const html = toStandalone(template, result);
    const b64 = /<script id="wdf-package">([^<]*)<\/script>/.exec(html)?.[1] ?? '';
    expect(new Uint8Array(Buffer.from(b64, 'base64'))).toEqual(new Uint8Array(result.wdfBytes));
    expect(html.startsWith(`<title>${result.title.replace(/&/g, '&amp;')}</title>`)).toBe(true);
  });

  // Needs the built template (dist/standalone.html), which `wdf import
  // --standalone` reads too; CI builds after testing, so locally only.
  it.runIf(hasViewerTemplate())(
    'is byte-identical to wdf import --standalone (docx + PDF, source included)',
    async () => {
      const { makeDocx, W_NS } = await import('../../import/test/docx-fixtures.js');
      const document =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        `<w:document xmlns:w="${W_NS}"><w:body>` +
        '<w:p><w:r><w:t>Delibera &amp; allegati.</w:t></w:r></w:p>' +
        '</w:body></w:document>';
      const docx = makeDocx({ document });
      const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj\nendobj\n%%EOF\n');
      const files = new Map([
        ['delibera.docx', docx],
        ['stampa.pdf', pdf],
      ]);
      const result = await convertFiles(files, { withSource: true, date: DATE });
      expect(result?.visualName).toBe('stampa.pdf');
      if (result === undefined) return;
      const require = createRequire(import.meta.url);
      const template = readFileSync(require.resolve('@wdf-dev/viewer/standalone.html'), 'utf8');

      const dir = mkdtempSync(join(tmpdir(), 'wdf-standalone-par-'));
      writeFileSync(join(dir, 'delibera.docx'), docx);
      writeFileSync(join(dir, 'stampa.pdf'), pdf);
      const out = join(dir, 'delibera.wdf');
      expect(
        await cmdImport(
          join(dir, 'delibera.docx'),
          {
            output: out,
            date: DATE,
            withSource: true,
            withPdf: join(dir, 'stampa.pdf'),
            standalone: true,
          },
          silent(),
        ),
      ).toBe(0);
      expect(toStandalone(template, result)).toBe(
        readFileSync(join(dir, 'delibera.wdf.html'), 'utf8'),
      );
    },
  );
});
