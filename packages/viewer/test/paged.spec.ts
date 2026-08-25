import { describe, expect, it } from 'vitest';

import {
  buildPrintSrcdoc,
  buildSrcdoc,
  CONTROLLER_JS,
  paginatePlan,
  type PlanUnit,
} from '../src/prepare.js';

// WP10 (plan §10.20): paper view on screen, real pagination in print/PDF.

const enc = new TextEncoder();
const entry =
  '<html><head><title>x</title></head><body><article><p id="p-0001">Ciao</p></article></body></html>';

describe('buildPrintSrcdoc (WP10)', () => {
  it('carries the paged-media sheet and the break rules', () => {
    const out = buildPrintSrcdoc(entry, new Map());
    expect(out).toContain('@page { size: A4; margin: 20mm; }');
    expect(out).toContain('break-after: avoid');
    expect(out).toContain('display: table-header-group');
    // Top-level sections start on a fresh page — never the first one.
    expect(out).toContain('article > h1:not(:first-child)');
    expect(out).toContain('break-before: page');
  });

  it('is script-free with a CSP that allows no scripts at all', () => {
    const out = buildPrintSrcdoc(entry, new Map());
    expect(out).not.toContain('<script');
    expect(out).toContain("default-src 'none'");
    expect(out).not.toContain('script-src');
  });

  it('inlines embedded fonts like the screen view', () => {
    const files = new Map<string, Uint8Array>([
      [
        'ext/fonts/fonts.css',
        enc.encode('@font-face { src: url("ext/fonts/f.woff2") format("woff2"); }'),
      ],
      ['ext/fonts/f.woff2', new Uint8Array([1, 2, 3])],
    ]);
    expect(buildPrintSrcdoc(entry, files)).toContain('data:font/woff2;base64,');
  });
});

describe('paper view on screen (WP17, plan §10.26)', () => {
  it('ships the sheet styles, the paginator and the controller toggle', () => {
    const out = buildSrcdoc(entry, new Map(), 'n');
    expect(out).toContain('.wdf-sheet {');
    expect(out).toContain('width: 210mm');
    expect(out).toContain('wdfSetPaged');
    expect(CONTROLLER_JS).toContain("d.type === 'wdf-paged'");
  });

  it('measures at the print content width so line breaks match the PDF', () => {
    const out = buildSrcdoc(entry, new Map(), 'n');
    expect(out).toContain('article.wdf-measure');
    expect(out).toContain('width: 170mm');
  });
});

describe('cited-element mark (UI fix, 25 Aug)', () => {
  it('ships a persistent selection style and marks on click and on scroll', () => {
    const out = buildSrcdoc(entry, new Map(), 'n');
    expect(out).toContain('.wdf-selected');
    // The controller marks the target both when the reader clicks in the
    // document and when a citation arrives from the outline/agent view.
    expect(CONTROLLER_JS).toContain('function wdfMark');
    const scrollHandler = CONTROLLER_JS.slice(CONTROLLER_JS.indexOf("'wdf-scroll'"));
    expect(scrollHandler).toContain('wdfMark(t)');
    const clickHandler = CONTROLLER_JS.slice(
      CONTROLLER_JS.indexOf("document.addEventListener('click'"),
    );
    expect(clickHandler).toContain('wdfMark(el)');
  });
});

describe('paginatePlan (WP17)', () => {
  const u = (h: number, extra: Partial<PlanUnit> = {}): PlanUnit => ({ h, ...extra });

  it('fills a sheet and overflows to the next', () => {
    expect(paginatePlan([u(30), u(30), u(30)], 100)).toEqual([0]);
    expect(paginatePlan([u(40), u(40), u(40)], 90)).toEqual([0, 2]);
  });

  it('opens a fresh sheet on breakBefore, but never for the first unit', () => {
    expect(paginatePlan([u(10, { breakBefore: true }), u(10)], 100)).toEqual([0]);
    expect(paginatePlan([u(10), u(10, { breakBefore: true }), u(10)], 100)).toEqual([0, 1]);
  });

  it('keeps a heading with its following block', () => {
    // heading (keepWithNext) would be the last unit of sheet 1 → moves over.
    expect(paginatePlan([u(40), u(30, { keepWithNext: true }), u(50)], 100)).toEqual([0, 1]);
  });

  it('gives up pulling a keep-with-next chain that fills the whole sheet', () => {
    const plan = paginatePlan(
      [u(50, { keepWithNext: true }), u(40, { keepWithNext: true }), u(30)],
      100,
    );
    expect(plan).toEqual([0, 2]);
  });

  it('gives an oversized unit a sheet of its own', () => {
    expect(paginatePlan([u(10), u(500), u(10)], 100)).toEqual([0, 1, 2]);
  });
});
