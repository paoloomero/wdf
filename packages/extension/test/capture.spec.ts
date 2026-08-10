// @vitest-environment jsdom
import { DEFAULT_CAPS } from '@wdf/import';
import { describe, expect, it } from 'vitest';

import {
  CAPTURE_CAPS,
  collectImages,
  collectStylesheets,
  snapshotAndMeasure,
  type ElementGeometry,
  type ImageLike,
  type SheetLike,
} from '../src/capture.js';
import { buildDiagnostic } from '../src/diagnostic.js';
import type { CaptureRequest } from '../src/protocol.js';

// T18.2 (plan §10.31/§10.32): the capture engine's assembly logic, with
// the DOM edges injected. Real geometry and the CSSOM/canvas paths are
// exercised by the e2e smoke (e2e/capture.mjs) with the extension loaded.

const zeroGeometry: Omit<ElementGeometry, 'id' | 'tag'> = {
  rect: { x: 0, y: 0, width: 0, height: 0 },
  display: 'block',
  visibility: 'visible',
  position: 'static',
};

describe('snapshotAndMeasure', () => {
  it('stamps sequential markers aligned with the geometry array', () => {
    document.documentElement.innerHTML =
      '<head><title>Doc</title></head><body><nav><a href="#x">x</a></nav><p>hi</p></body>';
    const { snapshot, elements } = snapshotAndMeasure(document, (el) => ({
      ...zeroGeometry,
      display: el.tagName === 'NAV' ? 'none' : 'block',
    }));
    // Marker N in the snapshot corresponds to elements[N].
    for (const [i, e] of elements.entries()) expect(e.id).toBe(i);
    expect(elements[0]?.tag).toBe('html');
    const navEntry = elements.find((e) => e.tag === 'nav');
    expect(navEntry?.display).toBe('none');
    expect(snapshot.html).toContain(`data-wdf-cap="${String(navEntry?.id ?? -1)}"`);
    expect(snapshot.title).toBe('Doc');
  });

  it('does not touch the live document', () => {
    document.documentElement.innerHTML = '<head></head><body><p>live</p></body>';
    snapshotAndMeasure(document, () => zeroGeometry);
    expect(document.querySelector('[data-wdf-cap]')).toBeNull();
  });

  it('rewrites img src to the rendered URL and drops srcset/sizes', () => {
    document.documentElement.innerHTML =
      '<head></head><body><img src="/a.png" srcset="/a-2x.png 2x" sizes="100vw" alt=""></body>';
    const { snapshot } = snapshotAndMeasure(document, () => zeroGeometry);
    expect(snapshot.html).not.toContain('srcset');
    expect(snapshot.html).not.toContain('sizes');
    // jsdom resolves .src against the document base URL.
    expect(snapshot.html).toContain(`src="${document.querySelector('img')?.src ?? ''}"`);
  });
});

describe('collectStylesheets', () => {
  const sheet = (href: string | null, rules: string[], imports = 0): SheetLike => ({
    href,
    cssRules: [
      ...Array.from({ length: imports }, (_, i) => ({
        cssText: `@import url("x${String(i)}.css");`,
        constructor: { name: 'CSSImportRule' },
      })),
      ...rules.map((cssText) => ({ cssText, constructor: { name: 'CSSStyleRule' } })),
    ],
  });
  const blocked = (href: string): SheetLike =>
    ({
      href,
      get cssRules(): never {
        throw new DOMException('blocked', 'SecurityError');
      },
    }) as unknown as SheetLike;

  it('reads accessible sheets via CSSOM, skipping inline <style>', async () => {
    const report: string[] = [];
    const out = await collectStylesheets(
      [sheet(null, ['p { color: red; }']), sheet('https://a/x.css', ['b { color: blue; }'])],
      [],
      () => Promise.reject(new Error('no fetch expected')),
      report,
    );
    expect(out).toEqual([
      { href: 'https://a/x.css', css: 'b { color: blue; }\n', origin: 'cssom' },
    ]);
    expect(report).toEqual([]);
  });

  it('falls back to fetch when CSSOM is blocked, and reports double failures', async () => {
    const report: string[] = [];
    const out = await collectStylesheets(
      [blocked('https://cdn/ok.css'), blocked('https://cdn/gone.css')],
      [],
      (url) =>
        url.endsWith('ok.css')
          ? Promise.resolve('q { margin: 0; }')
          : Promise.reject(new Error('CORS')),
      report,
    );
    expect(out).toEqual([{ href: 'https://cdn/ok.css', css: 'q { margin: 0; }', origin: 'fetch' }]);
    expect(report).toEqual([
      'stylesheet not captured (CSSOM blocked, fetch failed): https://cdn/gone.css',
    ]);
  });

  it('reports @import rules as a declared limit and serializes adopted sheets', async () => {
    const report: string[] = [];
    const out = await collectStylesheets(
      [sheet('https://a/i.css', ['p { x: y; }'], 2)],
      [sheet(null, ['host { z: w; }'])],
      () => Promise.reject(new Error('unused')),
      report,
    );
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ href: '(adopted)', origin: 'cssom' });
    expect(report).toEqual(['stylesheet https://a/i.css: 2 @import rule(s) not localized']);
  });
});

describe('collectImages', () => {
  const img = (url: string): ImageLike => ({ currentSrc: url, src: url });
  const data = (n: number): { base64: string; mediaType: string } => ({
    base64: 'A'.repeat(Math.ceil((n * 4) / 3)),
    mediaType: 'image/png',
  });

  it('prefers the render (canvas), falls back to page fetch, reports failures', async () => {
    const report: string[] = [];
    const out = await collectImages(
      [img('https://a/clean.png'), img('https://b/tainted.png'), img('https://b/gone.png')],
      (i) => (i.currentSrc.includes('clean') ? data(10) : undefined),
      (url) =>
        url.includes('tainted') ? Promise.resolve(data(20)) : Promise.reject(new Error('403')),
      CAPTURE_CAPS,
      report,
    );
    expect(out.map((i) => [i.url, i.origin])).toEqual([
      ['https://a/clean.png', 'canvas'],
      ['https://b/tainted.png', 'fetch'],
    ]);
    expect(report).toEqual([
      'image not captured (render unreadable, fetch failed): https://b/gone.png',
    ]);
  });

  it('deduplicates by rendered URL and skips data: URIs', async () => {
    const report: string[] = [];
    const out = await collectImages(
      [img('https://a/x.png'), img('https://a/x.png'), img('data:image/png;base64,AAAA')],
      () => data(5),
      () => Promise.reject(new Error('unused')),
      CAPTURE_CAPS,
      report,
    );
    expect(out).toHaveLength(1);
    expect(report).toEqual([]);
  });

  it('enforces per-file, total and count caps with report lines', async () => {
    const report: string[] = [];
    const caps = { perFile: 100, totalBytes: 150, maxCount: 2 };
    const out = await collectImages(
      [img('https://a/1.png'), img('https://a/2.png'), img('https://a/3.png')],
      (i) => (i.currentSrc.includes('1') ? data(200) : data(90)),
      () => Promise.reject(new Error('unused')),
      caps,
      report,
    );
    // 1 is over per-file; 2 fits; 3 is over the count cap.
    expect(out.map((i) => i.url)).toEqual(['https://a/2.png']);
    expect(report[0]).toContain('per-file cap');
    expect(report[1]).toContain('count cap');
  });
});

describe('caps stay in sync with @wdf/import', () => {
  it('CAPTURE_CAPS mirrors DEFAULT_CAPS (content bundle must not import the pipeline)', () => {
    expect(CAPTURE_CAPS.perFile).toBe(DEFAULT_CAPS.perFile);
    expect(CAPTURE_CAPS.totalBytes).toBe(DEFAULT_CAPS.totalBytes);
    expect(CAPTURE_CAPS.maxCount).toBe(DEFAULT_CAPS.maxCount);
  });
});

describe('buildDiagnostic', () => {
  it('summarizes the capture with geometry counts and byte sizes', () => {
    const request: CaptureRequest = {
      type: 'wdf-capture',
      provenance: {
        url: 'https://example.com/',
        capturedAt: '2026-08-10T12:00:00Z',
        userAgent: 'UA',
        viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      },
      snapshot: {
        doctype: '<!DOCTYPE html>\n',
        html: '<html/>',
        baseUrl: 'https://example.com/',
        title: 'T',
        lang: 'en',
      },
      stylesheets: [{ href: 'https://example.com/a.css', css: 'p{}', origin: 'cssom' }],
      images: [
        {
          url: 'https://example.com/i.png',
          base64: 'AAAA',
          mediaType: 'image/png',
          origin: 'canvas',
        },
      ],
      geometry: {
        viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
        document: { width: 1280, height: 4000 },
        elements: [
          {
            id: 0,
            tag: 'html',
            rect: { x: 0, y: 0, width: 1, height: 1 },
            display: 'block',
            visibility: 'visible',
            position: 'static',
          },
          {
            id: 1,
            tag: 'nav',
            rect: { x: 0, y: 0, width: 0, height: 0 },
            display: 'none',
            visibility: 'visible',
            position: 'static',
          },
          {
            id: 2,
            tag: 'header',
            rect: { x: 0, y: 0, width: 1, height: 1 },
            display: 'block',
            visibility: 'visible',
            position: 'sticky',
          },
        ],
      },
      report: ['note'],
    };
    const d = buildDiagnostic(request);
    expect(d.geometry).toEqual({
      documentSize: { width: 1280, height: 4000 },
      elements: 3,
      hidden: 1,
      fixedOrSticky: 1,
    });
    expect(d.stylesheets[0]?.bytes).toBe(3);
    expect(d.images[0]?.bytes).toBe(3);
    expect(d.report).toEqual(['note']);
  });
});
