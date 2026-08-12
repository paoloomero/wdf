import { validateProfile } from '@wdf-dev/core';
import { describe, expect, it } from 'vitest';

import {
  convertDocx,
  ensureIds,
  fixDanglingFragments,
  serializeDocument,
  textOf,
  type MEl,
  type MNode,
} from '@wdf-dev/import';

import { makeDocx, W_NS } from './docx-fixtures.js';

// WP20 T20.7 (plan §10.47): footnotes/endnotes → final Notes section (sup
// reference + backlink, unified numbering); TOC dropped (the outline is
// derived); OMML flattened to text; tracked moves accept-final.

const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

function notesXml(kind: 'footnotes' | 'endnotes', notes: [string, string][]): string {
  const local = kind === 'footnotes' ? 'footnote' : 'endnote';
  const body = notes
    .map(
      ([id, text]) =>
        `<w:${local} w:id="${id}"><w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:${local}>`,
    )
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:${kind} xmlns:w="${W_NS}">` +
    `<w:${local} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:${local}>` +
    body +
    `</w:${kind}>`
  );
}

function para(inner: string): string {
  return `<w:p>${inner}</w:p>`;
}

function run(text: string): string {
  return `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
}

function noteRef(kind: 'footnote' | 'endnote', id: string): string {
  return `<w:r><w:${kind}Reference w:id="${id}"/></w:r>`;
}

async function convert(body: string, extra: Record<string, Uint8Array | string> = {}) {
  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W_NS}"><w:body>${body}<w:sectPr/></w:body></w:document>`;
  const report: string[] = [];
  const result = await convertDocx(makeDocx({ document, extra }), report);
  return { ...result, report };
}

function findAll(nodes: MNode[], tag: string): MEl[] {
  return nodes.flatMap((n): MEl[] => {
    if (typeof n === 'string') return [];
    const inner = findAll(n.children, tag);
    return n.tag === tag ? [n, ...inner] : inner;
  });
}

describe('convertDocx — footnotes and endnotes (T20.7)', () => {
  it('moves a footnote to the final Notes section with sup reference and backlink', async () => {
    const { blocks, report } = await convert(
      para(run('Testo con nota') + noteRef('footnote', '1') + run('.')),
      { 'word/footnotes.xml': notesXml('footnotes', [['1', 'La nota vera e propria.']]) },
    );
    const sup = findAll(blocks, 'sup')[0];
    expect(sup?.attrs['id']).toBe('noteref-1');
    expect((sup?.children[0] as MEl).attrs['href']).toBe('#note-1');
    expect(textOf(sup as MEl)).toBe('1');
    // Final section: h2 + ol > li#note-1 with text and backlink.
    const h2 = blocks.find((b) => b.tag === 'h2');
    expect(textOf(h2 as MEl)).toBe('Notes');
    const li = findAll(blocks, 'li')[0];
    expect(li?.attrs['id']).toBe('note-1');
    expect(textOf(li as MEl)).toContain('La nota vera e propria.');
    const back = findAll([li as MEl], 'a').find((a) => a.attrs['href'] === '#noteref-1');
    expect(back).toBeDefined();
    expect(report.some((r) => r.includes('moved 1 note'))).toBe(true);
  });

  it('unifies footnote and endnote numbering by reference order', async () => {
    const { blocks } = await convert(
      para(run('a') + noteRef('endnote', '5') + run('b') + noteRef('footnote', '2')),
      {
        'word/footnotes.xml': notesXml('footnotes', [['2', 'piede']]),
        'word/endnotes.xml': notesXml('endnotes', [['5', 'coda']]),
      },
    );
    const lis = findAll(blocks, 'li');
    expect(lis.map((l) => l.attrs['id'])).toEqual(['note-1', 'note-2']);
    expect(textOf(lis[0] as MEl)).toContain('coda'); // endnote referenced first
    expect(textOf(lis[1] as MEl)).toContain('piede');
  });

  it('a note referenced twice keeps one number; only the first sup carries the id', async () => {
    const { blocks } = await convert(
      para(run('x') + noteRef('footnote', '1') + run('y') + noteRef('footnote', '1')),
      { 'word/footnotes.xml': notesXml('footnotes', [['1', 'unica']]) },
    );
    const sups = findAll(blocks, 'sup');
    expect(sups).toHaveLength(2);
    expect(sups[0]?.attrs['id']).toBe('noteref-1');
    expect(sups[1]?.attrs['id']).toBeUndefined();
    expect(findAll(blocks, 'li')).toHaveLength(1);
  });

  it('keeps inline formatting inside notes and titles the section by language', async () => {
    const styles =
      '<?xml version="1.0"?>' +
      `<w:styles xmlns:w="${W_NS}"><w:docDefaults><w:rPrDefault><w:rPr>` +
      '<w:lang w:val="it-IT"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>';
    const notes =
      '<?xml version="1.0"?>' +
      `<w:footnotes xmlns:w="${W_NS}"><w:footnote w:id="1"><w:p>` +
      '<w:r><w:rPr><w:i/></w:rPr><w:t>corsivo</w:t></w:r>' +
      '</w:p></w:footnote></w:footnotes>';
    const { blocks } = await convert(para(run('x') + noteRef('footnote', '1')), {
      'word/footnotes.xml': notes,
      'word/styles.xml': styles,
    });
    expect(textOf(blocks.find((b) => b.tag === 'h2') as MEl)).toBe('Note');
    const li = findAll(blocks, 'li')[0];
    expect(findAll([li as MEl], 'em')).toHaveLength(1);
  });

  it('drops references without a matching note; no empty Notes section', async () => {
    const { blocks, report } = await convert(para(run('x') + noteRef('footnote', '99')), {
      'word/footnotes.xml': notesXml('footnotes', [['1', 'inutile']]),
    });
    expect(findAll(blocks, 'sup')).toHaveLength(0);
    expect(blocks.every((b) => b.tag !== 'h2')).toBe(true);
    expect(report.some((r) => r.includes('without a matching note'))).toBe(true);
  });

  it('ids and links survive ensureIds + fixDanglingFragments; profile-valid', async () => {
    const { blocks, stylesheet } = await convert(
      para(run('Con nota') + noteRef('footnote', '1')) + para(run('Altro testo.')),
      { 'word/footnotes.xml': notesXml('footnotes', [['1', 'contenuto nota']]) },
    );
    const report: string[] = [];
    ensureIds(blocks, report);
    fixDanglingFragments(blocks, report);
    const sup = findAll(blocks, 'sup')[0];
    expect((sup?.children[0] as MEl).attrs['href']).toBe('#note-1');
    const html = serializeDocument('en', 'Note', blocks, stylesheet !== undefined);
    const violations = validateProfile(html).filter((v) => v.severity === 'error');
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});

describe('convertDocx — fields, math, moves (T20.7)', () => {
  it('drops a TOC content control whole, with a report', async () => {
    const sdt =
      '<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/></w:docPartObj></w:sdtPr>' +
      '<w:sdtContent>' +
      para(run('Indice')) +
      para(run('Capitolo 1' + '\t' + '3')) +
      '</w:sdtContent></w:sdt>';
    const { blocks, report } = await convert(sdt + para(run('vero contenuto')));
    expect(blocks).toHaveLength(1);
    expect(textOf(blocks[0] as MEl)).toBe('vero contenuto');
    expect(report.some((r) => r.includes('table of contents dropped'))).toBe(true);
  });

  it('drops a TOC fldSimple but keeps other simple fields (final view)', async () => {
    const { blocks, report } = await convert(
      para(
        '<w:fldSimple w:instr=" TOC \\o &quot;1-3&quot; ">' +
          run('vecchio indice') +
          '</w:fldSimple>',
      ) + para('<w:fldSimple w:instr=" AUTHOR ">' + run('Paolo') + '</w:fldSimple>'),
    );
    expect(blocks).toHaveLength(1);
    expect(textOf(blocks[0] as MEl)).toBe('Paolo');
    expect(report.some((r) => r.includes('table of contents dropped'))).toBe(true);
  });

  it('flattens OMML math to its text with a report', async () => {
    const math =
      `<m:oMath xmlns:m="${M_NS}"><m:r><m:t>E=mc</m:t></m:r>` +
      `<m:sSup><m:e><m:r><m:t></m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>`;
    const { blocks, report } = await convert(para(run('Formula: ') + math));
    expect(textOf(blocks[0] as MEl)).toBe('Formula: E=mc2');
    expect(report.some((r) => r.includes('math formula flattened'))).toBe(true);
  });

  it('accepts tracked moves at destination, drops the source', async () => {
    const { blocks } = await convert(
      para(
        '<w:moveTo w:id="1">' +
          run('spostato qui') +
          '</w:moveTo><w:moveFrom w:id="2"><w:r><w:t>vecchia posizione</w:t></w:r></w:moveFrom>',
      ),
    );
    expect(textOf(blocks[0] as MEl)).toBe('spostato qui');
  });

  it('reports charts distinctly from plain drawings', async () => {
    const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    const chart = `<w:r><w:drawing xmlns:a="${a}"><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"/></a:graphic></w:drawing></w:r>`;
    const { report } = await convert(para(chart + run('testo')));
    expect(report.some((r) => r.includes('chart without an embedded picture'))).toBe(true);
  });
});
