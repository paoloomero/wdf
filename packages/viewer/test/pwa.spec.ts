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

  it('viewer shell links the manifest; main.ts consumes launched files', () => {
    const shell = readFileSync(join(viewerSrc, 'shell.html'), 'utf8');
    expect(shell).toContain('<link rel="manifest" href="manifest.webmanifest" />');
    const main = readFileSync(join(viewerSrc, 'main.ts'), 'utf8');
    expect(main).toContain('launchQueue');
    expect(main).toContain("navigator.serviceWorker.register('sw.js')");
  });
});
