import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// T8.1 sanity: the PWA shell pieces stay consistent with each other.

const root = resolve(import.meta.dirname, '../../..');
const siteDir = join(root, 'site');
const viewerSrc = join(root, 'packages/viewer/src');

interface Manifest {
  name: string;
  start_url: string;
  display: string;
  icons: { src: string; sizes: string; purpose?: string }[];
  file_handlers: { action: string; accept: Record<string, string[]> }[];
}

describe('WDF Reader PWA (T8.1)', () => {
  const manifest = JSON.parse(
    readFileSync(join(siteDir, 'manifest.webmanifest'), 'utf8'),
  ) as Manifest;

  it('declares the .wdf file handler pointing at the viewer', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('viewer.html');
    const handler = manifest.file_handlers[0];
    expect(handler?.action).toBe('viewer.html');
    expect(handler?.accept['application/wdf+zip']).toEqual(['.wdf']);
  });

  it('ships every declared icon, including a maskable one', () => {
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
    for (const icon of manifest.icons) {
      expect(existsSync(join(siteDir, icon.src)), icon.src).toBe(true);
    }
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  });

  it('service worker caches the shell the manifest needs', () => {
    const sw = readFileSync(join(siteDir, 'sw.js'), 'utf8');
    expect(sw).toContain("'viewer.html'");
    expect(sw).toContain("'manifest.webmanifest'");
    for (const icon of manifest.icons) {
      expect(sw).toContain(`'${icon.src}'`);
    }
  });

  // WP21 T21.2: the PDF.js pieces are Reader-DEPLOYMENT assets — precached
  // by the SW, external to the main bundle, absent from the npm package.
  it('service worker precaches the PDF.js lazy assets', () => {
    const sw = readFileSync(join(siteDir, 'sw.js'), 'utf8');
    expect(sw).toContain("'pdfjs.js'");
    expect(sw).toContain("'pdfjs-worker.js'");
  });

  // Plan §10.80: the converter's .wdf.html template and the Plex files are
  // Reader-deployment assets too — offline once installed.
  it('service worker precaches the standalone template and every Plex file', () => {
    const sw = readFileSync(join(siteDir, 'sw.js'), 'utf8');
    expect(sw).toContain("'standalone-template.html'");
    const build = readFileSync(join(root, 'packages/viewer/build.mjs'), 'utf8');
    const fonts = [...build.matchAll(/'(IBMPlex[\w-]+\.woff2)'/g)].map((m) => m[1]);
    expect(fonts.length).toBe(4);
    for (const file of fonts) {
      expect(sw).toContain(`'plex/${String(file)}'`);
      expect(existsSync(join(root, 'packages/viewer/fonts', String(file))), file).toBe(true);
    }
  });

  it('PDF.js stays out of the main bundle and out of the npm package', () => {
    const build = readFileSync(join(root, 'packages/viewer/build.mjs'), 'utf8');
    expect(build).toContain("external: ['./pdfjs.js']");
    const pkg = JSON.parse(readFileSync(join(root, 'packages/viewer/package.json'), 'utf8')) as {
      files: string[];
      dependencies: Record<string, string>;
    };
    expect(pkg.files.some((f) => f.includes('pdfjs'))).toBe(false);
    expect(Object.keys(pkg.dependencies)).not.toContain('pdfjs-dist');
  });

  // Plan §10.82: the standalone shows the author's PDF in the browser's own
  // viewer — no renderer shipped or fetched — and never imports PDF.js.
  it('the standalone shows the PDF natively, never with PDF.js', () => {
    const shell = readFileSync(join(viewerSrc, 'shell.html'), 'utf8');
    const main = readFileSync(join(viewerSrc, 'main.ts'), 'utf8');
    const frame = /<iframe[^>]*id="original-pdf-native"[^>]*>/.exec(shell)?.[0] ?? '';
    expect(frame).toContain('hidden');
    expect(frame).not.toContain('src=');
    expect(main).toContain('navigator.pdfViewerEnabled');
    // The PDF.js import sits behind the standalone gate.
    const gate = main.indexOf('if (!standalone) {');
    const load = main.indexOf("await import('./pdfjs.js')");
    expect(gate).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(gate);
    for (const id of ['original-pdf-download', 'original-source-download']) {
      expect(shell).toContain(`id="${id}"`);
    }
  });

  it('viewer shell links the manifest; main.ts consumes launched files', () => {
    const shell = readFileSync(join(viewerSrc, 'shell.html'), 'utf8');
    expect(shell).toContain('<link rel="manifest" href="manifest.webmanifest" />');
    const main = readFileSync(join(viewerSrc, 'main.ts'), 'utf8');
    expect(main).toContain('launchQueue');
    expect(main).toContain("navigator.serviceWorker.register('sw.js')");
  });

  it('ships the install prompt buttons hidden until the browser offers install (plan §10.69)', () => {
    const shell = readFileSync(join(viewerSrc, 'shell.html'), 'utf8');
    const main = readFileSync(join(viewerSrc, 'main.ts'), 'utf8');
    for (const id of ['install-home', 'install-app']) {
      const tag = new RegExp(`<button[^>]*id="${id}"[^>]*>`).exec(shell)?.[0];
      expect(tag, id).toBeDefined();
      expect(main).toContain(`'${id}'`);
    }
    // Toolbar: the hidden attribute. Home (plan §10.80): the cell's
    // data-install state, which starts at "unavailable"; its button is always
    // shown and explains how to install when there is no prompt.
    expect(/<button[^>]*id="install-app"[^>]*>/.exec(shell)?.[0]).toContain('hidden');
    expect(/<button[^>]*id="install-home"[^>]*>/.exec(shell)?.[0]).not.toContain('hidden');
    expect(shell).toContain('id="install-cell" data-install="unavailable"');
    expect(shell).toContain('id="install-help"');
    expect(main).toContain("addEventListener('beforeinstallprompt'");
    expect(main).toContain("addEventListener('appinstalled'");
    expect(shell).toContain('id="install-done"');
  });
});
