import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { readPackage } from '@wdf-dev/core';
import { describe, expect, it } from 'vitest';

import {
  buildConversionReport,
  classifyNote,
  IMPORT_VERSION,
  reportEntries,
} from '../src/index.js';
import { importDocument } from '../src/document.js';
import { deterministicUuid, documentIdForUrl, DOCUMENT_ID_PATTERN } from '../src/revision.js';

// Review F07 / F04 (plan §10.70): document identity across imports and the
// conversion report that travels inside the package (ext-source 0.6).

const dec = new TextDecoder();
const date = '2026-09-16T09:00:00Z';

function html(body: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Policy</title></head><body>${body}</body></html>`;
}

async function importHtml(text: string, opts: Parameters<typeof importDocument>[1] = {}) {
  const result = await importDocument(
    { kind: 'html', text, baseName: 'policy' },
    { date, ...opts },
  );
  if (result === undefined) throw new Error('no content');
  return { pkg: readPackage(result.wdfBytes), report: result.report, html: result.html };
}

describe('documentIdForUrl', () => {
  it('is a valid UUID URN, stable, and ignores the fragment', async () => {
    const a = await documentIdForUrl('https://example.org/decree/87#sec-2');
    const b = await documentIdForUrl('https://example.org/decree/87');
    expect(a).toMatch(DOCUMENT_ID_PATTERN);
    expect(a).toBe(b);
    expect(await documentIdForUrl('https://example.org/decree/88')).not.toBe(a);
  });

  it('deterministicUuid lays out a digest as version 5 / RFC variant', () => {
    const id = deterministicUuid(
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    );
    expect(id).toBe('urn:uuid:01234567-89ab-5def-8123-456789abcdef');
  });
});

describe('revisions (spec §4.1, §6.4.4)', () => {
  it('an explicit id is recorded as-is; an invalid one is refused', async () => {
    const id = 'urn:uuid:6f1f6b2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
    const { pkg } = await importHtml(html('<h1>Policy</h1><p>Version A</p>'), { id });
    expect(pkg.manifest.id).toBe(id);
    await expect(importHtml(html('<p>x</p>'), { id: 'urn:uuid:NOT-VALID' })).rejects.toThrow(
      '§4.1',
    );
  });

  it('without a previous revision, changed content is a new document (T04 of the review)', async () => {
    const a = await importHtml(html('<h1>Policy</h1><p>Version A</p>'));
    const b = await importHtml(html('<h1>Policy</h1><p>Version B</p>'));
    expect(a.pkg.manifest.id).not.toBe(b.pkg.manifest.id);
  });

  it('with the previous revision: same id, created preserved, unchanged elements keep their ids', async () => {
    const v1 = await importHtml(
      html(
        '<h1>Policy</h1><p>First rule.</p><p>Second rule.</p><ul><li>alpha</li><li>beta</li></ul>',
      ),
      { date: '2026-09-01T00:00:00Z' },
    );
    const previous = {
      id: v1.pkg.manifest.id,
      created: v1.pkg.manifest.created,
      html: dec.decode(v1.pkg.files.get('content/index.html')),
    };
    // A paragraph inserted BEFORE the unchanged ones, one edited, one list item gone.
    const v2 = await importHtml(
      html(
        '<h1>Policy</h1><p>Preamble.</p><p>First rule.</p><p>Second rule, amended.</p><ul><li>beta</li></ul>',
      ),
      { previous },
    );
    expect(v2.pkg.manifest.id).toBe(v1.pkg.manifest.id);
    expect(v2.pkg.manifest.created).toBe('2026-09-01T00:00:00Z');
    expect(v2.pkg.manifest.modified).toBe(date);

    const ids = (h: string): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const m of h.matchAll(/<(p|li) id="([a-z0-9-]+)">([^<]*)</g))
        out[m[3] ?? ''] = m[2] ?? '';
      return out;
    };
    const before = ids(previous.html);
    const after = ids(v2.html);
    // Unchanged text keeps its id even though its position moved.
    expect(after['First rule.']).toBe(before['First rule.']);
    expect(after['beta']).toBe(before['beta']);
    // New or changed text gets a fresh id that never existed before…
    const previousIds = new Set(Object.values(before));
    expect(previousIds.has(after['Preamble.'] ?? '')).toBe(false);
    expect(previousIds.has(after['Second rule, amended.'] ?? '')).toBe(false);
    // …continuing the counters, not restarting them (p-0001/p-0002 were taken).
    expect(after['Preamble.']).toBe('p-0003');
    expect(after['Second rule, amended.']).toBe('p-0004');
    expect(v2.report.some((l) => l.includes('3 element id(s) inherited, 2 new'))).toBe(true);
    // The heading slug is stable by construction.
    expect(v2.html).toContain('<h1 id="h-policy">');
  });

  it('an explicit id wins over the inherited one', async () => {
    const v1 = await importHtml(html('<h1>Policy</h1><p>A</p>'));
    const id = 'urn:uuid:6f1f6b2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
    const v2 = await importHtml(html('<h1>Policy</h1><p>B</p>'), {
      id,
      previous: {
        id: v1.pkg.manifest.id,
        html: dec.decode(v1.pkg.files.get('content/index.html')),
      },
    });
    expect(v2.pkg.manifest.id).toBe(id);
  });
});

describe('conversion report (ext-source 0.6)', () => {
  it('classifies notes by wording and aggregates identical ones in order', () => {
    expect(classifyNote('dropped <button> (not representable)')).toBe('loss');
    expect(classifyNote('promoted styled paragraph (26pt) to <h1>: "x"')).toBe('change');
    expect(classifyNote('imported image "a.png" → content/assets/x.png')).toBe('info');
    expect(reportEntries(['dropped x', 'imported y', 'dropped x'])).toEqual([
      { kind: 'loss', message: 'dropped x', count: 2 },
      { kind: 'info', message: 'imported y', count: 1 },
    ]);
  });

  it('is deterministic canonical JSON with tool, version and source digest', () => {
    const a = buildConversionReport(['dropped x'], 'ab'.repeat(32), '0.1.0');
    const b = buildConversionReport(['dropped x'], 'ab'.repeat(32), '0.1.0');
    expect(a).toBe(b);
    expect(a.endsWith('\n')).toBe(true);
    expect(JSON.parse(a)).toMatchObject({
      report: '0.1',
      tool: '@wdf-dev/import',
      toolVersion: '0.1.0',
      sourceDigest: 'ab'.repeat(32),
    });
  });

  it('IMPORT_VERSION matches package.json', () => {
    const pkg = JSON.parse(
      readFileSync(join(resolve(import.meta.dirname, '..'), 'package.json'), 'utf8'),
    ) as { version: string };
    expect(IMPORT_VERSION).toBe(pkg.version);
  });

  it('travels in the package with --with-source and is declared in source.json', async () => {
    const text = html('<h1>Doc</h1><p>Body</p><button>Click</button>');
    const result = await importDocument(
      { kind: 'html', text, baseName: 'doc', sourceBytes: new TextEncoder().encode(text) },
      { date, withSource: true },
    );
    if (result === undefined) throw new Error('no content');
    const pkg = readPackage(result.wdfBytes);
    expect(pkg.manifest.extensions).toEqual([{ name: 'source', version: '0.6' }]);
    const source = JSON.parse(dec.decode(pkg.files.get('ext/source/source.json'))) as {
      source: string;
      report: string;
    };
    expect(source.source).toBe('0.6');
    expect(source.report).toBe('ext/source/report.json');
    const report = JSON.parse(dec.decode(pkg.files.get('ext/source/report.json'))) as {
      entries: { kind: string; message: string }[];
      sourceDigest: string;
    };
    expect(report.sourceDigest).toMatch(/^[0-9a-f]{64}$/);
    // Every console note of this conversion is in the package, its own line included.
    for (const line of result.report) {
      expect(report.entries.some((e) => e.message === line)).toBe(true);
    }
    expect(report.entries.some((e) => e.message.startsWith('recorded the conversion report'))).toBe(
      true,
    );
  });

  it('is absent without the source extension', async () => {
    const { pkg } = await importHtml(html('<h1>Doc</h1><p>Body</p>'));
    expect(pkg.files.has('ext/source/report.json')).toBe(false);
  });
});
