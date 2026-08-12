import { validateProfile } from '@wdf-dev/core';
import { describe, expect, it } from 'vitest';

import { convertDocx, ensureIds, serializeDocument, textOf, type MEl } from '@wdf-dev/import';

import { makeDocx, W_NS } from './docx-fixtures.js';

// WP20 T20.4 (plan §10.47): tables — gridSpan → colspan, vMerge → rowspan
// on the WP11 grid model (spans survive only when the grid is exactly
// rectangular), first row → thead th, caption from the adjacent
// caption-style paragraph or synthesized empty, borders/shading through
// the generated stylesheet, cells hold phrasing (no br, nested flattened).

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<w:styles xmlns:w="${W_NS}">` +
  '<w:style w:type="paragraph" w:styleId="Didascalia"><w:name w:val="caption"/></w:style>' +
  '<w:style w:type="table" w:styleId="GrigliaBase"><w:name w:val="Table Grid"/>' +
  '<w:tblPr><w:tblBorders>' +
  '<w:top w:val="single" w:sz="8"/><w:bottom w:val="single" w:sz="8"/>' +
  '<w:left w:val="single" w:sz="8"/><w:right w:val="single" w:sz="8"/>' +
  '<w:insideH w:val="single" w:sz="4" w:color="C00000"/><w:insideV w:val="single" w:sz="4" w:color="C00000"/>' +
  '</w:tblBorders></w:tblPr></w:style>' +
  '</w:styles>';

function docWith(body: string): Uint8Array {
  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W_NS}"><w:body>${body}<w:sectPr/></w:body></w:document>`;
  return makeDocx({ document, extra: { 'word/styles.xml': STYLES_XML } });
}

function tc(text: string, tcPr = ''): string {
  return `<w:tc>${tcPr === '' ? '' : `<w:tcPr>${tcPr}</w:tcPr>`}<w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
}

function tr(...cells: string[]): string {
  return `<w:tr>${cells.join('')}</w:tr>`;
}

function tbl(rows: string, tblPr = ''): string {
  return `<w:tbl>${tblPr === '' ? '' : `<w:tblPr>${tblPr}</w:tblPr>`}${rows}</w:tbl>`;
}

function para(text: string, pPr = ''): string {
  return `<w:p>${pPr === '' ? '' : `<w:pPr>${pPr}</w:pPr>`}<w:r><w:t>${text}</w:t></w:r></w:p>`;
}

async function convert(body: string): Promise<{
  blocks: MEl[];
  stylesheet?: string;
  report: string[];
}> {
  const report: string[] = [];
  const result = await convertDocx(docWith(body), report);
  return {
    blocks: result.blocks,
    ...(result.stylesheet !== undefined && { stylesheet: result.stylesheet }),
    report,
  };
}

function partsOf(table: MEl | undefined): { caption?: MEl; thead?: MEl; tbody?: MEl } {
  const find = (tag: string): MEl | undefined =>
    table?.children.find((c): c is MEl => typeof c !== 'string' && c.tag === tag);
  const out: { caption?: MEl; thead?: MEl; tbody?: MEl } = {};
  const caption = find('caption');
  if (caption !== undefined) out.caption = caption;
  const thead = find('thead');
  if (thead !== undefined) out.thead = thead;
  const tbody = find('tbody');
  if (tbody !== undefined) out.tbody = tbody;
  return out;
}

function rowsOf(section: MEl | undefined): MEl[][] {
  return (section?.children ?? [])
    .filter((c): c is MEl => typeof c !== 'string' && c.tag === 'tr')
    .map((row) => row.children.filter((c): c is MEl => typeof c !== 'string'));
}

describe('convertDocx — tables', () => {
  it('builds caption + thead(th) + tbody(td) from rows', async () => {
    const { blocks, report } = await convert(
      tbl(tr(tc('Colonna A'), tc('Colonna B')) + tr(tc('1'), tc('2'))),
    );
    const table = blocks[0];
    expect(table?.tag).toBe('table');
    const { caption, thead, tbody } = partsOf(table);
    expect(caption?.children).toEqual([]);
    expect(rowsOf(thead)[0]?.map((c) => c.tag)).toEqual(['th', 'th']);
    expect(rowsOf(tbody)[0]?.map((c) => c.tag)).toEqual(['td', 'td']);
    expect(report.some((r) => r.includes('synthesized empty <caption>'))).toBe(true);
  });

  it('keeps gridSpan as colspan when the grid is rectangular', async () => {
    const { blocks, report } = await convert(
      tbl(tr(tc('span due', '<w:gridSpan w:val="2"/>')) + tr(tc('a'), tc('b'))),
    );
    const { thead } = partsOf(blocks[0]);
    expect(rowsOf(thead)[0]?.[0]?.attrs['colspan']).toBe('2');
    expect(report.some((r) => r.includes('kept merged cells'))).toBe(true);
  });

  it('turns vMerge into rowspan and drops continue cells', async () => {
    const { blocks } = await convert(
      tbl(
        tr(tc('h1'), tc('h2')) +
          tr(tc('fusa', '<w:vMerge w:val="restart"/>'), tc('r1')) +
          tr(tc('', '<w:vMerge/>'), tc('r2')),
      ),
    );
    const { tbody } = partsOf(blocks[0]);
    const rows = rowsOf(tbody);
    expect(rows[0]?.[0]?.attrs['rowspan']).toBe('2');
    expect(rows[0]).toHaveLength(2);
    expect(rows[1]).toHaveLength(1); // the continue cell left the row
  });

  it('strips spans and pads when the grid cannot be reconciled', async () => {
    const { blocks, report } = await convert(
      tbl(tr(tc('a', '<w:gridSpan w:val="3"/>')) + tr(tc('x'), tc('y'))),
    );
    const { thead, tbody } = partsOf(blocks[0]);
    expect(rowsOf(thead)[0]?.every((c) => c.attrs['colspan'] === undefined)).toBe(true);
    expect(rowsOf(tbody)[0]).toHaveLength(2);
    expect(report.some((r) => r.includes('could not be reconciled'))).toBe(true);
  });

  it('uses the caption-style paragraph before the table', async () => {
    const { blocks, report } = await convert(
      para('Tabella 1 — Spese', '<w:pStyle w:val="Didascalia"/>') + tbl(tr(tc('a')) + tr(tc('b'))),
    );
    expect(blocks).toHaveLength(1);
    const { caption } = partsOf(blocks[0]);
    expect(textOf(caption as MEl)).toBe('Tabella 1 — Spese');
    expect(report.some((r) => r.includes('adjacent caption-style paragraph'))).toBe(true);
  });

  it('uses the caption-style paragraph after the table', async () => {
    const { blocks } = await convert(
      tbl(tr(tc('a')) + tr(tc('b'))) + para('Tabella 2', '<w:pStyle w:val="Didascalia"/>'),
    );
    expect(blocks).toHaveLength(1);
    expect(textOf(partsOf(blocks[0]).caption as MEl)).toBe('Tabella 2');
  });

  it('a caption-style paragraph NOT adjacent to a table stays a paragraph', async () => {
    const { blocks } = await convert(
      para('Solo testo', '<w:pStyle w:val="Didascalia"/>') + para('altro') + tbl(tr(tc('a'))),
    );
    expect(blocks.map((b) => b.tag)).toEqual(['p', 'p', 'table']);
  });

  it('translates style-chain borders and shading into generated classes', async () => {
    const { blocks, stylesheet } = await convert(
      tbl(
        tr(tc('intestazione', '<w:shd w:val="clear" w:fill="D9E2F3"/>')) + tr(tc('corpo')),
        '<w:tblStyle w:val="GrigliaBase"/>',
      ),
    );
    expect(blocks[0]?.attrs['class']).toBeDefined();
    expect(stylesheet).toContain('border-top: 1pt solid #000000');
    expect(stylesheet).toContain('border: 0.5pt solid #c00000'); // inside borders on cells
    expect(stylesheet).toContain('background-color: #d9e2f3');
  });

  it('cells hold phrasing: multi-paragraph joined, br stripped, nested table flattened', async () => {
    const cell =
      '<w:tc><w:p><w:r><w:t>riga uno</w:t><w:br/></w:r></w:p><w:p><w:r><w:t>riga due</w:t></w:r></w:p>' +
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>annidata</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:tc>';
    const { blocks, report } = await convert(tbl(`<w:tr>${cell}</w:tr>` + tr(tc('x'))));
    const { thead } = partsOf(blocks[0]);
    const th = rowsOf(thead)[0]?.[0];
    expect(textOf(th as MEl)).toBe('riga uno riga due annidata');
    expect(JSON.stringify(th)).not.toContain('"br"');
    expect(report.some((r) => r.includes('nested table flattened'))).toBe(true);
  });

  it('a single-row table keeps the header with an empty body, reported', async () => {
    const { blocks, report } = await convert(tbl(tr(tc('sola'))));
    const { tbody } = partsOf(blocks[0]);
    expect(rowsOf(tbody)).toHaveLength(0);
    expect(report.some((r) => r.includes('single row'))).toBe(true);
  });

  it('tables between list items split the list', async () => {
    const li = (t: string): string =>
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
    const { blocks } = await convert(li('a') + tbl(tr(tc('x')) + tr(tc('y'))) + li('b'));
    expect(blocks.map((b) => b.tag)).toEqual(['ul', 'table', 'ul']);
  });

  it('serializes to a conforming document (spans included)', async () => {
    const { blocks, stylesheet } = await convert(
      para('Tabella 3', '<w:pStyle w:val="Didascalia"/>') +
        tbl(
          tr(tc('A', '<w:gridSpan w:val="2"/>')) +
            tr(tc('fusa', '<w:vMerge w:val="restart"/>'), tc('b1')) +
            tr(tc('', '<w:vMerge/>'), tc('b2')),
          '<w:tblStyle w:val="GrigliaBase"/>',
        ),
    );
    const report: string[] = [];
    ensureIds(blocks, report);
    const html = serializeDocument('it', 'Tabelle', blocks, stylesheet !== undefined);
    const violations = validateProfile(html).filter((v) => v.severity === 'error');
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});
