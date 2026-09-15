import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { extract, serializeOutline } from '../src/extract.js';
import { computeHashes, serializeHashes } from '../src/integrity.js';
import { readPackage, writePackage, type WdfPackage } from '../src/package.js';
import { validatePackage } from '../src/validate.js';

// Regression vectors of the September 2026 technical review (plan §10.70):
// T05 — a dataset that contradicts its bound table — must never be
// "verified", on any surface. validatePackage() is the one pipeline every
// consumer (CLI, Reader, MCP) reports.

const enc = new TextEncoder();
const dec = new TextDecoder();
const exampleDir = resolve(import.meta.dirname, '../../../examples/municipal-decree');

/** The municipal-decree example as a consistent file set (AI layer + hashes regenerated). */
async function decreeFiles(): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const path of [
    'manifest.json',
    'content/index.html',
    'content/styles.css',
    'data/commitments.json',
  ]) {
    files.set(path, readFileSync(join(exampleDir, path)));
  }
  const result = extract(dec.decode(files.get('content/index.html')));
  files.set('ai/content.md', enc.encode(result.markdown));
  files.set('ai/outline.json', enc.encode(serializeOutline(result.outline)));
  await rehash(files);
  return files;
}

async function rehash(files: Map<string, Uint8Array>): Promise<void> {
  files.delete('integrity/hashes.json');
  files.set('integrity/hashes.json', enc.encode(serializeHashes(await computeHashes(files))));
}

function pkgOf(files: Map<string, Uint8Array>): WdfPackage {
  return readPackage(
    writePackage({ manifest: JSON.parse(dec.decode(files.get('manifest.json'))), files }),
  );
}

describe('validatePackage (spec §8.2 errata 2026-09-15)', () => {
  it('verifies a conforming, consistent package', async () => {
    const result = await validatePackage(pkgOf(await decreeFiles()));
    expect(result.status).toBe('verified');
    expect(result).toMatchObject({
      verified: true,
      conformance: true,
      integrity: true,
      determinism: true,
    });
    expect(result.violations.filter((v) => v.severity === 'error')).toEqual([]);
  });

  it('T05: a dataset contradicting its table is "not-conforming", never verified', async () => {
    const files = await decreeFiles();
    const data = JSON.parse(dec.decode(files.get('data/commitments.json'))) as {
      rows: unknown[][];
    };
    (data.rows[0] as number[])[2] = 99999; // the HTML still shows 14640
    files.set('data/commitments.json', enc.encode(JSON.stringify(data)));
    await rehash(files);

    const result = await validatePackage(pkgOf(files));
    expect(result.status).toBe('not-conforming');
    expect(result.verified).toBe(false);
    // Hashes and derivation are fine: that is exactly why the old verdict lied.
    expect(result.integrity).toBe(true);
    expect(result.determinism).toBe(true);
    expect(result.conformance).toBe(false);
    expect(result.violations.some((v) => v.spec === '§6.5.4')).toBe(true);
  });

  it('a forbidden stylesheet construct is "not-conforming"', async () => {
    const files = await decreeFiles();
    files.set('content/styles.css', enc.encode('@import url(x.css);\n'));
    await rehash(files);
    const result = await validatePackage(pkgOf(files));
    expect(result.status).toBe('not-conforming');
    expect(result.violations.some((v) => v.spec === '§6.7.2')).toBe(true);
  });

  it('a digest mismatch is "integrity-failed" — the only outcome called tampering', async () => {
    const files = await decreeFiles();
    const data = files.get('data/commitments.json') ?? new Uint8Array();
    files.set('data/commitments.json', enc.encode(`${dec.decode(data)}\n`)); // not rehashed
    const result = await validatePackage(pkgOf(files));
    expect(result.status).toBe('integrity-failed');
    expect(result.integrity).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.violations.some((v) => v.spec === '§8.2')).toBe(true);
  });

  it('an AI layer that is not the canonical extraction is "derivation-failed"', async () => {
    const files = await decreeFiles();
    const md = dec.decode(files.get('ai/content.md'));
    files.set('ai/content.md', enc.encode(md.replace('14640', '99999')));
    await rehash(files); // hashes consistent, derivation broken
    const result = await validatePackage(pkgOf(files));
    expect(result.status).toBe('derivation-failed');
    expect(result.integrity).toBe(true);
    expect(result.determinism).toBe(false);
    expect(result.violations.some((v) => v.spec === '§7.1.1')).toBe(true);
  });

  it('a foreign wdf version is "unsupported-version", not tampering', async () => {
    const files = await decreeFiles();
    const manifest = JSON.parse(dec.decode(files.get('manifest.json'))) as { wdf: string };
    manifest.wdf = '0.9';
    files.set('manifest.json', enc.encode(JSON.stringify(manifest)));
    await rehash(files);
    // writePackage would refuse it; zip the bytes directly, as a 0.9 producer would.
    const bytes = zipSync(Object.fromEntries(files), { level: 6 });
    const result = await validatePackage(bytes);
    expect(result.status).toBe('unsupported-version');
    expect(result.verified).toBe(false);
    expect(result.violations[0]?.spec).toBe('§4.1');
    expect(result.violations[0]?.message).toContain('unsupported WDF version "0.9"');
  });

  it('a structurally broken package is "not-conforming" with the §3 violation', async () => {
    const files = await decreeFiles();
    files.delete('ai/outline.json');
    const bytes = zipSync(Object.fromEntries(files), { level: 6 });
    const result = await validatePackage(bytes);
    expect(result.status).toBe('not-conforming');
    expect(result.violations[0]?.spec).toBe('§3.3.1');
  });

  it('accepts raw bytes and a read package alike', async () => {
    const files = await decreeFiles();
    const bytes = writePackage({
      manifest: JSON.parse(dec.decode(files.get('manifest.json'))),
      files,
    });
    expect((await validatePackage(bytes)).status).toBe('verified');
    expect((await validatePackage(readPackage(bytes))).status).toBe('verified');
  });
});
