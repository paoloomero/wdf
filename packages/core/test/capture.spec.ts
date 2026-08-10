import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CAPTURE_PATH, parseCaptureExt, validateCaptureExt } from '../src/capture.js';
import { computeHashes, serializeHashes, verifyPackage } from '../src/integrity.js';
import { readPackage, writePackage, type WdfPackage } from '../src/package.js';
import type { WdfManifest } from '../src/types.js';

const enc = new TextEncoder();
const goldenDir = resolve(import.meta.dirname, '../../../fixtures/golden/appendix-a');
const fixturesDir = resolve(import.meta.dirname, '../../../fixtures/schemas/capture');

const captureJson = readFileSync(join(fixturesDir, 'valid-01-article.json'));

function manifestOf(withCapture: boolean): WdfManifest {
  const m: WdfManifest = {
    wdf: '0.1',
    id: 'urn:uuid:6f1f6b2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b',
    title: 'Hello WDF',
    language: 'en',
    created: '2026-08-01T10:00:00Z',
    modified: '2026-08-01T10:00:00Z',
    entry: 'content/index.html',
  };
  if (withCapture) m.extensions = [{ name: 'capture', version: '0.1' }];
  return m;
}

/** A consistent package from the appendix-a golden files, optionally carrying capture. */
async function capturePackage(captureBytes?: Uint8Array): Promise<WdfPackage> {
  const manifest = manifestOf(captureBytes !== undefined);
  const files = new Map<string, Uint8Array>([
    ['manifest.json', enc.encode(JSON.stringify(manifest, null, 2) + '\n')],
    ['content/index.html', readFileSync(join(goldenDir, 'input.html'))],
    ['ai/content.md', readFileSync(join(goldenDir, 'content.md'))],
    ['ai/outline.json', readFileSync(join(goldenDir, 'outline.json'))],
  ]);
  if (captureBytes !== undefined) files.set(CAPTURE_PATH, captureBytes);
  files.set('integrity/hashes.json', enc.encode(serializeHashes(await computeHashes(files))));
  return { manifest, files };
}

describe('validateCaptureExt (ext-capture §3, §4)', () => {
  it('reports nothing for a package without the extension', async () => {
    expect(validateCaptureExt(await capturePackage())).toEqual([]);
  });

  it('accepts a declared, conforming capture.json', async () => {
    expect(validateCaptureExt(await capturePackage(captureJson))).toEqual([]);
  });

  it('rejects a declared capture without capture.json (ext-capture §3)', async () => {
    const pkg = await capturePackage(captureJson);
    pkg.files.delete(CAPTURE_PATH);
    const violations = validateCaptureExt(pkg);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      spec: 'ext-capture §3',
      path: CAPTURE_PATH,
      severity: 'error',
    });
  });

  it('rejects a schema-invalid capture.json, citing ext-capture §4', async () => {
    const bad = readFileSync(join(fixturesDir, 'invalid-04-bad-mode.json'));
    const violations = validateCaptureExt(await capturePackage(bad));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ spec: 'ext-capture §4', severity: 'error' });
    expect(violations[0]?.message).toContain('capture schema');
  });

  it('rejects malformed JSON, citing ext-capture §4', async () => {
    const violations = validateCaptureExt(await capturePackage(enc.encode('{not json')));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ spec: 'ext-capture §4', severity: 'error' });
  });
});

describe('parseCaptureExt (tolerant consumer read, §10.3)', () => {
  it('returns typed metadata for a conforming capture.json', async () => {
    const pkg = await capturePackage(captureJson);
    const capture = parseCaptureExt(pkg.files);
    expect(capture).toMatchObject({
      capture: '0.1',
      url: 'https://example.com/2026/some-article',
      mode: 'article',
      viewport: { width: 1440, height: 900, devicePixelRatio: 2 },
    });
  });

  it('returns undefined when absent or non-conforming', async () => {
    expect(parseCaptureExt((await capturePackage()).files)).toBeUndefined();
    const bad = readFileSync(join(fixturesDir, 'invalid-02-missing-url.json'));
    expect(parseCaptureExt((await capturePackage(bad)).files)).toBeUndefined();
  });
});

describe('capture metadata tampering (T18.0 acceptance, spec §8.2)', () => {
  it('a tampered capture.json fails verification', async () => {
    const bytes = writePackage(await capturePackage(captureJson));
    const pkg = readPackage(bytes);
    const tampered = Uint8Array.from(pkg.files.get(CAPTURE_PATH) ?? []);
    // Rewrite the capture date: 2026 → 2027.
    const at = new TextDecoder().decode(tampered).indexOf('2026-08-10');
    tampered[at + 3] = 0x37;
    pkg.files.set(CAPTURE_PATH, tampered);
    const result = await verifyPackage(pkg);
    expect(result.verified).toBe(false);
    expect(result.integrity).toBe(false);
    expect(
      result.problems.some((p) => p.path === CAPTURE_PATH && p.message.includes('digest mismatch')),
    ).toBe(true);
  });

  it('the untampered capture package verifies end-to-end', async () => {
    const bytes = writePackage(await capturePackage(captureJson));
    const result = await verifyPackage(readPackage(bytes));
    expect(result.problems).toEqual([]);
    expect(result).toMatchObject({ integrity: true, determinism: true, verified: true });
  });
});
