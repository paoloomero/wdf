import { describe, expect, it } from 'vitest';

import { buildPrintSrcdoc, buildSrcdoc, CONTROLLER_JS } from '../src/prepare.js';

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

describe('paper view on screen (WP10)', () => {
  it('ships the wdf-paged sheet and the controller toggle', () => {
    const out = buildSrcdoc(entry, new Map(), 'n');
    expect(out).toContain('html.wdf-paged article');
    expect(out).toContain('width: 210mm');
    expect(CONTROLLER_JS).toContain("d.type === 'wdf-paged'");
  });

  it('gives section boundaries breathing space in the paper view', () => {
    const out = buildSrcdoc(entry, new Map(), 'n');
    expect(out).toContain('html.wdf-paged article > h1:not(:first-child)');
    expect(out).toContain('margin-top: 3.5em');
  });
});
