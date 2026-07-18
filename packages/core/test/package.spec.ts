import { Zip, ZipPassThrough } from 'fflate';
import { describe, expect, it } from 'vitest';

import { WdfError } from '../src/errors.js';
import { readPackage, writePackage, type WdfPackage } from '../src/package.js';
import type { WdfManifest } from '../src/types.js';

const enc = new TextEncoder();

function minimalManifest(overrides: Partial<WdfManifest> = {}): WdfManifest {
  return {
    wdf: '0.1',
    id: 'urn:uuid:6f1f6b2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b',
    title: 'Test document',
    language: 'en',
    created: '2026-08-01T10:00:00Z',
    modified: '2026-08-01T10:00:00Z',
    entry: 'content/index.html',
    ...overrides,
  };
}

function baseFiles(manifest: WdfManifest = minimalManifest()): Map<string, Uint8Array> {
  return new Map<string, Uint8Array>([
    ['manifest.json', enc.encode(JSON.stringify(manifest, null, 2) + '\n')],
    ['content/index.html', enc.encode('<!DOCTYPE html><html><body></body></html>')],
    ['ai/content.md', enc.encode('# T\n')],
    ['ai/outline.json', enc.encode('[]\n')],
    ['integrity/hashes.json', enc.encode('{"algorithm":"sha256","files":{}}\n')],
  ]);
}

function fullFiles(): Map<string, Uint8Array> {
  const manifest = minimalManifest({
    resources: [
      { path: 'content/assets/logo.svg', mediaType: 'image/svg+xml' },
      { path: 'content/assets/photo.png', mediaType: 'image/png' },
    ],
    datasets: [
      {
        path: 'data/spesa-2025.json',
        schema: { columns: [{ name: 'anno', type: 'integer' }] },
      },
    ],
    extensions: [{ name: 'wdf-ext-demo', version: '0.1' }],
  });
  const files = baseFiles(manifest);
  files.set('content/styles.css', enc.encode('article { max-width: 40rem }'));
  files.set('content/assets/logo.svg', enc.encode('<svg xmlns="http://www.w3.org/2000/svg"/>'));
  files.set('content/assets/photo.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
  files.set('data/spesa-2025.json', enc.encode('{"columns":[],"rows":[]}'));
  files.set('ext/wdf-ext-demo/data.json', enc.encode('{}'));
  return files;
}

function pkgOf(files: Map<string, Uint8Array>): WdfPackage {
  return { manifest: JSON.parse(new TextDecoder().decode(files.get('manifest.json'))), files };
}

/** Crafts a raw ZIP with exactly the given entries (duplicates and dir names allowed). */
function craftZip(entries: [string, Uint8Array][]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const zip = new Zip((err, chunk) => {
    if (err) throw err;
    chunks.push(chunk);
  });
  for (const [name, data] of entries) {
    const file = new ZipPassThrough(name);
    zip.add(file);
    file.push(data, true);
  }
  zip.end();
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function expectWdfError(fn: () => unknown, spec: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught, `expected WdfError citing ${spec}`).toBeInstanceOf(WdfError);
  expect((caught as WdfError).spec).toBe(spec);
}

describe('round-trip (T2.1 acceptance)', () => {
  it.each([
    ['minimal package', baseFiles()],
    ['full package with resources, datasets, extension', fullFiles()],
  ])('pack → unpack → pack is byte-identical: %s', (_name, files) => {
    const first = writePackage(pkgOf(files));
    const reread = readPackage(first);
    const second = writePackage(reread);
    expect(second).toEqual(first);
    expect(readPackage(second).files).toEqual(reread.files);
  });

  it('output does not depend on files map insertion order', () => {
    const files = fullFiles();
    const shuffled = new Map([...files.entries()].reverse());
    expect(writePackage(pkgOf(shuffled))).toEqual(writePackage(pkgOf(files)));
  });

  it('packing twice yields identical bytes (no timestamps, stable settings)', () => {
    const a = writePackage(pkgOf(fullFiles()));
    const b = writePackage(pkgOf(fullFiles()));
    expect(b).toEqual(a);
  });

  it('manifest.json is the first archive entry (§3.1.5)', () => {
    const bytes = writePackage(pkgOf(baseFiles()));
    // First local file header starts at byte 0; the name follows at offset 30.
    const nameLength = (bytes[26] ?? 0) | ((bytes[27] ?? 0) << 8);
    const name = new TextDecoder().decode(bytes.subarray(30, 30 + nameLength));
    expect(name).toBe('manifest.json');
  });

  it('parses the manifest into pkg.manifest', () => {
    const pkg = readPackage(writePackage(pkgOf(fullFiles())));
    expect(pkg.manifest.title).toBe('Test document');
    expect(pkg.manifest.datasets?.[0]?.path).toBe('data/spesa-2025.json');
  });
});

describe('archive-level rejection', () => {
  it('rejects non-ZIP bytes (§3.1)', () => {
    expectWdfError(() => readPackage(enc.encode('not a zip at all')), '§3.1');
  });

  it('rejects directory entries (§3.1.4)', () => {
    const zip = craftZip([['content/', new Uint8Array(0)], ...[...baseFiles().entries()]]);
    expectWdfError(() => readPackage(zip), '§3.1.4');
  });

  it('rejects duplicate entry names (§3.1.3)', () => {
    const zip = craftZip([
      ...[...baseFiles().entries()],
      ['ai/content.md', enc.encode('# other\n')],
    ]);
    expectWdfError(() => readPackage(zip), '§3.1.3');
  });
});

describe('structural rejection', () => {
  function withFile(path: string, data = enc.encode('x')): Map<string, Uint8Array> {
    const files = baseFiles();
    files.set(path, data);
    return files;
  }

  it.each([
    ['path traversal', '../evil.txt', '§3.2.1'],
    ['dotfile segment', 'content/.hidden', '§3.2.1'],
    ['space in segment', 'content/my file.png', '§3.2.1'],
    ['unknown top-level directory', 'stuff/x.txt', '§3.2.3'],
    ['uppercase top-level directory', 'Content/x.html', '§3.2.3'],
    ['top-level file other than manifest.json', 'readme.txt', '§3.2.3'],
    ['extra file in integrity/', 'integrity/extra.json', '§3.3.3'],
  ])('rejects %s (%s → %s)', (_name, path, spec) => {
    expectWdfError(() => writePackage(pkgOf(withFile(path))), spec);
  });

  it('rejects a package missing a required file (§3.3.1)', () => {
    const files = baseFiles();
    files.delete('ai/content.md');
    expectWdfError(() => writePackage(pkgOf(files)), '§3.3.1');
  });

  it('rejects an unlisted content file (§3.3.4)', () => {
    expectWdfError(() => writePackage(pkgOf(withFile('content/assets/x.png'))), '§3.3.4');
  });

  it('rejects an unlisted data file (§3.3.4)', () => {
    expectWdfError(() => writePackage(pkgOf(withFile('data/x.json'))), '§3.3.4');
  });

  it('rejects a dangling resource listing (§4.1.1)', () => {
    const manifest = minimalManifest({
      resources: [{ path: 'content/assets/missing.png', mediaType: 'image/png' }],
    });
    expectWdfError(() => writePackage(pkgOf(baseFiles(manifest))), '§4.1.1');
  });

  it('rejects undeclared extension files (§10.2)', () => {
    expectWdfError(() => writePackage(pkgOf(withFile('ext/mystery/data.json'))), '§10.2');
  });

  it('rejects a declared extension without files (§10.2)', () => {
    const manifest = minimalManifest({ extensions: [{ name: 'ghost' }] });
    expectWdfError(() => writePackage(pkgOf(baseFiles(manifest))), '§10.2');
  });
});

describe('manifest rejection', () => {
  it('rejects a schema-invalid manifest (§4)', () => {
    const bad = minimalManifest() as Partial<WdfManifest>;
    delete bad.title;
    const files = baseFiles();
    files.set('manifest.json', enc.encode(JSON.stringify(bad)));
    expectWdfError(() => writePackage(pkgOf(files)), '§4');
  });

  it('rejects a manifest with a UTF-8 BOM (§2)', () => {
    const files = baseFiles();
    const json = enc.encode(JSON.stringify(minimalManifest()));
    const withBom = new Uint8Array(json.length + 3);
    withBom.set([0xef, 0xbb, 0xbf]);
    withBom.set(json, 3);
    files.set('manifest.json', withBom);
    expectWdfError(() => writePackage(pkgOf(files)), '§2');
  });

  it('rejects malformed JSON (§4)', () => {
    const files = baseFiles();
    files.set('manifest.json', enc.encode('{ not json'));
    // pkg.manifest is a convenience copy; writePackage validates the bytes.
    expectWdfError(() => writePackage({ manifest: minimalManifest(), files }), '§4');
  });
});
