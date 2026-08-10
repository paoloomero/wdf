import { parseHtml, readPackage } from '@wdf/core';
import { describe, expect, it } from 'vitest';

import { importDocument } from '../src/document.js';
import {
  CAPTURE_MARK,
  geometryExclusions,
  pruneCaptureMarks,
  type CaptureElementGeometry,
  type CapturePageGeometry,
} from '../src/prefilter.js';

// T18.3 (plan §10.32): the geometric pre-filter — enumerable rules over
// what only the rendering knows, as a pure geometries→exclusions function
// (paginatePlan style), applied upstream of the WP16 landmark. Key
// acceptance: a Wikipedia-like snapshot converts without the §10.27
// interlanguage noise.

const geom = (
  id: number,
  tag: string,
  over: Partial<Omit<CaptureElementGeometry, 'id' | 'tag'>> = {},
): CaptureElementGeometry => ({
  id,
  tag,
  rect: { x: 0, y: 40, width: 800, height: 50 },
  display: 'block',
  visibility: 'visible',
  position: 'static',
  ...over,
});

const page = (elements: CaptureElementGeometry[]): CapturePageGeometry => ({
  viewport: { width: 800, height: 600, devicePixelRatio: 1 },
  document: { width: 800, height: 4000 },
  elements,
});

describe('geometryExclusions (plan §10.31 rules)', () => {
  it('excludes hidden, invisible, fixed/sticky and off-flow elements, with reasons', () => {
    const exclusions = geometryExclusions(
      page([
        geom(0, 'div', { display: 'none', rect: { x: 0, y: 0, width: 0, height: 0 } }),
        geom(1, 'aside', { visibility: 'hidden' }),
        geom(2, 'tr', { visibility: 'collapse' }),
        geom(3, 'header', { position: 'sticky' }),
        geom(4, 'div', { position: 'fixed' }),
        geom(5, 'a', { rect: { x: -9999, y: 40, width: 120, height: 20 } }),
        geom(6, 'p'),
      ]),
    );
    expect(exclusions).toEqual([
      { id: 0, tag: 'div', reason: 'hidden' },
      { id: 1, tag: 'aside', reason: 'invisible' },
      { id: 2, tag: 'tr', reason: 'invisible' },
      { id: 3, tag: 'header', reason: 'fixed-sticky' },
      { id: 4, tag: 'div', reason: 'fixed-sticky' },
      { id: 5, tag: 'a', reason: 'off-flow' },
    ]);
  });

  it('never excludes document structure or metadata elements (browser reports them display:none)', () => {
    const exclusions = geometryExclusions(
      page(
        ['html', 'head', 'title', 'meta', 'link', 'style', 'script', 'body'].map((tag, i) =>
          geom(i, tag, { display: 'none', rect: { x: 0, y: 0, width: 0, height: 0 } }),
        ),
      ),
    );
    expect(exclusions).toEqual([]);
  });

  it('treats off-flow strictly: zero-extent or partially-visible elements stay', () => {
    const exclusions = geometryExclusions(
      page([
        // Empty inline box at the origin: x + width <= 0 but no extent.
        geom(0, 'span', { rect: { x: 0, y: 100, width: 0, height: 0 } }),
        // Peeks into the document box: not fully outside.
        geom(1, 'div', { rect: { x: -50, y: 100, width: 60, height: 40 } }),
        // Below the fold is NOT off-flow: the document box extends past the viewport.
        geom(2, 'section', { rect: { x: 0, y: 3500, width: 800, height: 400 } }),
        // Fully above the document box.
        geom(3, 'div', { rect: { x: 0, y: -200, width: 800, height: 100 } }),
      ]),
    );
    expect(exclusions).toEqual([{ id: 3, tag: 'div', reason: 'off-flow' }]);
  });

  it('needs no entries for descendants: pruning removes whole subtrees', () => {
    // The dropdown <ul> is display:none; its <li>/<a> children report their
    // own display (inline/list-item) with zero rects — they must NOT match
    // any rule on their own (zero extent is never off-flow).
    const exclusions = geometryExclusions(
      page([
        geom(0, 'ul', { display: 'none', rect: { x: 0, y: 0, width: 0, height: 0 } }),
        geom(1, 'li', { display: 'list-item', rect: { x: 0, y: 0, width: 0, height: 0 } }),
        geom(2, 'a', { display: 'inline', rect: { x: 0, y: 0, width: 0, height: 0 } }),
      ]),
    );
    expect(exclusions).toEqual([{ id: 0, tag: 'ul', reason: 'hidden' }]);
  });
});

describe('pruneCaptureMarks', () => {
  const marked =
    `<!DOCTYPE html><html ${CAPTURE_MARK}="0"><head ${CAPTURE_MARK}="1"></head>` +
    `<body ${CAPTURE_MARK}="2"><nav ${CAPTURE_MARK}="3"><a ${CAPTURE_MARK}="4" href="/x">menu</a></nav>` +
    `<p ${CAPTURE_MARK}="5">testo</p></body></html>`;

  it('drops excluded subtrees and strips every marker', () => {
    const { doc, removed } = pruneCaptureMarks(parseHtml(marked), new Set([3]));
    expect(removed).toBe(1);
    const html = doc.html;
    expect(html).not.toBeNull();
    const walk = (el: NonNullable<typeof html>): string[] => [
      ...el.attrs.map((a) => a.name),
      ...el.children.flatMap((c) => (c.kind === 'element' ? walk(c) : [])),
    ];
    expect(walk(html as NonNullable<typeof html>)).not.toContain(CAPTURE_MARK);
    const text = JSON.stringify(doc);
    expect(text).not.toContain('menu');
    expect(text).toContain('testo');
  });

  it('leaves the input tree untouched (pure)', () => {
    const parsed = parseHtml(marked);
    pruneCaptureMarks(parsed, new Set([3]));
    expect(JSON.stringify(parsed)).toContain('menu');
  });
});

describe('Wikipedia-like acceptance (T18.3, §10.27 noise)', () => {
  // A dom-snapshot the extension would ship: language dropdown hidden
  // INSIDE main (so the WP16 landmark alone cannot save us), sticky
  // header, fixed cookie banner, off-screen skip link.
  const m = (id: number): string => `${CAPTURE_MARK}="${String(id)}"`;
  const snapshot = `<!DOCTYPE html>
<html ${m(0)} lang="it"><head ${m(1)}><title ${m(2)}>Alessandro Volta</title></head>
<body ${m(3)}>
<header ${m(4)}><nav ${m(5)}><a ${m(6)} href="/">Wikipedia</a></nav></header>
<div ${m(7)}>Questo sito usa i cookie — Accetta</div>
<a ${m(8)} href="#content">Vai al contenuto</a>
<main ${m(9)}>
<ul ${m(10)}><li ${m(11)}><a ${m(12)} href="/de">Deutsch</a></li><li ${m(13)}><a ${m(14)} href="/fr">Français</a></li></ul>
<article ${m(15)}><h1 ${m(16)}>Alessandro Volta</h1>
<p ${m(17)}>Alessandro Volta è stato un fisico italiano, inventore della pila.</p></article>
</main>
</body></html>
`;
  const zero = { x: 0, y: 0, width: 0, height: 0 };
  const geometry = page([
    geom(0, 'html'),
    geom(1, 'head', { display: 'none', rect: zero }),
    geom(2, 'title', { display: 'none', rect: zero }),
    geom(3, 'body'),
    geom(4, 'header', { position: 'sticky', rect: { x: 0, y: 0, width: 800, height: 60 } }),
    geom(5, 'nav', { rect: { x: 0, y: 0, width: 800, height: 60 } }),
    geom(6, 'a', { display: 'inline', rect: { x: 10, y: 10, width: 100, height: 20 } }),
    geom(7, 'div', { position: 'fixed', rect: { x: 0, y: 540, width: 800, height: 60 } }),
    geom(8, 'a', { display: 'inline', rect: { x: -9999, y: 0, width: 120, height: 20 } }),
    geom(9, 'main'),
    geom(10, 'ul', { display: 'none', rect: zero }),
    geom(11, 'li', { display: 'list-item', rect: zero }),
    geom(12, 'a', { display: 'inline', rect: zero }),
    geom(13, 'li', { display: 'list-item', rect: zero }),
    geom(14, 'a', { display: 'inline', rect: zero }),
    geom(15, 'article'),
    geom(16, 'h1', { rect: { x: 0, y: 80, width: 800, height: 40 } }),
    geom(17, 'p', { rect: { x: 0, y: 130, width: 800, height: 60 } }),
  ]);

  const convert = async (withPrefilter: boolean): Promise<string> => {
    const opts: Parameters<typeof importDocument>[1] = { date: '2026-08-10T12:00:00Z' };
    if (withPrefilter) {
      opts.captureExclusions = new Set(geometryExclusions(geometry).map((e) => e.id));
    }
    const result = await importDocument(
      { kind: 'html', text: snapshot, baseName: 'wikipedia-like' },
      opts,
    );
    expect(result).toBeDefined();
    const pkg = readPackage((result as NonNullable<typeof result>).wdfBytes);
    return new TextDecoder().decode(pkg.files.get('ai/content.md'));
  };

  it('the canonical keeps the article and loses the interlanguage list and page chrome', async () => {
    const md = await convert(true);
    expect(md).toContain('Alessandro Volta');
    expect(md).toContain('fisico italiano');
    expect(md).not.toContain('Deutsch');
    expect(md).not.toContain('Français');
    expect(md).not.toContain('cookie');
    expect(md).not.toContain('Vai al contenuto');
  });

  it('without the pre-filter the noise IS in the canonical (control)', async () => {
    const md = await convert(false);
    expect(md).toContain('Deutsch');
  });

  it('the exclusion reasons name the four §10.31 rules on this page', async () => {
    const reasons = geometryExclusions(geometry);
    expect(reasons).toEqual([
      { id: 4, tag: 'header', reason: 'fixed-sticky' },
      { id: 7, tag: 'div', reason: 'fixed-sticky' },
      { id: 8, tag: 'a', reason: 'off-flow' },
      { id: 10, tag: 'ul', reason: 'hidden' },
    ]);
  });
});
