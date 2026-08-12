import { validateProfile } from '@wdf-dev/core';
import { describe, expect, it } from 'vitest';

import { convertDocx, ensureIds, serializeDocument, textOf, type MEl } from '@wdf-dev/import';

import { makeDocx, W_NS } from './docx-fixtures.js';

// WP20 T20.3 (plan §10.47): lists from numbering.xml — numFmt decides
// ul/ol, ilvl decides nesting, numbering restarts split top-level lists;
// what the profile cannot express (nested restarts) merges with a report.

const NUMBERING_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<w:numbering xmlns:w="${W_NS}">` +
  '<w:abstractNum w:abstractNumId="0">' +
  '<w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl>' +
  '<w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl>' +
  '</w:abstractNum>' +
  '<w:abstractNum w:abstractNumId="1">' +
  '<w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl>' +
  '<w:lvl w:ilvl="1"><w:numFmt w:val="lowerLetter"/></w:lvl>' +
  '</w:abstractNum>' +
  '<w:abstractNum w:abstractNumId="2">' +
  '<w:lvl w:ilvl="0"><w:numFmt w:val="chicago"/></w:lvl>' +
  '</w:abstractNum>' +
  '<w:abstractNum w:abstractNumId="3">' +
  '<w:lvl w:ilvl="0"><w:numFmt w:val="none"/></w:lvl>' +
  '</w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
  '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
  '<w:num w:numId="3"><w:abstractNumId w:val="1"/></w:num>' +
  '<w:num w:numId="4"><w:abstractNumId w:val="2"/></w:num>' +
  '<w:num w:numId="5"><w:abstractNumId w:val="3"/></w:num>' +
  '<w:num w:numId="6"><w:abstractNumId w:val="0"/>' +
  '<w:lvlOverride w:ilvl="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:lvlOverride>' +
  '</w:num>' +
  '</w:numbering>';

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<w:styles xmlns:w="${W_NS}">` +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
  '<w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="ListStyle"><w:name w:val="ListStyle"/>' +
  '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:style>' +
  '</w:styles>';

function docWith(body: string): Uint8Array {
  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W_NS}"><w:body>${body}<w:sectPr/></w:body></w:document>`;
  return makeDocx({
    document,
    extra: { 'word/numbering.xml': NUMBERING_XML, 'word/styles.xml': STYLES_XML },
  });
}

function li(text: string, numId: string, ilvl = 0, extraPPr = ''): string {
  return (
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="${String(ilvl)}"/><w:numId w:val="${numId}"/></w:numPr>${extraPPr}</w:pPr>` +
    `<w:r><w:t>${text}</w:t></w:r></w:p>`
  );
}

function para(text: string, pPr = ''): string {
  return `<w:p>${pPr === '' ? '' : `<w:pPr>${pPr}</w:pPr>`}<w:r><w:t>${text}</w:t></w:r></w:p>`;
}

async function convert(body: string): Promise<{ blocks: MEl[]; report: string[] }> {
  const report: string[] = [];
  const { blocks } = await convertDocx(docWith(body), report);
  return { blocks, report };
}

function shape(block: MEl | undefined): string {
  if (block === undefined) return '?';
  if (block.tag === 'ul' || block.tag === 'ol') {
    return `${block.tag}(${block.children
      .filter((c): c is MEl => typeof c !== 'string')
      .map(shape)
      .join(',')})`;
  }
  if (block.tag === 'li') {
    const nested = block.children.find(
      (c): c is MEl => typeof c !== 'string' && (c.tag === 'ul' || c.tag === 'ol'),
    );
    return nested === undefined ? 'li' : `li[${shape(nested)}]`;
  }
  return block.tag;
}

describe('convertDocx — lists', () => {
  it('groups consecutive bullet paragraphs into one ul', async () => {
    const { blocks } = await convert(li('uno', '1') + li('due', '1') + li('tre', '1'));
    expect(blocks).toHaveLength(1);
    expect(shape(blocks[0])).toBe('ul(li,li,li)');
    expect(textOf(blocks[0] as MEl)).toBe('unoduetre');
  });

  it('maps numeric formats to ol (letters and romans included)', async () => {
    const { blocks, report } = await convert(li('primo', '2') + li('secondo', '2'));
    expect(shape(blocks[0])).toBe('ol(li,li)');
    expect(report).toHaveLength(0);
  });

  it('nests deeper ilvl inside the previous item', async () => {
    const { blocks } = await convert(
      li('a', '2') + li('a1', '2', 1) + li('a2', '2', 1) + li('b', '2'),
    );
    expect(blocks).toHaveLength(1);
    expect(shape(blocks[0])).toBe('ol(li[ol(li,li)],li)');
  });

  it('a plain paragraph ends the group; the next list starts fresh', async () => {
    const { blocks } = await convert(li('a', '1') + para('interruzione') + li('b', '1'));
    expect(blocks.map((b) => b.tag)).toEqual(['ul', 'p', 'ul']);
  });

  it('a numbering restart at the top level splits the lists', async () => {
    const { blocks } = await convert(li('a', '2') + li('b', '2') + li('x', '3'));
    expect(blocks.map((b) => b.tag)).toEqual(['ol', 'ol']);
    expect(shape(blocks[0])).toBe('ol(li,li)');
    expect(shape(blocks[1])).toBe('ol(li)');
  });

  it('kind change at the top level splits the lists', async () => {
    const { blocks } = await convert(li('a', '1') + li('n', '2'));
    expect(blocks.map((b) => b.tag)).toEqual(['ul', 'ol']);
  });

  it('numbering through the style chain makes a list item', async () => {
    const { blocks } = await convert(para('da stile', '<w:pStyle w:val="ListStyle"/>'));
    expect(shape(blocks[0])).toBe('ul(li)');
  });

  it('numId 0 cancels inherited numbering', async () => {
    const { blocks } = await convert(
      para('niente lista', '<w:pStyle w:val="ListStyle"/><w:numPr><w:numId w:val="0"/></w:numPr>'),
    );
    expect(blocks[0]?.tag).toBe('p');
  });

  it('numFmt none is a plain paragraph', async () => {
    const { blocks } = await convert(li('nascosto', '5'));
    expect(blocks[0]?.tag).toBe('p');
  });

  it('lvlOverride wins over the abstract format', async () => {
    const { blocks } = await convert(li('override', '6'));
    expect(blocks[0]?.tag).toBe('ol');
  });

  it('missing definition falls back to ul with a report', async () => {
    const { blocks, report } = await convert(li('orfano', '99'));
    expect(blocks[0]?.tag).toBe('ul');
    expect(report.some((r) => r.includes('without a numbering definition'))).toBe(true);
  });

  it('exotic formats become a plain ol with a report', async () => {
    const { blocks, report } = await convert(li('esotico', '4'));
    expect(blocks[0]?.tag).toBe('ol');
    expect(report.some((r) => r.includes('chicago'))).toBe(true);
  });

  it('a numbered heading stays a heading, with a report', async () => {
    const { blocks, report } = await convert(
      para(
        '1. Capitolo',
        '<w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>',
      ),
    );
    expect(blocks[0]?.tag).toBe('h1');
    expect(report.some((r) => r.includes('numbered heading'))).toBe(true);
  });

  it('a group starting deep re-nests under the later, shallower root', async () => {
    const { blocks } = await convert(li('profondo', '1', 1) + li('radice', '1'));
    expect(blocks).toHaveLength(1);
    expect(shape(blocks[0])).toBe('ul(li[ul(li)],li)');
  });

  it('list items drop translated indent (structure conveys it)', async () => {
    const { blocks } = await convert(li('testo', '1', 0, '<w:ind w:left="720"/>'));
    const item = (blocks[0]?.children ?? []).find((c): c is MEl => typeof c !== 'string');
    expect(item?.attrs['__wdf_style'] ?? '').not.toContain('margin-left');
  });

  it('nested lists serialize to a conforming document', async () => {
    const { blocks } = await convert(
      para('Titolo', '<w:pStyle w:val="Heading1"/>') +
        li('a', '2') +
        li('a1', '2', 1) +
        li('b', '2') +
        li('puntato', '1') +
        para('chiusura'),
    );
    const report: string[] = [];
    ensureIds(blocks, report);
    const html = serializeDocument('it', 'Liste', blocks, false);
    const violations = validateProfile(html).filter((v) => v.severity === 'error');
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});
