import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { WdfOutline } from '@wdf-dev/core';
import { describe, expect, it } from 'vitest';

import {
  agentBlocks,
  buildSrcdoc,
  citation,
  inlineResources,
  mimeFor,
  outlineTree,
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
