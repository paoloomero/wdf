import { validateProfile } from '@wdf-dev/core';
import { describe, expect, it } from 'vitest';

import { convertDocx, ensureIds, serializeDocument, textOf, type MEl } from '@wdf-dev/import';

import { makeDocx, W_NS } from './docx-fixtures.js';

// WP20 T20.2 (plan §10.47): paragraphs/runs with the style chain resolved
// (docDefaults → basedOn → direct), headings from outlineLvl and built-in
// names, semantic inline mapping, typography → generated stylesheet.

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<w:styles xmlns:w="${W_NS}">` +
  '<w:docDefaults><w:rPrDefault><w:rPr>' +
  '<w:rFonts w:ascii="Calibri"/><w:sz w:val="22"/><w:lang w:val="it-IT"/>' +
  '</w:rPr></w:rPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Base"><w:name w:val="base"/><w:rPr><w:i/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Base"/>' +
  '<w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="240"/></w:pPr>' +
  '<w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="2F5496"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Sottotitolo2"><w:name w:val="heading 2"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Titolo"><w:name w:val="Title"/><w:rPr><w:sz w:val="56"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="BoldPara"><w:name w:val="boldish"/><w:rPr><w:b/></w:rPr></w:style>' +
  '<w:style w:type="character" w:styleId="Enfasi"><w:name w:val="Emphasis"/><w:rPr><w:i/></w:rPr></w:style>' +
  '</w:styles>';

function docWith(body: string): Uint8Array {
  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W_NS}"><w:body>${body}<w:sectPr/></w:body></w:document>`;
  return makeDocx({ document, extra: { 'word/styles.xml': STYLES_XML } });
}

function p(inner: string, pPr = ''): string {
  return `<w:p>${pPr === '' ? '' : `<w:pPr>${pPr}</w:pPr>`}${inner}</w:p>`;
}

function run(text: string, rPr = ''): string {
  return `<w:r>${rPr === '' ? '' : `<w:rPr>${rPr}</w:rPr>`}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}

async function convert(
  body: string,
): Promise<{ blocks: MEl[]; stylesheet?: string; report: string[] }> {
  const report: string[] = [];
  const result = await convertDocx(docWith(body), report);
  return {
    blocks: result.blocks,
    ...(result.stylesheet !== undefined && { stylesheet: result.stylesheet }),
    report,
  };
}

describe('convertDocx — headings and style chain', () => {
  it('maps outlineLvl and built-in names to h1..h6; Title to h1', async () => {
    const { blocks } = await convert(
      p(run('Il titolo'), '<w:pStyle w:val="Titolo"/>') +
        p(run('Capitolo'), '<w:pStyle w:val="Heading1"/>') +
        p(run('Paragrafo per nome'), '<w:pStyle w:val="Sottotitolo2"/>') +
        p(run('Testo')),
    );
    // One Title next to a Heading 1: the Title stays the only h1 (§10.93).
    expect(blocks.map((b) => b.tag)).toEqual(['h1', 'h2', 'h3', 'p']);
  });

  // Plan §10.93: Title + Heading 1 would give two <h1>. With exactly one
  // Title, every other heading moves one level down; without a Title nothing
  // moves and no title is invented.
  it('one Title: the other headings move one level down, and the report says so', async () => {
    const { blocks, report } = await convert(
      p(run('Relazione'), '<w:pStyle w:val="Titolo"/>') +
        p(run('Capitolo 1'), '<w:pStyle w:val="Heading1"/>') +
        p(run('Paragrafo'), '<w:pStyle w:val="Sottotitolo2"/>') +
        p(run('Capitolo 2'), '<w:pStyle w:val="Heading1"/>') +
        p(run('Profondo'), '<w:outlineLvl w:val="5"/>'),
    );
    expect(blocks.map((b) => b.tag)).toEqual(['h1', 'h2', 'h3', 'h2', 'h6']);
    expect(report).toContain(
      'the paragraph in the "Title" style is the only <h1>: 3 other headings moved one level down',
    );
  });

  it('several Heading 1 and no Title: nothing moves', async () => {
    const { blocks, report } = await convert(
      p(run('Capitolo 1'), '<w:pStyle w:val="Heading1"/>') +
        p(run('Capitolo 2'), '<w:pStyle w:val="Heading1"/>'),
    );
    expect(blocks.map((b) => b.tag)).toEqual(['h1', 'h1']);
    expect(report.join('\n')).not.toContain('moved one level down');
  });

  it('a Title with no other h1: nothing moves', async () => {
    const { blocks } = await convert(
      p(run('Relazione'), '<w:pStyle w:val="Titolo"/>') +
        p(run('Paragrafo'), '<w:pStyle w:val="Sottotitolo2"/>'),
    );
    expect(blocks.map((b) => b.tag)).toEqual(['h1', 'h2']);
  });

  it('two paragraphs in the Title style: ambiguous, nothing moves', async () => {
    const { blocks } = await convert(
      p(run('Relazione'), '<w:pStyle w:val="Titolo"/>') +
        p(run('Seconda riga'), '<w:pStyle w:val="Titolo"/>') +
        p(run('Capitolo'), '<w:pStyle w:val="Heading1"/>'),
    );
    expect(blocks.map((b) => b.tag)).toEqual(['h1', 'h1', 'h1']);
  });

  it('resolves the chain: docDefaults → basedOn → style → direct', async () => {
    const { blocks, stylesheet } = await convert(p(run('Capo'), '<w:pStyle w:val="Heading1"/>'));
    const h1 = blocks[0];
    expect(h1?.tag).toBe('h1');
    // Base contributes italic (em); Heading1's bold is native on headings.
    expect(h1?.children.some((c) => typeof c !== 'string' && c.tag === 'em')).toBe(true);
    expect(textOf(h1 as MEl)).toBe('Capo');
    // Typography from the chain lands in the generated class:
    const cls = h1?.attrs['class'];
    expect(cls).toBeDefined();
    expect(stylesheet).toContain(`.${cls ?? ''} {`);
    expect(stylesheet).toContain('font-size: 16pt'); // sz 32 half-points
    expect(stylesheet).toContain('color: #2f5496');
    expect(stylesheet).toContain('margin-top: 12pt'); // spacing before 240tw
  });

  it('direct run properties override the chain (toggle off)', async () => {
    const { blocks } = await convert(
      p(run('grassetto') + run(' normale', '<w:b w:val="0"/>'), '<w:pStyle w:val="BoldPara"/>'),
    );
    const children = blocks[0]?.children ?? [];
    expect(children.some((c) => typeof c !== 'string' && c.tag === 'strong')).toBe(true);
    // The toggled-off run stays outside any strong:
    expect(textOf(blocks[0] as MEl)).toBe('grassetto normale');
    const strong = children.find((c) => typeof c !== 'string' && c.tag === 'strong');
    expect(textOf(strong as MEl)).toBe('grassetto');
  });
});

describe('convertDocx — inline semantics and typography', () => {
  it('maps bold/italic/vertAlign to strong/em/sup-sub', async () => {
    const { blocks } = await convert(
      p(
        run('piano ') +
          run('forte', '<w:b/>') +
          run(' corsivo', '<w:rStyle w:val="Enfasi"/>') +
          run('2', '<w:vertAlign w:val="superscript"/>'),
      ),
    );
    const kids = (blocks[0]?.children ?? []).filter((c) => typeof c !== 'string');
    expect(kids.map((c) => (c as MEl).tag)).toEqual(['strong', 'em', 'sup']);
  });

  it('translates underline/strike/highlight/caps into a generated class', async () => {
    const { blocks, stylesheet } = await convert(
      p(run('evidente', '<w:u w:val="single"/><w:strike/><w:highlight w:val="yellow"/><w:caps/>')),
    );
    expect(stylesheet).toContain('text-decoration: underline line-through');
    expect(stylesheet).toContain('background-color: #ffff00');
    expect(stylesheet).toContain('text-transform: uppercase');
    expect(textOf(blocks[0] as MEl)).toBe('evidente');
  });

  it('hoists a uniform run style onto the paragraph (docDefaults case)', async () => {
    const { blocks, stylesheet } = await convert(p(run('solo testo')));
    const para = blocks[0];
    // No span survives; the paragraph carries the class.
    expect(para?.children).toEqual(['solo testo']);
    expect(para?.attrs['class']).toBeDefined();
    expect(stylesheet).toContain('font-family: Calibri, sans-serif');
    expect(stylesheet).toContain('font-size: 11pt');
  });

  it('keeps per-run spans when runs differ', async () => {
    const { blocks } = await convert(
      p(run('rosso', '<w:color w:val="FF0000"/>') + run(' e blu', '<w:color w:val="0000FF"/>')),
    );
    const kids = (blocks[0]?.children ?? []).filter((c) => typeof c !== 'string') as MEl[];
    expect(kids).toHaveLength(2);
    expect(kids.every((k) => k.tag === 'span')).toBe(true);
  });

  it('merges adjacent runs with identical formatting', async () => {
    const { blocks } = await convert(p(run('uno ', '<w:b/>') + run('due', '<w:b/>')));
    const kids = (blocks[0]?.children ?? []).filter((c) => typeof c !== 'string') as MEl[];
    expect(kids).toHaveLength(1);
    expect(textOf(kids[0] as MEl)).toBe('uno due');
  });

  it('maps alignment, breaks and tabs', async () => {
    const { blocks, stylesheet } = await convert(
      p(`<w:r><w:t>a</w:t><w:br/><w:t>b</w:t><w:tab/><w:t>c</w:t></w:r>`, '<w:jc w:val="both"/>'),
    );
    expect(stylesheet).toContain('text-align: justify');
    const kids = blocks[0]?.children ?? [];
    expect(kids.some((c) => typeof c !== 'string' && c.tag === 'br')).toBe(true);
    expect(textOf(blocks[0] as MEl)).toBe('ab c');
  });
});

describe('convertDocx — structure, drops and reports', () => {
  it('drops empty paragraphs with one aggregate report line', async () => {
    const { blocks, report } = await convert(p(run('pieno')) + '<w:p/><w:p/>');
    expect(blocks).toHaveLength(1);
    expect(report.some((r) => r.includes('2 empty paragraphs'))).toBe(true);
  });

  it('degrades gracefully: rowless table, dangling link, empty drawing — text preserved', async () => {
    const { blocks, report } = await convert(
      '<w:tbl/>' + // rowless: dropped with a report (tables convert since T20.4)
        p(
          '<w:hyperlink r:id="rId9" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
            run('link testo') +
            '</w:hyperlink>',
        ) +
        p('<w:r><w:drawing/></w:r>' + run('con immagine')),
    );
    expect(report.some((r) => r.includes('table with no rows'))).toBe(true);
    expect(report.some((r) => r.includes('without a resolvable external target'))).toBe(true);
    expect(report.some((r) => r.includes('drawing without an embedded picture'))).toBe(true);
    expect(textOf(blocks[0] as MEl)).toBe('link testo');
    expect(textOf(blocks[1] as MEl)).toBe('con immagine');
  });

  it('accepts tracked insertions and drops deletions (final view)', async () => {
    const { blocks, report } = await convert(
      p(
        '<w:ins w:id="1">' +
          run('nuovo') +
          '</w:ins><w:del w:id="2"><w:r><w:delText>vecchio</w:delText></w:r></w:del>',
      ),
    );
    expect(textOf(blocks[0] as MEl)).toBe('nuovo');
    expect(report.some((r) => r.includes('deletion dropped'))).toBe(true);
  });

  it('reads the document language from docDefaults', async () => {
    const report: string[] = [];
    expect((await convertDocx(docWith(p(run('x'))), report)).language).toBe('it-IT');
  });
});

describe('convertDocx — profile-valid end to end', () => {
  it('blocks serialize to a conforming WDF-HTML document', async () => {
    const { blocks, stylesheet } = await convert(
      p(run('Il titolo'), '<w:pStyle w:val="Titolo"/>') +
        p(
          run('Testo con ') +
            run('enfasi', '<w:b/>') +
            run(' e apice', '<w:vertAlign w:val="superscript"/>'),
          '<w:jc w:val="both"/>',
        ) +
        p(run('Sezione'), '<w:pStyle w:val="Heading1"/>') +
        p(run('Altro testo.')),
    );
    const report: string[] = [];
    ensureIds(blocks, report);
    const html = serializeDocument('it-IT', 'Il titolo', blocks, stylesheet !== undefined);
    const violations = validateProfile(html).filter((v) => v.severity === 'error');
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});

// Plan §10.93: a document written by a script can cite "Title"/"Heading1"
// without defining them (no styles.xml) — Word always writes the definitions.
// The name is then unknowable: the default English and Italian ids decide,
// and the report says so. A defined style is never second-guessed by its id.
describe('convertDocx — heading styles cited but not defined', () => {
  async function convertBare(body: string): Promise<{ tags: string[]; report: string[] }> {
    const report: string[] = [];
    const document =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<w:document xmlns:w="${W_NS}"><w:body>${body}<w:sectPr/></w:body></w:document>`;
    const result = await convertDocx(makeDocx({ document }), report);
    return { tags: result.blocks.map((b) => b.tag), report };
  }

  it('reads the English default ids: Title, Heading1..3', async () => {
    const { tags, report } = await convertBare(
      p(run('Relazione'), '<w:pStyle w:val="Title"/>') +
        p(run('Premessa'), '<w:pStyle w:val="Heading1"/>') +
        p(run('Dettaglio'), '<w:pStyle w:val="Heading2"/>') +
        p(run('Sotto'), '<w:pStyle w:val="Heading3"/>') +
        p(run('Testo')),
    );
    expect(tags).toEqual(['h1', 'h2', 'h3', 'h4', 'p']);
    expect(report).toContain(
      'style "Title" is not defined in the document — read as a heading from its id alone',
    );
  });

  it('reads the Italian default ids: Titolo, Titolo1..3', async () => {
    const { tags } = await convertBare(
      p(run('Relazione'), '<w:pStyle w:val="Titolo"/>') +
        p(run('Premessa'), '<w:pStyle w:val="Titolo1"/>') +
        p(run('Dettaglio'), '<w:pStyle w:val="Titolo2"/>') +
        p(run('Sotto'), '<w:pStyle w:val="Titolo3"/>'),
    );
    expect(tags).toEqual(['h1', 'h2', 'h3', 'h4']);
  });

  it('leaves any other undefined style a paragraph, silently', async () => {
    const { tags, report } = await convertBare(
      p(run('Una riga'), '<w:pStyle w:val="Subtitle"/>') +
        p(run('Altra riga'), '<w:pStyle w:val="Heading7"/>'),
    );
    expect(tags).toEqual(['p', 'p']);
    expect(report).toEqual([]);
  });

  it('a document with no styles at all converts to plain paragraphs', async () => {
    const { tags, report } = await convertBare(p(run('Prima riga')) + p(run('Seconda riga')));
    expect(tags).toEqual(['p', 'p']);
    expect(report).toEqual([]);
  });

  it('never overrides a defined style: the name decides, not the id', async () => {
    // "Heading1" defined as an ordinary style (name "body text") stays a paragraph.
    const styles =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<w:styles xmlns:w="${W_NS}">` +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="body text"/></w:style>' +
      '</w:styles>';
    const document =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<w:document xmlns:w="${W_NS}"><w:body>` +
      p(run('Non un titolo'), '<w:pStyle w:val="Heading1"/>') +
      '<w:sectPr/></w:body></w:document>';
    const report: string[] = [];
    const result = await convertDocx(
      makeDocx({ document, extra: { 'word/styles.xml': styles } }),
      report,
    );
    expect(result.blocks.map((b) => b.tag)).toEqual(['p']);
  });
});
