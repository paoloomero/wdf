import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { WdfOutline } from '@wdf-dev/core';
import { describe, expect, it } from 'vitest';

import {
  agentBlocks,
  BASE_CSS,
  buildSrcdoc,
  citation,
  CONTROLLER_JS,
  conversionReport,
  inlineResources,
  mimeFor,
  outlineTree,
  parseSourceExt,
  toDataUri,
} from '../src/prepare.js';

const enc = new TextEncoder();
const goldenDir = resolve(import.meta.dirname, '../../../fixtures/golden');

describe('resource inlining', () => {
  it('maps extensions to the profile image types (§6.3.3)', () => {
    expect(mimeFor('content/assets/a.png')).toBe('image/png');
    expect(mimeFor('content/assets/a.svg')).toBe('image/svg+xml');
    expect(mimeFor('content/assets/a.webp')).toBe('image/webp');
    expect(mimeFor('content/assets/photo.JPEG')).toBe('image/jpeg');
  });

  it('rewrites img sources to data: URIs and inlines the stylesheet', () => {
    const files = new Map<string, Uint8Array>([
      ['content/styles.css', enc.encode('article { color: red }')],
      ['content/assets/logo.svg', enc.encode('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ]);
    const html =
      '<html><head><link rel="stylesheet" href="content/styles.css" /></head>' +
      '<body><img src="content/assets/logo.svg" alt="" /></body></html>';
    const out = inlineResources(html, files);
    expect(out).toContain('<style>');
    expect(out).toContain('article { color: red }');
    expect(out).not.toContain('href="content/styles.css"');
    expect(out).toContain(
      `src="${toDataUri('content/assets/logo.svg', files.get('content/assets/logo.svg') ?? new Uint8Array())}"`,
    );
    expect(out).not.toContain('src="content/assets/logo.svg"');
  });
});

describe('sandboxed srcdoc (spec §11.1)', () => {
  const html = readFileSync(join(goldenDir, 'appendix-a', 'input.html'), 'utf8');

  it('injects a restrictive CSP and the nonce-gated controller', () => {
    const out = buildSrcdoc(html, new Map(), 'testnonce');
    expect(out).toContain("default-src 'none'");
    expect(out).toContain("script-src 'nonce-testnonce'");
    expect(out).toContain('<script nonce="testnonce">');
    expect(out).toContain('wdf-click');
    // The document's own content is untouched.
    expect(out).toContain('<p id="p-0001">');
  });

  it('makes no external references', () => {
    const out = buildSrcdoc(html, new Map(), 'n');
    expect(out).not.toMatch(/src="https?:/);
    expect(out).not.toMatch(/href="https?:/);
  });
});

describe('agent view blocks (T4.3)', () => {
  it('splits golden markdown into blocks tagged with their anchor ids', () => {
    const md = readFileSync(join(goldenDir, 'appendix-a', 'content.md'), 'utf8');
    const blocks = agentBlocks(md);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.ids).toEqual(['h-hello', 'sec-hello']);
    expect(blocks[1]?.ids).toEqual(['p-0001']);
    // Raw text is preserved exactly.
    expect(blocks.map((b) => b.text).join('\n\n') + '\n').toBe(md);
  });

  it('ignores escaped braces in content', () => {
    const blocks = agentBlocks('text with \\{#not-an-anchor\\} inside {#p-0001}\n');
    expect(blocks[0]?.ids).toEqual(['p-0001']);
  });
});

describe('outline tree and citations (T4.4)', () => {
  it('rebuilds the tree from parent links', () => {
    const md = readFileSync(join(goldenDir, 'delibera-mini', 'outline.json'), 'utf8');
    const outline = JSON.parse(md) as WdfOutline;
    const tree = outlineTree(outline);
    const sections = tree.filter((n) => n.node.type === 'section');
    expect(sections.map((s) => s.node.id)).toEqual([
      'sec-premesse',
      'sec-dispositivo',
      'sec-pubblicazione',
    ]);
    const dispositivo = sections[1];
    expect(dispositivo?.children.some((c) => c.node.id === 'tbl-impegni')).toBe(true);
    const bq = tree.length > 0 ? outline.find((n) => n.id === 'p-0002') : undefined;
    expect(bq?.parent).toBe('bq-norma');
  });

  it('formats citations per spec §7.10', () => {
    expect(citation('urn:uuid:a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', 'tbl-spesa-2025')).toBe(
      'wdf:urn:uuid:a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d#tbl-spesa-2025',
    );
  });
});

describe('Plain view and typed-data mark (plan §10.70)', () => {
  const enc = new TextEncoder();
  const html =
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>T</title><link rel="stylesheet" href="content/styles.css"></head><body><article><h1 id="h-t">T</h1></article></body></html>';
  const files = new Map<string, Uint8Array>([
    ['content/styles.css', enc.encode('p { color: red }')],
    [
      'ext/fonts/fonts.css',
      enc.encode('@font-face { font-family: X; src: url("ext/fonts/x.woff2"); }'),
    ],
    ['ext/fonts/x.woff2', new Uint8Array([1, 2, 3])],
  ]);

  it('buildSrcdoc drops the author stylesheet and the fonts sheet when plain', () => {
    const styled = buildSrcdoc(html, files, 'n');
    expect(styled).toContain('p { color: red }');
    expect(styled).toContain('font-family: X');
    const plain = buildSrcdoc(html, files, 'n', { plain: true });
    expect(plain).not.toContain('p { color: red }');
    expect(plain).not.toContain('font-family: X');
    expect(plain).not.toContain('<link');
    // Base styles and the controller stay: the view is still a WDF frame.
    expect(plain).toContain('.wdf-selected');
    expect(plain).toContain('wdf-click');
  });

  it('the frame controller marks bound tables only on the wdf-datasets message', () => {
    expect(CONTROLLER_JS).toContain("d.type === 'wdf-datasets'");
    expect(CONTROLLER_JS).toContain("classList.toggle('wdf-datasets-ok'");
    expect(BASE_CSS).toContain('html.wdf-datasets-ok table[data-wdf-dataset] > caption::after');
  });
});

describe('conversion report (ext-source 0.6)', () => {
  const enc = new TextEncoder();
  const report = {
    report: '0.1',
    tool: '@wdf-dev/import',
    toolVersion: '0.1.0',
    sourceDigest: 'ab'.repeat(32),
    entries: [
      { kind: 'loss', message: 'dropped <button>', count: 3 },
      { kind: 'change', message: 'promoted styled paragraph', count: 1 },
      { kind: 'info', message: 'imported image', count: 2 },
      { kind: 'weird', message: 'unknown kind reads as info', count: 0 },
    ],
  };
  const files = new Map<string, Uint8Array>([
    [
      'ext/source/source.json',
      enc.encode(
        JSON.stringify({
          source: '0.6',
          kind: 'fetched-html',
          main: 'ext/source/a.html',
          mainName: 'a.html',
          encoding: 'utf-8',
          resources: {},
          report: 'ext/source/report.json',
        }),
      ),
    ],
    ['ext/source/a.html', enc.encode('<p>a</p>')],
    ['ext/source/report.json', enc.encode(JSON.stringify(report))],
  ]);

  it('parseSourceExt exposes the report path when the file exists', () => {
    const ext = parseSourceExt(files);
    expect(ext?.report).toBe('ext/source/report.json');
    const dangling = new Map(files);
    dangling.delete('ext/source/report.json');
    expect(parseSourceExt(dangling)?.report).toBeUndefined();
  });

  it('conversionReport reads entries, totals and tolerates odd values', () => {
    const ext = parseSourceExt(files);
    if (ext === undefined) throw new Error('no ext');
    const view = conversionReport(files, ext);
    expect(view?.tool).toBe('@wdf-dev/import');
    expect(view?.losses).toBe(3);
    expect(view?.changes).toBe(1);
    expect(view?.entries.at(-1)).toEqual({
      kind: 'info',
      message: 'unknown kind reads as info',
      count: 1,
    });
  });

  it('a malformed report is simply absent', () => {
    const broken = new Map(files);
    broken.set('ext/source/report.json', enc.encode('{ not json'));
    const ext = parseSourceExt(broken);
    if (ext === undefined) throw new Error('no ext');
    expect(conversionReport(broken, ext)).toBeUndefined();
  });
});
