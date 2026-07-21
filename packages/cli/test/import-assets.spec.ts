import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';

import { parseHtml, readPackage } from '@wdf/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cmdImport, cmdValidate, type Ctx } from '../src/commands.js';
import {
  DEFAULT_CAPS,
  identifyImage,
  resolveDocumentAssets,
  type AssetLoad,
} from '../src/import/assets.js';

const dec = new TextDecoder();

// A 1x1 transparent PNG.
const PNG_1x1 = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  ),
);

function capture(): Ctx & { logs: string[] } {
  const logs: string[] = [];
  return { logs, log: (s) => logs.push(s), err: (s) => logs.push(s), out: () => undefined };
}

let work: string;
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'wdf-assets-'));
});

describe('identifyImage (T7.3)', () => {
  it('recognizes the four profile image types by magic bytes', () => {
    expect(identifyImage(PNG_1x1)?.mediaType).toBe('image/png');
    expect(identifyImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.ext).toBe('jpg');
    const webp = new Uint8Array(16);
    webp.set([0x52, 0x49, 0x46, 0x46], 0);
    webp.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(identifyImage(webp)?.mediaType).toBe('image/webp');
    expect(identifyImage(new TextEncoder().encode('<svg xmlns="...">'))?.ext).toBe('svg');
  });

  it('rejects non-images (e.g. GIF, HTML, text)', () => {
    expect(identifyImage(new TextEncoder().encode('GIF89a...'))).toBeUndefined();
    expect(identifyImage(new TextEncoder().encode('<html></html>'))).toBeUndefined();
  });
});

describe('local asset import (T7.3 acceptance)', () => {
  it('packages images from the input file directory with hash names', async () => {
    const dir = join(work, 'doc-src');
    mkdirSync(join(dir, 'img'), { recursive: true });
    writeFileSync(join(dir, 'img', 'pic.png'), PNG_1x1);
    writeFileSync(
      join(dir, 'doc.html'),
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Doc</title></head>' +
        '<body><article><h1>Title</h1>' +
        '<figure><img src="img/pic.png" alt="a picture"></figure>' +
        '<p>Inline <img src="img/pic.png" alt="same"> repeat.</p>' +
        '</article></body></html>',
    );

    const out = join(work, 'doc.wdf');
    const run = capture();
    expect(
      await cmdImport(join(dir, 'doc.html'), { output: out, date: '2026-07-21T12:00:00Z' }, run),
    ).toBe(0);
    expect(await cmdValidate(out, {}, capture())).toBe(0);

    const pkg = readPackage(readFileSync(out));
    const assetPaths = [...pkg.files.keys()].filter((p) => p.startsWith('content/assets/'));
    // Two references to the same file dedup to one hash-named asset.
    expect(assetPaths).toHaveLength(1);
    expect(assetPaths[0]).toMatch(/^content\/assets\/[0-9a-f]{16}\.png$/);
    expect(pkg.manifest.resources?.some((r) => r.path === assetPaths[0])).toBe(true);
    const index = dec.decode(pkg.files.get('content/index.html'));
    expect(index).toContain(`src="${assetPaths[0]}"`);
    expect(index).not.toContain('img/pic.png');
    expect(run.logs.some((l) => l.includes('imported image'))).toBe(true);
  });

  it('drops a missing local image and still validates', async () => {
    const dir = join(work, 'doc-missing');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'doc.html'),
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>D</title></head>' +
        '<body><article><h1>T</h1><figure><img src="nope.png" alt="x"></figure><p id="p">Body.</p></article></body></html>',
    );
    const out = join(work, 'missing.wdf');
    const run = capture();
    expect(
      await cmdImport(join(dir, 'doc.html'), { output: out, date: '2026-07-21T12:00:00Z' }, run),
    ).toBe(0);
    expect(await cmdValidate(out, {}, capture())).toBe(0);
    const pkg = readPackage(readFileSync(out));
    expect([...pkg.files.keys()].some((p) => p.startsWith('content/assets/'))).toBe(false);
    expect(run.logs.some((l) => l.includes('file not found'))).toBe(true);
  });
});

describe('URL asset import (T7.3 acceptance)', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/page.html') {
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(
          '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Remote</title></head>' +
            '<body><article><h1>Remote page</h1><p>See <img src="pic.png" alt="dot"> here.</p>' +
            '<figure><img src="missing.png" alt="ext"></figure></article></body></html>',
        );
      } else if (req.url === '/pic.png') {
        res.setHeader('content-type', 'image/png');
        res.end(Buffer.from(PNG_1x1));
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => {
    server.close();
  });

  it('fetches the page and its images, dropping unreachable ones', async () => {
    const out = join(work, 'url.wdf');
    const run = capture();
    const code = await cmdImport(
      `http://127.0.0.1:${String(port)}/page.html`,
      { output: out, date: '2026-07-21T12:00:00Z' },
      run,
    );
    expect(code, run.logs.join('\n')).toBe(0);
    expect(await cmdValidate(out, {}, capture())).toBe(0);
    const pkg = readPackage(readFileSync(out));
    const assetPaths = [...pkg.files.keys()].filter((p) => p.startsWith('content/assets/'));
    expect(assetPaths).toHaveLength(1);
    // Title comes from the page <title>, not the h1.
    expect(pkg.manifest.title).toBe('Remote');
    // The 404 image was dropped (its figure unwrapped), import still succeeds.
    expect(run.logs.some((l) => l.includes('missing.png') && l.includes('HTTP 404'))).toBe(true);
  });
});

describe('caps and de-duplication', () => {
  it('stops at the max image count', async () => {
    const html =
      '<html><body><p><img src="a.png"><img src="b.png"><img src="c.png"></p></body></html>';
    const root = parseHtml(html).html;
    expect(root).not.toBeNull();
    // Distinct bytes per src so hashes differ (append the src after PNG magic).
    const loader = (src: string): Promise<AssetLoad> =>
      Promise.resolve({ bytes: new Uint8Array([...PNG_1x1, ...new TextEncoder().encode(src)]) });
    const report: string[] = [];
    const { assets } = await resolveDocumentAssets(
      root as NonNullable<typeof root>,
      loader,
      { ...DEFAULT_CAPS, maxCount: 2 },
      report,
    );
    expect(assets).toHaveLength(2);
    expect(report.some((l) => l.includes('max 2 images'))).toBe(true);
  });
});
