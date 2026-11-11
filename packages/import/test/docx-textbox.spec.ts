import { describe, expect, it } from 'vitest';

import { convertDocx, textOf, type MEl } from '@wdf-dev/import';

import { makeDocx, W_NS } from './docx-fixtures.js';

// Plan §10.95 (public PA documents): the text of a text box is content — it
// used to be dropped without a word in the report. It now enters the flow
// after the paragraph the box is anchored to, once. Content controls: an
// empty form field's prompt is Word's text, not the author's; a control
// around table rows no longer hides the rows.

const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';

const p = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const txbx = (inner: string): string => `<w:txbxContent>${inner}</w:txbxContent>`;
/** A DrawingML text box, written twice as Word does (Choice + VML Fallback). */
const drawingBox = (inner: string): string =>
  '<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor>' +
  `<a:graphic><a:graphicData><wps:wsp><wps:txbx>${txbx(inner)}</wps:txbx></wps:wsp></a:graphicData></a:graphic>` +
  '</wp:anchor></w:drawing></mc:Choice>' +
  `<mc:Fallback><w:pict><v:shape><v:textbox>${txbx(inner)}</v:textbox></v:shape></w:pict></mc:Fallback>` +
  '</mc:AlternateContent></w:r>';
/** A legacy VML text box, written once. */
const vmlBox = (inner: string): string =>
  `<w:r><w:pict><v:shape><v:textbox>${txbx(inner)}</v:textbox></v:shape></w:pict></w:r>`;

async function convert(body: string): Promise<{ blocks: MEl[]; report: string[] }> {
  const report: string[] = [];
  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W_NS}" xmlns:mc="${MC}" xmlns:wps="${WPS}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:v="${V}">` +
    `<w:body>${body}<w:sectPr/></w:body></w:document>`;
  const result = await convertDocx(makeDocx({ document }), report);
  return { blocks: result.blocks, report };
}
const texts = (blocks: MEl[]): string[] => blocks.map((b) => textOf(b));

describe('convertDocx — text boxes', () => {
  it('a DrawingML text box enters the flow after its paragraph, once', async () => {
    const { blocks, report } = await convert(
      `<w:p><w:r><w:t>Alla Direzione</w:t></w:r>${drawingBox(p('Marca da bollo') + p('16,00 euro'))}</w:p>` +
        p('Il sottoscritto'),
    );
    expect(texts(blocks)).toEqual([
      'Alla Direzione',
      'Marca da bollo',
      '16,00 euro',
      'Il sottoscritto',
    ]);
    expect(report).toContain(
      'placed the text of 1 text box in the flow, after the paragraph each is anchored to (the position on the page is not kept)',
    );
    expect(report.join('\n')).not.toContain('without an embedded picture');
  });

  it('a legacy VML text box too, with no "shape skipped" note', async () => {
    const { blocks, report } = await convert(`<w:p>${vmlBox(p('Imposta di bollo assolta'))}</w:p>`);
    expect(texts(blocks)).toEqual(['Imposta di bollo assolta']);
    expect(report.join('\n')).not.toContain('legacy shape');
  });

  it('a box in an otherwise empty paragraph keeps its text; a box inside a box is reached', async () => {
    const { blocks, report } = await convert(
      `<w:p>${drawingBox(`<w:p><w:r><w:t>Esterna</w:t></w:r>${vmlBox(p('Interna'))}</w:p>`)}</w:p>`,
    );
    expect(texts(blocks)).toEqual(['Esterna', 'Interna']);
    expect(report.some((r) => r.startsWith('placed the text of 2 text boxes'))).toBe(true);
  });

  it('an empty text box adds nothing and is not reported', async () => {
    const { blocks, report } = await convert(
      `<w:p><w:r><w:t>Testo</w:t></w:r>${drawingBox('<w:p/>')}</w:p>`,
    );
    expect(texts(blocks)).toEqual(['Testo']);
    expect(report.join('\n')).not.toContain('text box');
  });
});

describe('convertDocx — content controls', () => {
  const sdt = (content: string, placeholder: boolean): string =>
    `<w:sdt><w:sdtPr>${placeholder ? '<w:showingPlcHdr/>' : ''}</w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;
  const prompt = '<w:r><w:t>Fare clic o toccare qui per immettere il testo.</w:t></w:r>';
  const tc = (inner: string): string => `<w:tc>${inner}</w:tc>`;
  const tr = (...cells: string[]): string => `<w:tr>${cells.join('')}</w:tr>`;
  const bordered =
    '<w:tblPr><w:tblBorders><w:top w:val="single"/><w:left w:val="single"/><w:bottom w:val="single"/>' +
    '<w:right w:val="single"/><w:insideH w:val="single"/><w:insideV w:val="single"/></w:tblBorders></w:tblPr>';

  it("an empty form field's prompt is removed, a filled one is kept", async () => {
    const { blocks, report } = await convert(
      `<w:p><w:r><w:t>Nome: </w:t></w:r>${sdt(prompt, true)}</w:p>` +
        `<w:p><w:r><w:t>Comune: </w:t></w:r>${sdt('<w:r><w:t>Udine</w:t></w:r>', false)}</w:p>`,
    );
    expect(texts(blocks)).toEqual(['Nome: ', 'Comune: Udine']);
    expect(report).toContain(
      'removed 1 empty form field showing only Word\'s prompt ("Click or tap here to enter text" — not the author\'s text)',
    );
  });

  it('rows wrapped in a content control are rows of the table', async () => {
    const { blocks } = await convert(
      `<w:tbl>${bordered}` +
        tr(tc(p('Voce')), tc(p('Importo'))) +
        sdt(tr(tc(p('Affitto')), tc(p('1.200'))), false) +
        tr(tc(p('Utenze')), tc(p('300'))) +
        '</w:tbl>',
    );
    const table = blocks.find((b) => b.tag === 'table');
    expect(table).toBeDefined();
    const text = textOf(table as MEl);
    expect(text).toContain('Affitto');
    expect(text).toContain('1.200');
    expect(text).toContain('Utenze');
  });

  it('a placeholder around a row keeps the row and drops only the prompt', async () => {
    const { blocks, report } = await convert(
      `<w:tbl>${bordered}` +
        tr(tc(p('Voce')), tc(p('Importo'))) +
        sdt(tr(tc(p('Altro')), tc(`<w:p>${prompt}</w:p>`)), true) +
        tr(tc(p('Utenze')), tc(p('300'))) +
        '</w:tbl>',
    );
    const text = blocks.map((b) => textOf(b)).join(' ');
    expect(text).toContain('Utenze');
    expect(text).not.toContain('Fare clic');
    expect(report.some((r) => r.startsWith('removed 1 empty form field'))).toBe(true);
  });
});
