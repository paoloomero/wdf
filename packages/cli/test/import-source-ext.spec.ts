import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { readPackage, verifyPackage } from '@wdf/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { cmdImport, cmdValidate, type Ctx } from '../src/commands.js';

// WP13 acceptance (plan §10.18): --with-source embeds the original input
// byte-for-byte under ext/source/, declared in the manifest, hashed like
// everything else, without duplicating images; default import is unchanged.

const fixturesDir = resolve(import.meta.dirname, '../../../fixtures/import');

interface Capture extends Ctx {
  logs: string[];
}
function capture(): Capture {
  const c: Capture = {
    logs: [],
    log: (s) => c.logs.push(s),
    err: (s) => c.logs.push(s),
    out: () => undefined,
  };
  return c;
}

interface SourceJson {
  source: string;
  kind: string;
  main: string;
  mainName: string;
  encoding: string;
  resources: Record<string, string>;
}

async function importWithSource(
  name: string,
  withSource: boolean,
): Promise<{ bytes: Buffer; pkg: ReturnType<typeof readPackage> }> {
  const work = mkdtempSync(join(tmpdir(), 'wdf-srcext-'));
  const wdf = join(work, `${name}.wdf`);
  const run = capture();
  const code = await cmdImport(
    join(fixturesDir, `${name}.html`),
    { output: wdf, date: '2026-07-22T12:00:00Z', ...(withSource ? { withSource: true } : {}) },
    run,
  );
  expect(code, run.logs.join('\n')).toBe(0);
  expect(await cmdValidate(wdf, {}, capture())).toBe(0);
  const bytes = readFileSync(wdf);
  return { bytes, pkg: readPackage(bytes) };
}

let pkg: ReturnType<typeof readPackage>;
let bytes: Buffer;
let sourceJson: SourceJson;

beforeAll(async () => {
  ({ pkg, bytes } = await importWithSource('cell-image-it', true));
  sourceJson = JSON.parse(
    new TextDecoder().decode(pkg.files.get('ext/source/source.json')),
  ) as SourceJson;
});

describe('the source extension (WP13)', () => {
  it('declares the extension in the manifest', () => {
    expect(pkg.manifest.extensions).toEqual([{ name: 'source', version: '0.3' }]);
  });

  it('embeds the original main file byte-for-byte', () => {
    const original = readFileSync(join(fixturesDir, 'cell-image-it.html'));
    const embedded = pkg.files.get(sourceJson.main);
    expect(embedded).toBeDefined();
    expect(Buffer.from(embedded ?? new Uint8Array()).equals(original)).toBe(true);
    expect(sourceJson.mainName).toBe('cell-image-it.html');
    expect(sourceJson.encoding).toBe('utf-8');
    expect(sourceJson.kind).toBe('fetched-html');
  });

  it('maps original references onto the content/assets copies (no duplication)', () => {
    const mapped = sourceJson.resources['cell-image-it.fld/icon.svg'];
    expect(mapped).toMatch(/^content\/assets\/[0-9a-f]{16}\.svg$/);
    expect(pkg.files.has(mapped ?? '')).toBe(true);
    const extImages = [...pkg.files.keys()].filter(
      (p) => p.startsWith('ext/source/') && !p.endsWith('.json') && !p.endsWith('.html'),
    );
    expect(extImages).toEqual([]);
  });

  it('keeps the preserved original encoding for non-UTF-8 sources', async () => {
    const { pkg: p1252 } = await importWithSource('word-1252-it', true);
    const meta = JSON.parse(
      new TextDecoder().decode(p1252.files.get('ext/source/source.json')),
    ) as SourceJson;
    expect(meta.encoding).toBe('windows-1252');
    const original = readFileSync(join(fixturesDir, 'word-1252-it.html'));
    expect(Buffer.from(p1252.files.get(meta.main) ?? new Uint8Array()).equals(original)).toBe(true);
  });

  it('is byte-deterministic', async () => {
    const again = await importWithSource('cell-image-it', true);
    expect(again.bytes.equals(bytes)).toBe(true);
  });

  it('is covered by the integrity hashes: tampering is detected', async () => {
    const embedded = pkg.files.get(sourceJson.main);
    const tampered = Uint8Array.from(embedded ?? []);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    const files = new Map(pkg.files);
    files.set(sourceJson.main, tampered);
    const result = await verifyPackage({ ...pkg, files });
    expect(result.integrity).toBe(false);
  });

  it('leaves the default import untouched', async () => {
    const plain = await importWithSource('cell-image-it', false);
    expect(plain.pkg.manifest.extensions).toBeUndefined();
    expect([...plain.pkg.files.keys()].some((p) => p.startsWith('ext/'))).toBe(false);
  });
});
