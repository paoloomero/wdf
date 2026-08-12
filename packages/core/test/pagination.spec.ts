import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { computeHashes, serializeHashes } from '../src/integrity.js';
import { PAGINATION_PATH, parsePaginationExt, validatePaginationExt } from '../src/pagination.js';
import type { WdfPackage } from '../src/package.js';
import type { WdfManifest } from '../src/types.js';

const enc = new TextEncoder();
const goldenDir = resolve(import.meta.dirname, '../../../fixtures/golden/appendix-a');

// The appendix-a entry document carries, in order: sec-hello, h-hello, p-0001.

function manifestOf(withPagination: boolean): WdfManifest {
  const m: WdfManifest = {
    wdf: '0.1',
    id: 'urn:uuid:6f1f6b2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b',
    title: 'Hello WDF',
    language: 'en',
    created: '2026-08-01T10:00:00Z',
    modified: '2026-08-01T10:00:00Z',
    entry: 'content/index.html',
  };
  if (withPagination) m.extensions = [{ name: 'pagination', version: '0.1' }];
  return m;
}

function paginationJson(breakBefore: unknown): Uint8Array {
  return enc.encode(JSON.stringify({ pagination: '0.1', breakBefore }, null, 2) + '\n');
}

/** A consistent package from the appendix-a golden files, optionally paginated. */
async function paginationPackage(paginationBytes?: Uint8Array): Promise<WdfPackage> {
  const manifest = manifestOf(paginationBytes !== undefined);
  const files = new Map<string, Uint8Array>([
    ['manifest.json', enc.encode(JSON.stringify(manifest, null, 2) + '\n')],
    ['content/index.html', readFileSync(join(goldenDir, 'input.html'))],
    ['ai/content.md', readFileSync(join(goldenDir, 'content.md'))],
    ['ai/outline.json', readFileSync(join(goldenDir, 'outline.json'))],
  ]);
  if (paginationBytes !== undefined) files.set(PAGINATION_PATH, paginationBytes);
  files.set('integrity/hashes.json', enc.encode(serializeHashes(await computeHashes(files))));
  return { manifest, files };
}

describe('validatePaginationExt (ext-pagination §3, §4)', () => {
  it('reports nothing for a package without the extension', async () => {
    expect(validatePaginationExt(await paginationPackage())).toEqual([]);
  });

  it('accepts declared, conforming breaks in document order', async () => {
    const pkg = await paginationPackage(paginationJson(['h-hello', 'p-0001']));
    expect(validatePaginationExt(pkg)).toEqual([]);
  });

  it('rejects a declared pagination without pagination.json (ext-pagination §3)', async () => {
    const pkg = await paginationPackage(paginationJson(['h-hello']));
    pkg.files.delete(PAGINATION_PATH);
    const violations = validatePaginationExt(pkg);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ spec: 'ext-pagination §3', severity: 'error' });
  });

  it('rejects malformed JSON citing ext-pagination §4', async () => {
    const pkg = await paginationPackage(enc.encode('{nope'));
    expect(validatePaginationExt(pkg)[0]).toMatchObject({
      spec: 'ext-pagination §4',
      path: PAGINATION_PATH,
    });
  });

  it('rejects schema violations citing ext-pagination §4', async () => {
    const pkg = await paginationPackage(paginationJson([]));
    const violations = validatePaginationExt(pkg);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.spec).toBe('ext-pagination §4');
    expect(violations[0]?.message).toContain('schema');
  });

  it('rejects an id that does not exist in the entry document (§4)', async () => {
    const pkg = await paginationPackage(paginationJson(['h-hello', 'h-ghost']));
    const violations = validatePaginationExt(pkg);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('h-ghost');
    expect(violations[0]?.spec).toBe('ext-pagination §4');
  });

  it('rejects ids out of document order (§4)', async () => {
    const pkg = await paginationPackage(paginationJson(['p-0001', 'h-hello']));
    const violations = validatePaginationExt(pkg);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('document order');
  });
});

describe('parsePaginationExt (tolerant consumer read, §10.3)', () => {
  it('returns the data for a conforming file', async () => {
    const pkg = await paginationPackage(paginationJson(['h-hello']));
    expect(parsePaginationExt(pkg.files)).toEqual({
      pagination: '0.1',
      breakBefore: ['h-hello'],
    });
  });

  it('returns undefined when absent or non-conforming', async () => {
    expect(parsePaginationExt((await paginationPackage()).files)).toBeUndefined();
    const bad = await paginationPackage(paginationJson('not-a-list'));
    expect(parsePaginationExt(bad.files)).toBeUndefined();
  });

  it('does not police id existence — consumers skip unknown ids', async () => {
    const pkg = await paginationPackage(paginationJson(['h-ghost']));
    expect(parsePaginationExt(pkg.files)?.breakBefore).toEqual(['h-ghost']);
  });
});
