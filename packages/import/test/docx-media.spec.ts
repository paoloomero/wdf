import { validateProfile } from '@wdf-dev/core';
import { describe, expect, it } from 'vitest';

import {
  convertDocx,
  DEFAULT_CAPS,
  ensureIds,
  fixDanglingFragments,
  serializeDocument,
  textOf,
  type MEl,
  type MNode,
} from '@wdf-dev/import';

import { makeDocx, W_NS } from './docx-fixtures.js';

// WP20 T20.5 (plan §10.47): images through relationships into the assets
// pipeline (content-hashed, deduplicated, capped), hyperlink targets from
// rels, referenced bookmarks becoming element ids for internal links.

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** A tiny but genuine PNG (identifyImage checks the signature). */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const EMF = new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x6c, 0x00, 0x00, 0x00]);

function docRels(rels: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<Relationships xmlns="${PKG_REL_NS}">${rels}</Relationships>`
  );
}

function rel(id: string, type: string, target: string, external = false): string {
  return `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`;
}

function drawing(
  relId: string,
  opts: { alt?: string; anchor?: boolean; cx?: number } = {},
): string {
  const wp = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const wrapper = opts.anchor === true ? 'anchor' : 'inline';
  return (
    `<w:r><w:drawing xmlns:wp="${wp}" xmlns:a="${a}" xmlns:r="${R_NS}">` +
    `<wp:${wrapper}>` +
    (opts.cx === undefined ? '' : `<wp:extent cx="${String(opts.cx)}" cy="952500"/>`) +
    `<wp:docPr id="1" name="Picture 1"${opts.alt === undefined ? '' : ` descr="${opts.alt}"`}/>` +
    `<a:graphic><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:blipFill><a:blip r:embed="${relId}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic>` +
    `</wp:${wrapper}></w:drawing></w:r>`
  );
}

function para(inner: string): string {
  return `<w:p>${inner}</w:p>`;
}

function run(text: string): string {
  return `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
}

interface Built {
  body: string;
  rels?: string;
  media?: Record<string, Uint8Array>;
}

async function convert(built: Built, caps = DEFAULT_CAPS) {
  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W_NS}"><w:body>${built.body}<w:sectPr/></w:body></w:document>`;
  const extra: Record<string, Uint8Array | string> = { ...(built.media ?? {}) };
  if (built.rels !== undefined) extra['word/_rels/document.xml.rels'] = docRels(built.rels);
  const report: string[] = [];
  const result = await convertDocx(makeDocx({ document, extra }), report, caps);
  return { ...result, report };
}

function findAll(nodes: MNode[], tag: string): MEl[] {
  return nodes.flatMap((n): MEl[] => {
    if (typeof n === 'string') return [];
    const inner = findAll(n.children, tag);
    return n.tag === tag ? [n, ...inner] : inner;
  });
}

describe('convertDocx — images (T20.5)', () => {
  it('packages an inline PNG with content-hashed name, alt and size', async () => {
    const { blocks, assets, report } = await convert({
      body: para(drawing('rId10', { alt: 'Logo aziendale', cx: 1905000 })),
      rels: rel('rId10', 'image', 'media/image1.png'),
      media: { 'word/media/image1.png': PNG },
    });
    const img = findAll(blocks, 'img')[0];
    expect(img).toBeDefined();
    expect(img?.attrs['src']).toMatch(/^content\/assets\/[0-9a-f]{16}\.png$/);
    expect(img?.attrs['alt']).toBe('Logo aziendale');
    expect(img?.attrs['width']).toBe('200'); // 1905000 EMU / 9525
    expect(img?.attrs['height']).toBe('100');
    expect(assets).toHaveLength(1);
    expect(assets[0]?.mediaType).toBe('image/png');
    expect(report.some((r) => r.includes('imported image "word/media/image1.png"'))).toBe(true);
  });

  it('deduplicates the same media part across two references', async () => {
    const { blocks, assets } = await convert({
      body: para(drawing('rId10')) + para(drawing('rId10')),
      rels: rel('rId10', 'image', 'media/image1.png'),
      media: { 'word/media/image1.png': PNG },
    });
    const imgs = findAll(blocks, 'img');
    expect(imgs).toHaveLength(2);
    expect(imgs[0]?.attrs['src']).toBe(imgs[1]?.attrs['src']);
    expect(assets).toHaveLength(1);
  });

  it('drops non-web-renderable formats (EMF) with a report', async () => {
    const { blocks, assets, report } = await convert({
      body: para(drawing('rId11') + run('testo')),
      rels: rel('rId11', 'image', 'media/image1.emf'),
      media: { 'word/media/image1.emf': EMF },
    });
    expect(findAll(blocks, 'img')).toHaveLength(0);
    expect(assets).toHaveLength(0);
    expect(report.some((r) => r.includes('"emf"') && r.includes('not web-renderable'))).toBe(true);
    expect(textOf(blocks[0] as MEl)).toBe('testo');
  });

  it('drops external image references (zero network)', async () => {
    const { blocks, report } = await convert({
      body: para(drawing('rId12') + run('x')),
      rels: rel('rId12', 'image', 'https://example.com/x.png', true),
    });
    expect(findAll(blocks, 'img')).toHaveLength(0);
    expect(report.some((r) => r.includes('external image'))).toBe(true);
  });

  it('reports floating images anchored inline', async () => {
    const { blocks, report } = await convert({
      body: para(drawing('rId10', { anchor: true })),
      rels: rel('rId10', 'image', 'media/image1.png'),
      media: { 'word/media/image1.png': PNG },
    });
    expect(findAll(blocks, 'img')).toHaveLength(1);
    expect(report.some((r) => r.includes('floating image'))).toBe(true);
  });

  it('resolves legacy VML (w:pict v:imagedata)', async () => {
    const pict =
      `<w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml">` +
      `<v:imagedata xmlns:r="${R_NS}" r:id="rId10" o:title="vecchia" xmlns:o="urn:schemas-microsoft-com:office:office"/>` +
      `</v:shape></w:pict></w:r>`;
    const { blocks } = await convert({
      body: para(pict),
      rels: rel('rId10', 'image', 'media/image1.png'),
      media: { 'word/media/image1.png': PNG },
    });
    const img = findAll(blocks, 'img')[0];
    expect(img?.attrs['src']).toMatch(/^content\/assets\//);
  });

  it('honors the image count cap', async () => {
    const caps = { ...DEFAULT_CAPS, maxCount: 1 };
    const png2 = new Uint8Array([...PNG, 1]);
    const { assets, report } = await convert(
      {
        body: para(drawing('rId1')) + para(drawing('rId2')),
        rels: rel('rId1', 'image', 'media/a.png') + rel('rId2', 'image', 'media/b.png'),
        media: { 'word/media/a.png': PNG, 'word/media/b.png': png2 },
      },
      caps,
    );
    expect(assets).toHaveLength(1);
    expect(report.some((r) => r.includes('max 1 images'))).toBe(true);
  });
});

describe('convertDocx — hyperlinks and bookmarks (T20.5)', () => {
  it('wraps external targets from relationships in <a>', async () => {
    const link = `<w:hyperlink xmlns:r="${R_NS}" r:id="rId20">${run('il sito')}</w:hyperlink>`;
    const { blocks } = await convert({
      body: para(run('Vedi ') + link),
      rels: rel('rId20', 'hyperlink', 'https://wdf.dev/', true),
    });
    const a = findAll(blocks, 'a')[0];
    expect(a?.attrs['href']).toBe('https://wdf.dev/');
    expect(textOf(a as MEl)).toBe('il sito');
  });

  it('unwraps disallowed schemes with a report', async () => {
    const link = `<w:hyperlink xmlns:r="${R_NS}" r:id="rId21">${run('locale')}</w:hyperlink>`;
    const { blocks, report } = await convert({
      body: para(link),
      rels: rel('rId21', 'hyperlink', 'file:///C:/doc.txt', true),
    });
    expect(findAll(blocks, 'a')).toHaveLength(0);
    expect(textOf(blocks[0] as MEl)).toBe('locale');
    expect(report.some((r) => r.includes('scheme not allowed'))).toBe(true);
  });

  it('turns referenced bookmarks into ids and anchors into fragment links', async () => {
    const body =
      para(`<w:hyperlink w:anchor="Sezione_Finale">${run('vai in fondo')}</w:hyperlink>`) +
      para(run('mezzo')) +
      para(
        `<w:bookmarkStart w:id="1" w:name="Sezione_Finale"/><w:bookmarkEnd w:id="1"/>` +
          run('la fine'),
      );
    const { blocks } = await convert({ body });
    const a = findAll(blocks, 'a')[0];
    expect(a?.attrs['href']).toBe('#bm-sezione-finale');
    expect(blocks[2]?.attrs['id']).toBe('bm-sezione-finale');
    // The full chain keeps the link: ids survive ensureIds, nothing dangles.
    const report: string[] = [];
    ensureIds(blocks, report);
    fixDanglingFragments(blocks, report);
    expect(findAll(blocks, 'a')[0]?.attrs['href']).toBe('#bm-sezione-finale');
  });

  it('ignores unreferenced bookmarks (no id litter)', async () => {
    const body = para(
      `<w:bookmarkStart w:id="7" w:name="_GoBack"/><w:bookmarkEnd w:id="7"/>` + run('x'),
    );
    const { blocks } = await convert({ body });
    expect(blocks[0]?.attrs['id']).toBeUndefined();
  });

  it('unwraps links to missing bookmarks', async () => {
    const { blocks, report } = await convert({
      body: para(`<w:hyperlink w:anchor="Fantasma">${run('rotto')}</w:hyperlink>`),
    });
    expect(findAll(blocks, 'a')).toHaveLength(0);
    expect(report.some((r) => r.includes('bookmark that does not exist'))).toBe(true);
  });

  it('images and links serialize to a conforming document', async () => {
    const link = `<w:hyperlink xmlns:r="${R_NS}" r:id="rId20">${run('link')}</w:hyperlink>`;
    const { blocks, stylesheet } = await convert({
      body: para(drawing('rId10', { alt: 'figura' })) + para(run('Testo con ') + link),
      rels:
        rel('rId10', 'image', 'media/image1.png') +
        rel('rId20', 'hyperlink', 'https://wdf.dev/', true),
      media: { 'word/media/image1.png': PNG },
    });
    const report: string[] = [];
    ensureIds(blocks, report);
    fixDanglingFragments(blocks, report);
    const html = serializeDocument('it', 'Media', blocks, stylesheet !== undefined);
    const violations = validateProfile(html).filter((v) => v.severity === 'error');
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});
