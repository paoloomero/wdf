import { validateProfile } from '@wdf-dev/core';
import { describe, expect, it } from 'vitest';

import {
  classifyNote,
  convertDocx,
  ensureIds,
  serializeDocument,
  textOf,
  type MEl,
  type MNode,
} from '@wdf-dev/import';

import { makeDocx, W_NS } from './docx-fixtures.js';

// Plan §10.87: a Europass-like CV — the most common .docx a public
// administration receives — built only of borderless tables. Layout tables
// become flowing blocks; drawn grids stay tables, with list labels kept as
// text and joined paragraphs reported; page-number fields and Word's own
// alt text go. Synthetic data only.

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<w:styles xmlns:w="${W_NS}">` +
  '<w:style w:type="paragraph" w:styleId="Nome"><w:name w:val="Nome"/>' +
  '<w:rPr><w:sz w:val="52"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Sezione"><w:name w:val="Sezione"/>' +
  '<w:rPr><w:sz w:val="28"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Corpo"><w:name w:val="Corpo"/>' +
  '<w:rPr><w:sz w:val="18"/></w:rPr></w:style>' +
  '<w:style w:type="table" w:styleId="Griglia"><w:name w:val="Table Grid"/>' +
  '<w:tblPr><w:tblBorders>' +
  '<w:top w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/>' +
  '<w:left w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/>' +
  '<w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/>' +
  '</w:tblBorders></w:tblPr></w:style>' +
  '</w:styles>';

const NUMBERING_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<w:numbering xmlns:w="${W_NS}">` +
  '<w:abstractNum w:abstractNumId="0">' +
  '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1)"/></w:lvl>' +
  '</w:abstractNum>' +
  '<w:abstractNum w:abstractNumId="1">' +
  '<w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="▪"/></w:lvl>' +
  '</w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
  '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
  '</w:numbering>';

const p = (text: string, style = 'Corpo', pPr = ''): string =>
  `<w:p><w:pPr><w:pStyle w:val="${style}"/>${pPr}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const li = (text: string, numId: string): string =>
  p(text, 'Corpo', `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>`);
const tc = (inner: string, tcPr = ''): string =>
  `<w:tc>${tcPr === '' ? '' : `<w:tcPr>${tcPr}</w:tcPr>`}${inner === '' ? '<w:p/>' : inner}</w:tc>`;
const tr = (...cells: string[]): string => `<w:tr>${cells.join('')}</w:tr>`;
const tbl = (rows: string, tblPr = ''): string =>
  `<w:tbl>${tblPr === '' ? '' : `<w:tblPr>${tblPr}</w:tblPr>`}${rows}</w:tbl>`;
const GRID = '<w:tblStyle w:val="Griglia"/>';

const picture = (alt: string): string =>
  `<w:r><w:drawing xmlns:wp="${WP_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}"><wp:inline>` +
  `<wp:docPr id="1" name="Picture 1" descr="${alt}"/>` +
  `<a:graphic><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
  `<pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic>` +
  `</wp:inline></w:drawing></w:r>`;

/** "© Esempio <tab> Pagina PAGE / NUMPAGES", Europass-style. */
const FOOTER =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<w:ftr xmlns:w="${W_NS}"><w:p>` +
  '<w:r><w:t xml:space="preserve">© Esempio, 2026 | cv.example</w:t></w:r>' +
  '<w:r><w:tab/><w:t xml:space="preserve">Pagina </w:t></w:r>' +
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>5</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>' +
  '<w:r><w:t xml:space="preserve"> / </w:t></w:r>' +
  '<w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>6</w:t></w:r></w:fldSimple>' +
  '</w:p></w:ftr>';

const CV_BODY =
  // Personal information: label | name, label-less contact row.
  tbl(
    tr(tc(p('INFORMAZIONI PERSONALI', 'Sezione')), tc(p('Maria Esempio', 'Nome'))) +
      tr(tc(''), tc(p('Via dei Test 1, Udine') + p('maria@example.org'))),
  ) +
  // Section row: a single row, the right cell only decoration.
  tbl(tr(tc(p('ESPERIENZA PROFESSIONALE', 'Sezione')), tc(''))) +
  // Dates | organisation, description and a lettered list.
  tbl(
    tr(
      tc(p('2019 – oggi')),
      tc(
        p('Esempio srl') +
          p('L’azienda opera nei campi di:') +
          li('sviluppo software', '1') +
          li('analisi dei processi', '1'),
      ),
    ),
  ) +
  // A drawn grid: stays a table; a list in a cell keeps its labels.
  tbl(
    tr(tc(p('Lingua')), tc(p('Livello'))) +
      tr(tc(p('Inglese')), tc(li('ascolto B2', '2') + li('lettura C1', '2'))),
    GRID,
  ) +
  // Cell borders only (Europass language grid): also a drawn grid.
  tbl(
    tr(tc(p('Patente'), '<w:tcBorders><w:bottom w:val="single" w:sz="4"/></w:tcBorders>')) +
      tr(tc(p('B'))),
  ) +
  `<w:p>${picture('Immagine che contiene testo&#10;&#10;Descrizione generata automaticamente')}</w:p>`;

async function convertCv(body = CV_BODY) {
  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${body}` +
    '<w:sectPr><w:footerReference w:type="default" r:id="rIdF"/></w:sectPr></w:body></w:document>';
  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<Relationships xmlns="${PKG_REL_NS}">` +
    '<Relationship Id="rIdF" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' +
    '<Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>' +
    '</Relationships>';
  const report: string[] = [];
  const result = await convertDocx(
    makeDocx({
      document,
      extra: {
        'word/_rels/document.xml.rels': rels,
        'word/styles.xml': STYLES_XML,
        'word/numbering.xml': NUMBERING_XML,
        'word/footer1.xml': FOOTER,
        'word/media/image1.png': PNG,
      },
    }),
    report,
  );
  return { ...result, report };
}

function findAll(nodes: MNode[], tag: string): MEl[] {
  return nodes.flatMap((n): MEl[] => {
    if (typeof n === 'string') return [];
    const inner = findAll(n.children, tag);
    return n.tag === tag ? [n, ...inner] : inner;
  });
}

describe('convertDocx — layout tables, Europass-like CV (plan §10.87)', () => {
  it('unwraps borderless tables with block content into paragraphs, headings and lists', async () => {
    const { blocks, report } = await convertCv();
    const tables = findAll(blocks, 'table');
    expect(tables).toHaveLength(2); // the two drawn grids only
    // Flowing text, in reading order: label, then content.
    const texts = blocks.filter((b) => b.tag !== 'table').map((b) => [b.tag, textOf(b)]);
    expect(texts.map(([, t]) => t)).toEqual(
      expect.arrayContaining([
        'INFORMAZIONI PERSONALI',
        'Maria Esempio',
        'Via dei Test 1, Udine',
        'maria@example.org',
        'ESPERIENZA PROFESSIONALE',
        '2019 – oggi',
        'Esempio srl',
      ]),
    );
    const order = texts.map(([, t]) => t);
    expect(order.indexOf('Maria Esempio')).toBeLessThan(order.indexOf('Via dei Test 1, Udine'));
    // The lettered list is a real list again.
    const list = blocks.find((b) => b.tag === 'ol');
    expect(
      list?.children.filter((c) => typeof c !== 'string').map((c) => textOf(c as MEl)),
    ).toEqual(['sviluppo software', 'analisi dei processi']);
    // The section row (label alone in the first cell) is a heading by
    // structure; the name, larger than every heading, becomes the title
    // (T7.8). The label sharing its row with the name stays a paragraph.
    const headings = findAll(blocks, 'h1').concat(findAll(blocks, 'h2'));
    expect(headings.map((h) => [h.tag, textOf(h)])).toEqual([
      ['h1', 'Maria Esempio'],
      ['h2', 'ESPERIENZA PROFESSIONALE'],
    ]);
    expect(report).toContain(
      'promoted 1 section label of layout tables to <h2> (a row holding only a short label)',
    );
    const note = report.find((r) => r.startsWith('replaced 3 layout tables'));
    expect(note).toBe(
      'replaced 3 layout tables with their content as paragraphs and lists (no visible borders, block content in cells)',
    );
    expect(classifyNote(note ?? '')).toBe('change');
  });

  it('keeps drawn grids as tables, with list labels as text and joined paragraphs reported', async () => {
    const { blocks, report } = await convertCv();
    const [grid, cellBordered] = findAll(blocks, 'table');
    const cells = findAll(grid?.children ?? [], 'td').map((c) => textOf(c));
    expect(cells).toEqual(['Inglese', '• ascolto B2 • lettura C1']);
    expect(textOf(cellBordered as MEl)).toContain('Patente');
    const note =
      'dropped the paragraph breaks of 1 table cell (a cell holds one line of text, §6.2.3, §6.2.8)';
    expect(report).toContain(note);
    expect(classifyNote(note)).toBe('loss');
  });

  it('writes ordered list labels in a cell from lvlText and the counters', async () => {
    const { blocks } = await convertCv(
      tbl(tr(tc(p('Ambiti'))) + tr(tc(li('uno', '1') + li('due', '1') + li('tre', '1'))), GRID),
    );
    expect(textOf(findAll(blocks, 'td')[0] as MEl)).toBe('a) uno b) due c) tre');
  });

  it('drops the page-number zone of the footer and reports the fields', async () => {
    const { blocks, report } = await convertCv();
    const footer = blocks.find((b) => b.tag === 'footer');
    expect(textOf(footer as MEl).trim()).toBe('© Esempio, 2026 | cv.example');
    expect(report).toContain('removed 2 page-number fields (a reflowed document has no pages)');
  });

  it('removes the page number but keeps the sentence in the body', async () => {
    const { blocks } = await convertCv(
      '<w:p><w:r><w:t xml:space="preserve">Questa è la pagina </w:t></w:r>' +
        '<w:fldSimple w:instr="PAGE"><w:r><w:t>3</w:t></w:r></w:fldSimple>' +
        '<w:r><w:t>.</w:t></w:r></w:p>',
    );
    expect(textOf(blocks[0] as MEl)).toBe('Questa è la pagina .');
  });

  it("empties the alt text Word generated by itself, keeps the author's", async () => {
    const { blocks, report } = await convertCv();
    const img = findAll(blocks, 'img')[0];
    expect(img?.attrs['alt']).toBe('');
    expect(report).toContain(
      "removed the alt text Word generated by itself for 1 image (not the author's description)",
    );
    const own = await convertCv(`<w:p>${picture('Firma di Maria Esempio')}</w:p>`);
    expect(findAll(own.blocks, 'img')[0]?.attrs['alt']).toBe('Firma di Maria Esempio');
  });

  it('a borderless grid of one-line cells stays a table', async () => {
    const { blocks, report } = await convertCv(
      tbl(tr(tc(p('Anno')), tc(p('Valore'))) + tr(tc(p('2025')), tc(p('12')))),
    );
    expect(blocks[0]?.tag).toBe('table');
    expect(report.some((r) => r.includes('layout table'))).toBe(false);
  });

  it('an entirely empty row marks a borderless table as layout (spacing)', async () => {
    // "Maturità | (empty)" inside a longer table is a value, not a section.
    const { blocks } = await convertCv(
      tbl(
        tr(tc(p('1985-1989')), tc(p('Liceo'))) + tr(tc(''), tc('')) + tr(tc(p('Maturità')), tc('')),
      ),
    );
    const body = blocks.filter((b) => b.tag !== 'footer');
    expect(body.map((b) => [b.tag, textOf(b)])).toEqual([
      ['p', '1985-1989'],
      ['p', 'Liceo'],
      ['p', 'Maturità'],
    ]);
  });

  it('a styled run of tabs is an empty paragraph, not a blank one', async () => {
    const { blocks, report } = await convertCv(
      p('prima') +
        '<w:p><w:r><w:rPr><w:sz w:val="40"/></w:rPr><w:tab/><w:tab/></w:r></w:p>' +
        p('dopo'),
    );
    const body = blocks.filter((b) => b.tag !== 'footer');
    expect(body.map((b) => textOf(b))).toEqual(['prima', 'dopo']);
    expect(report.some((r) => r.startsWith('dropped 1 empty paragraph'))).toBe(true);
  });

  it('a label right-aligned against its column reads from the left once unwrapped', async () => {
    const right = '<w:jc w:val="right"/>';
    const unwrapped = await convertCv(
      tbl(tr(tc(p('2019 – oggi', 'Corpo', right)), tc(p('Esempio srl') + p('Sviluppo')))),
    );
    expect(unwrapped.stylesheet ?? '').not.toContain('text-align: right');
    const plain = await convertCv(p('Udine, 9 novembre 2026', 'Corpo', right));
    expect(plain.stylesheet ?? '').toContain('text-align: right');
  });

  it('serializes to a valid WDF-HTML profile', async () => {
    const { blocks, stylesheet } = await convertCv();
    ensureIds(blocks, []);
    const html = serializeDocument('it', 'CV', blocks, stylesheet !== undefined);
    const violations = validateProfile(html).filter((v) => v.severity === 'error');
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});
