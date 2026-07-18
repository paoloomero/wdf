import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { computeHashes, serializeHashes, sha256Hex, verifyPackage } from '../src/integrity.js';
import { readPackage, writePackage, type WdfPackage } from '../src/package.js';
import type { WdfManifest } from '../src/types.js';

const enc = new TextEncoder();
const goldenDir = resolve(import.meta.dirname, '../../../fixtures/golden/appendix-a');

const manifest: WdfManifest = {
  wdf: '0.1',
  id: 'urn:uuid:6f1f6b2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b',
  title: 'Hello WDF',
  language: 'en',
  created: '2026-08-01T10:00:00Z',
  modified: '2026-08-01T10:00:00Z',
  entry: 'content/index.html',
};

/** A fully consistent package built from the appendix-a golden files. */
async function validFiles(): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>([
    ['manifest.json', enc.encode(JSON.stringify(manifest, null, 2) + '\n')],
    ['content/index.html', readFileSync(join(goldenDir, 'input.html'))],
    ['ai/content.md', readFileSync(join(goldenDir, 'content.md'))],
    ['ai/outline.json', readFileSync(join(goldenDir, 'outline.json'))],
  ]);
  files.set('integrity/hashes.json', enc.encode(serializeHashes(await computeHashes(files))));
  return files;
}

function pkgOf(files: Map<string, Uint8Array>): WdfPackage {
  return { manifest, files };
}

describe('sha256Hex', () => {
  it('matches known test vectors', async () => {
    expect(await sha256Hex(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(await sha256Hex(enc.encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('computeHashes / serializeHashes', () => {
  it('covers every file except integrity/hashes.json, keys sorted', async () => {
    const files = await validFiles();
    const hashes = await computeHashes(files);
    const keys = Object.keys(hashes.files);
    expect(keys).toEqual([
      'ai/content.md',
      'ai/outline.json',
      'content/index.html',
      'manifest.json',
    ]);
    expect(keys).not.toContain('integrity/hashes.json');
    expect(serializeHashes(hashes).endsWith('\n')).toBe(true);
  });
});

describe('verifyPackage (T2.4 acceptance)', () => {
  it('verifies a consistent package end-to-end through pack/unpack', async () => {
    const bytes = writePackage(pkgOf(await validFiles()));
    const result = await verifyPackage(readPackage(bytes));
    expect(result.problems).toEqual([]);
    expect(result).toMatchObject({ integrity: true, determinism: true, verified: true });
  });

  it('detects a single tampered byte in the entry document', async () => {
    const files = await validFiles();
    const entry = files.get('content/index.html');
    const tampered = Uint8Array.from(entry ?? []);
    const target = new TextDecoder().decode(tampered).indexOf('Hello');
    tampered[target] = 0x4a; // 'H' → 'J'
    files.set('content/index.html', tampered);

    const result = await verifyPackage(pkgOf(files));
    expect(result.integrity).toBe(false);
    expect(result.verified).toBe(false);
    expect(
      result.problems.some(
        (p) => p.path === 'content/index.html' && p.message.includes('digest mismatch'),
      ),
    ).toBe(true);
  });

  it('detects a misaligned ai/content.md even when hashes are regenerated', async () => {
    const files = await validFiles();
    const md = new TextDecoder().decode(files.get('ai/content.md'));
    files.set('ai/content.md', enc.encode(md.replace('human', 'robot')));
    // The attacker keeps the hash manifest consistent with the tampered file…
    files.set('integrity/hashes.json', enc.encode(serializeHashes(await computeHashes(files))));

    const result = await verifyPackage(pkgOf(files));
    // …so integrity passes, but the determinism rule catches the divergence.
    expect(result.integrity).toBe(true);
    expect(result.determinism).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.problems.some((p) => p.spec === '§7.1.1' && p.path === 'ai/content.md')).toBe(
      true,
    );
  });

  it('detects a misaligned ai/outline.json (§7.1.2)', async () => {
    const files = await validFiles();
    const outline = new TextDecoder().decode(files.get('ai/outline.json'));
    files.set('ai/outline.json', enc.encode(outline.replace('"level": 1', '"level": 2')));
    files.set('integrity/hashes.json', enc.encode(serializeHashes(await computeHashes(files))));

    const result = await verifyPackage(pkgOf(files));
    expect(result.determinism).toBe(false);
    expect(result.problems.some((p) => p.spec === '§7.1.2')).toBe(true);
  });

  it('detects a file missing from the hash manifest (§8.1)', async () => {
    const files = await validFiles();
    const hashes = await computeHashes(files);
    delete hashes.files['ai/outline.json'];
    files.set('integrity/hashes.json', enc.encode(serializeHashes(hashes)));

    const result = await verifyPackage(pkgOf(files));
    expect(result.integrity).toBe(false);
    expect(result.problems.some((p) => p.path === 'ai/outline.json' && p.spec === '§8.1')).toBe(
      true,
    );
  });

  it('detects a dangling digest for a file not in the package (§8.1)', async () => {
    const files = await validFiles();
    const hashes = await computeHashes(files);
    hashes.files['data/ghost.json'] =
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    files.set('integrity/hashes.json', enc.encode(serializeHashes(hashes)));

    const result = await verifyPackage(pkgOf(files));
    expect(result.integrity).toBe(false);
    expect(result.problems.some((p) => p.path === 'data/ghost.json')).toBe(true);
  });

  it('rejects a schema-invalid hash manifest (§8.1)', async () => {
    const files = await validFiles();
    files.set('integrity/hashes.json', enc.encode('{"algorithm":"md5","files":{}}\n'));

    const result = await verifyPackage(pkgOf(files));
    expect(result.integrity).toBe(false);
    expect(result.problems.some((p) => p.spec === '§8.1')).toBe(true);
  });
});
