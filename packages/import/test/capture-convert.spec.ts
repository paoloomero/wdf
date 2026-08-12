import { readPackage, validateCaptureExt, verifyPackage, type WdfCapture } from '@wdf-dev/core';
import { describe, expect, it } from 'vitest';

import { importDocument } from '../src/document.js';
import {
  CAPTURE_MARK,
  geometryExclusions,
  stripCaptureMarks,
  type CaptureElementGeometry,
  type CapturePageGeometry,
} from '../src/prefilter.js';

// T18.4 acceptance at pipeline level (plan §10.32): a dom-snapshot with a
// JS-mounted video embed converts to a VALID, verified .wdf carrying the
// capture provenance, the marker-free snapshot as dom-snapshot source, and
// the embed placeholder with its link. The same flow through the REAL
// extension is e2e/capture.mjs.

const enc = new TextEncoder();
const dec = new TextDecoder();

// 1×1 red PNG (identifyImage needs real magic bytes).
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

const BASE = 'https://blog.example.com/post/42';
const m = (id: number): string => `${CAPTURE_MARK}="${String(id)}"`;

// The snapshot the extension would ship: cookie banner (fixed), article
// with a photo, and a video iframe the page's JS mounted after load.
const snapshot = `<!DOCTYPE html>
<html ${m(0)} lang="en"><head ${m(1)}><title ${m(2)}>The talk, annotated</title></head>
<body ${m(3)}>
<div ${m(4)}>We use cookies — Accept</div>
<main ${m(5)}><article ${m(6)}>
<h1 ${m(7)}>The talk, annotated</h1>
<p ${m(8)}>Watch the recording and read the notes.</p>
<figure ${m(9)}><img ${m(10)} src="https://blog.example.com/img/cover.png" alt="Cover"></figure>
<iframe ${m(11)} src="https://videos.example.net/embed/talk-42" allow="fullscreen"></iframe>
</article></main>
</body></html>
`;

const geom = (
  id: number,
  tag: string,
  over: Partial<Omit<CaptureElementGeometry, 'id' | 'tag'>> = {},
): CaptureElementGeometry => ({
  id,
  tag,
  rect: { x: 0, y: 100, width: 800, height: 60 },
  display: 'block',
  visibility: 'visible',
  position: 'static',
  ...over,
});

const zero = { x: 0, y: 0, width: 0, height: 0 };
const geometry: CapturePageGeometry = {
  viewport: { width: 800, height: 600, devicePixelRatio: 2 },
  document: { width: 800, height: 2400 },
  elements: [
    geom(0, 'html'),
    geom(1, 'head', { display: 'none', rect: zero }),
    geom(2, 'title', { display: 'none', rect: zero }),
    geom(3, 'body'),
    geom(4, 'div', { position: 'fixed', rect: { x: 0, y: 540, width: 800, height: 60 } }),
    geom(5, 'main'),
    geom(6, 'article'),
    geom(7, 'h1'),
    geom(8, 'p'),
    geom(9, 'figure'),
    geom(10, 'img', { rect: { x: 0, y: 300, width: 640, height: 360 } }),
    geom(11, 'iframe', { rect: { x: 0, y: 700, width: 640, height: 360 } }),
  ],
};

const capture: WdfCapture = {
  capture: '0.1',
  url: BASE,
  capturedAt: '2026-08-10T15:04:05Z',
  userAgent: 'Mozilla/5.0 (Macintosh) Chrome/151',
  viewport: { width: 800, height: 600, devicePixelRatio: 2 },
  mode: 'article',
};

async function convert(): Promise<{ pkg: ReturnType<typeof readPackage>; report: string[] }> {
  const report: string[] = [];
  const images = new Map([['https://blog.example.com/img/cover.png', PNG]]);
  const result = await importDocument(
    {
      kind: 'html',
      text: snapshot,
      baseName: 'talk',
      sourceBytes: enc.encode(stripCaptureMarks(snapshot)),
      sourceName: BASE,
      sourceEncoding: 'utf-8',
      sourceKind: 'dom-snapshot',
    },
    {
      captureExclusions: new Set(geometryExclusions(geometry).map((e) => e.id)),
      captureEmbeds: { baseUrl: BASE, hasPoster: (url) => images.has(url) },
      capture,
      withSource: true,
      loadAsset: (src) =>
        Promise.resolve(
          images.has(src) ? { bytes: images.get(src) as Uint8Array } : { reason: 'not captured' },
        ),
      date: capture.capturedAt,
    },
    report,
  );
  expect(result).toBeDefined();
  return { pkg: readPackage((result as NonNullable<typeof result>).wdfBytes), report };
}

describe('capture conversion (T18.4 acceptance, pipeline level)', () => {
  it('produces a verified package with valid capture provenance', async () => {
    const { pkg } = await convert();
    const verify = await verifyPackage(pkg);
    expect(verify.problems).toEqual([]);
    expect(verify).toMatchObject({ integrity: true, determinism: true, verified: true });
    expect(validateCaptureExt(pkg)).toEqual([]);
    expect(pkg.manifest.extensions).toEqual([
      { name: 'capture', version: '0.1' },
      { name: 'source', version: '0.3' },
    ]);
    const captureJson = JSON.parse(dec.decode(pkg.files.get('ext/capture/capture.json')));
    expect(captureJson).toEqual(capture);
    expect(pkg.manifest.created).toBe(capture.capturedAt);
  });

  it('replaces the JS-mounted video with a placeholder link and keeps the article', async () => {
    const { pkg, report } = await convert();
    const html = dec.decode(pkg.files.get('content/index.html'));
    expect(html).toContain('Watch the recording');
    expect(html).toContain('href="https://videos.example.net/embed/talk-42"');
    expect(html).toContain('Open on videos.example.net');
    expect(html).not.toContain('iframe');
    expect(html).not.toContain('cookies');
    expect(html).not.toContain(CAPTURE_MARK);
    expect(report.some((l) => l.includes('placeholder link'))).toBe(true);
    expect(report.some((l) => l.includes('geometric pre-filter'))).toBe(true);
  });

  it('embeds the marker-free snapshot as a dom-snapshot source', async () => {
    const { pkg } = await convert();
    const sourceJson = JSON.parse(dec.decode(pkg.files.get('ext/source/source.json'))) as {
      source: string;
      kind: string;
      main: string;
      mainName: string;
    };
    expect(sourceJson.source).toBe('0.3');
    expect(sourceJson.kind).toBe('dom-snapshot');
    expect(sourceJson.mainName).toBe(BASE);
    const original = dec.decode(pkg.files.get(sourceJson.main));
    expect(original).not.toContain(CAPTURE_MARK);
    // The original snapshot keeps what the canonical excluded: the delta
    // stays inspectable (cookie banner and iframe are still there).
    expect(original).toContain('We use cookies');
    expect(original).toContain('<iframe');
  });

  it('packages the captured image under content/assets', async () => {
    const { pkg } = await convert();
    const html = dec.decode(pkg.files.get('content/index.html'));
    expect(html).toMatch(/content\/assets\/[0-9a-f]{16}\.png/);
  });
});

describe('stripCaptureMarks', () => {
  it('removes exactly the serializer-emitted marker attributes', () => {
    expect(stripCaptureMarks(snapshot)).not.toContain(CAPTURE_MARK);
    expect(stripCaptureMarks('<p data-wdf-capture="x" data-wdf-cap-x="1">t</p>')).toBe(
      '<p data-wdf-capture="x" data-wdf-cap-x="1">t</p>',
    );
  });
});
