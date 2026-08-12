import { validateProfile } from '@wdf-dev/core';
import { describe, expect, it } from 'vitest';

import { convertDocx, ensureIds, serializeDocument, textOf, type MEl } from '@wdf-dev/import';

import { makeDocx, W_NS } from './docx-fixtures.js';

// WP20 T20.6 (plan §10.47): page headers/footers from the body's trailing
// sectPr (T14.1 policy: first-page variant only when titlePg activates it,
// never even) and authored page breaks → pagination extension data.

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function hdr(text: string, extraRuns = ''): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:hdr xmlns:w="${W_NS}"><w:p><w:r><w:t>${text}</w:t></w:r>${extraRuns}</w:p></w:hdr>`
  );
}

function ftr(text: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:ftr xmlns:w="${W_NS}"><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:ftr>`
  );
}

function para(text: string, pPr = ''): string {
  return `<w:p>${pPr === '' ? '' : `<w:pPr>${pPr}</w:pPr>`}<w:r><w:t>${text}</w:t></w:r></w:p>`;
}

interface Build {
  body: string;
  sectPr?: string;
  rels?: string;
  extra?: Record<string, Uint8Array | string>;
}

async function convert(build: Build) {
  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${build.body}` +
    `<w:sectPr>${build.sectPr ?? ''}</w:sectPr></w:body></w:document>`;
  const extra: Record<string, Uint8Array | string> = { ...(build.extra ?? {}) };
  if (build.rels !== undefined) {
    extra['word/_rels/document.xml.rels'] =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<Relationships xmlns="${PKG_REL_NS}">${build.rels}</Relationships>`;
  }
  const report: string[] = [];
  const result = await convertDocx(makeDocx({ document, extra }), report);
  return { ...result, report };
}

const headerRel =
  '<Relationship Id="rIdH" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>';
const footerRel =
  '<Relationship Id="rIdF" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>';

describe('convertDocx — page headers/footers (T20.6)', () => {
  it('imports the default header first and footer last', async () => {
    const { blocks, report } = await convert({
      body: para('contenuto'),
      sectPr:
        '<w:headerReference w:type="default" r:id="rIdH"/><w:footerReference w:type="default" r:id="rIdF"/>',
      rels: headerRel + footerRel,
      extra: { 'word/header1.xml': hdr('Intestazione doc'), 'word/footer1.xml': ftr('Pag.') },
    });
    expect(blocks[0]?.tag).toBe('header');
    expect(textOf(blocks[0] as MEl)).toBe('Intestazione doc');
    expect(blocks[blocks.length - 1]?.tag).toBe('footer');
    expect(report.some((r) => r.includes('imported page header (word/header1.xml)'))).toBe(true);
  });

  it('prefers the first-page variant only when titlePg activates it', async () => {
    const firstRel = headerRel.replace('rIdH', 'rIdH1').replace('header1', 'headerF');
    const refs =
      '<w:headerReference w:type="first" r:id="rIdH1"/><w:headerReference w:type="default" r:id="rIdH"/>';
    const extra = {
      'word/header1.xml': hdr('default'),
      'word/headerF.xml': hdr('prima pagina'),
    };
    const withTitle = await convert({
      body: para('x'),
      sectPr: `${refs}<w:titlePg/>`,
      rels: headerRel + firstRel,
      extra,
    });
    expect(textOf(withTitle.blocks[0] as MEl)).toBe('prima pagina');
    const without = await convert({
      body: para('x'),
      sectPr: refs,
      rels: headerRel + firstRel,
      extra,
    });
    expect(textOf(without.blocks[0] as MEl)).toBe('default');
  });

  it('never uses the even-page variant and prunes empty parts', async () => {
    const { blocks } = await convert({
      body: para('x'),
      sectPr:
        '<w:headerReference w:type="even" r:id="rIdH"/><w:footerReference w:type="default" r:id="rIdF"/>',
      rels: headerRel + footerRel,
      extra: {
        'word/header1.xml': hdr('pari'),
        'word/footer1.xml': '<?xml version="1.0"?>' + `<w:ftr xmlns:w="${W_NS}"><w:p/></w:ftr>`, // empty
      },
    });
    expect(blocks.every((b) => b.tag !== 'header')).toBe(true); // even ignored
    expect(blocks.every((b) => b.tag !== 'footer')).toBe(true); // empty pruned
  });

  it('resolves header images through the HEADER part relationships', async () => {
    const wp = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
    const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    const logoRun =
      `<w:r><w:drawing xmlns:wp="${wp}" xmlns:a="${a}" xmlns:r="${R_NS}"><wp:inline>` +
      `<wp:docPr id="1" name="logo" descr="logo"/>` +
      `<a:graphic><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic>` +
      `</wp:inline></w:drawing></w:r>`;
    const { blocks, assets } = await convert({
      body: para('x'),
      sectPr: '<w:headerReference w:type="default" r:id="rIdH"/>',
      rels: headerRel,
      extra: {
        'word/header1.xml': hdr('Con logo', logoRun),
        'word/_rels/header1.xml.rels':
          '<?xml version="1.0"?>' +
          `<Relationships xmlns="${PKG_REL_NS}">` +
          '<Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/>' +
          '</Relationships>',
        'word/media/logo.png': PNG,
      },
    });
    const header = blocks[0];
    expect(header?.tag).toBe('header');
    expect(JSON.stringify(header)).toContain('content/assets/');
    expect(assets).toHaveLength(1);
  });

  it('header+footer document serializes to a conforming article', async () => {
    const { blocks, stylesheet } = await convert({
      body: para('Corpo del documento'),
      sectPr:
        '<w:headerReference w:type="default" r:id="rIdH"/><w:footerReference w:type="default" r:id="rIdF"/>',
      rels: headerRel + footerRel,
      extra: { 'word/header1.xml': hdr('H'), 'word/footer1.xml': ftr('F') },
    });
    const report: string[] = [];
    ensureIds(blocks, report);
    const html = serializeDocument('it', 'Sezioni', blocks, stylesheet !== undefined);
    const violations = validateProfile(html).filter((v) => v.severity === 'error');
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});

describe('convertDocx — authored page breaks (T20.6)', () => {
  function idsOf(blocks: MEl[], marked: MEl[]): (string | undefined)[] {
    const report: string[] = [];
    ensureIds(blocks, report);
    return marked.map((b) => b.attrs['id']);
  }

  it('a break at the end of a paragraph marks the NEXT block', async () => {
    const { blocks, pageBreakBlocks, report } = await convert({
      body:
        `<w:p><w:r><w:t>prima pagina</w:t><w:br w:type="page"/></w:r></w:p>` +
        para('seconda pagina'),
    });
    expect(pageBreakBlocks).toHaveLength(1);
    expect(pageBreakBlocks[0]).toBe(blocks[1]);
    expect(idsOf(blocks, pageBreakBlocks)[0]).toBeDefined();
    expect(report.some((r) => r.includes('recorded 1 authored page break'))).toBe(true);
  });

  it('a break before any content marks the paragraph ITSELF', async () => {
    const { blocks, pageBreakBlocks } = await convert({
      body: para('prima') + `<w:p><w:r><w:br w:type="page"/><w:t>inizio nuova</w:t></w:r></w:p>`,
    });
    expect(pageBreakBlocks[0]).toBe(blocks[1]);
    expect(textOf(blocks[1] as MEl)).toBe('inizio nuova');
  });

  it('a break in an empty paragraph carries over to the next real block', async () => {
    const { blocks, pageBreakBlocks } = await convert({
      body: para('prima') + `<w:p><w:r><w:br w:type="page"/></w:r></w:p>` + para('dopo'),
    });
    expect(pageBreakBlocks).toHaveLength(1);
    expect(pageBreakBlocks[0]).toBe(blocks[1]);
    expect(textOf(blocks[1] as MEl)).toBe('dopo');
  });

  it('a section break (sectPr in pPr) breaks after its paragraph; continuous does not', async () => {
    const withBreak = await convert({
      body: para('fine sezione', '<w:sectPr/>') + para('nuova sezione'),
    });
    expect(withBreak.pageBreakBlocks).toHaveLength(1);
    expect(withBreak.pageBreakBlocks[0]).toBe(withBreak.blocks[1]);
    expect(withBreak.report.some((r) => r.includes('multiple sections'))).toBe(true);
    const continuous = await convert({
      body: para('fine', '<w:sectPr><w:type w:val="continuous"/></w:sectPr>') + para('segue'),
    });
    expect(continuous.pageBreakBlocks).toHaveLength(0);
  });

  it('a break before the first rendered element is dropped (ext-pagination §4)', async () => {
    const { pageBreakBlocks } = await convert({
      body: `<w:p><w:r><w:br w:type="page"/><w:t>primo blocco</w:t></w:r></w:p>` + para('secondo'),
    });
    expect(pageBreakBlocks).toHaveLength(0);
  });

  it('breaks land on list items and tables too', async () => {
    const numbering =
      '<?xml version="1.0"?>' +
      `<w:numbering xmlns:w="${W_NS}"><w:abstractNum w:abstractNumId="0">` +
      '<w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>' +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';
    const li = `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:br w:type="page"/><w:t>item</w:t></w:r></w:p>`;
    const { blocks, pageBreakBlocks } = await convert({
      body: para('testo') + li,
      extra: { 'word/numbering.xml': numbering },
    });
    expect(blocks[1]?.tag).toBe('ul');
    expect(pageBreakBlocks[0]?.tag).toBe('li');
  });
});
