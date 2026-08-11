import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { exportUrlFromLocation, isGoogleDocsUrl, prepareGdocsExport } from '../src/gdocs.js';

// T18.9 (plan §10.43): site-aware Google Docs capture — URL detection for
// the popup, and unpacking of the official "web page, zipped" export.

describe('isGoogleDocsUrl (popup detection)', () => {
  it('matches document pages on docs.google.com only', () => {
    expect(isGoogleDocsUrl('https://docs.google.com/document/d/1AbC_x-9/edit?tab=t.0')).toBe(true);
    expect(isGoogleDocsUrl('https://docs.google.com/document/d/1AbC/view')).toBe(true);
    expect(isGoogleDocsUrl('https://docs.google.com/spreadsheets/d/1AbC/edit')).toBe(false);
    expect(isGoogleDocsUrl('https://docs.google.com/document/u/0/')).toBe(false);
    expect(isGoogleDocsUrl('https://evil.example/document/d/1AbC/edit')).toBe(false);
    expect(isGoogleDocsUrl('not a url')).toBe(false);
  });
});

describe('exportUrlFromLocation (content script, host-agnostic)', () => {
  it('builds the export?format=zip URL from the document path', () => {
    expect(exportUrlFromLocation('https://docs.google.com', '/document/d/1AbC_x-9/edit')).toBe(
      'https://docs.google.com/document/d/1AbC_x-9/export?format=zip',
    );
    expect(exportUrlFromLocation('http://127.0.0.1:8080', '/document/d/test42/edit')).toBe(
      'http://127.0.0.1:8080/document/d/test42/export?format=zip',
    );
    expect(exportUrlFromLocation('https://docs.google.com', '/spreadsheets/d/x/edit')).toBe(
      undefined,
    );
  });
});

describe('prepareGdocsExport', () => {
  const enc = new TextEncoder();
  const PNG = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    ),
    (c) => c.charCodeAt(0),
  );

  it('splits the export into decoded HTML, verbatim bytes and an image map', () => {
    const html = '<html><head><title>Doc</title></head><body><p>Città</p></body></html>';
    const zip = zipSync({
      'MyDoc.html': enc.encode(html),
      'images/image1.png': PNG,
    });
    const out = prepareGdocsExport(zip);
    expect(out.htmlName).toBe('MyDoc.html');
    expect(out.html).toContain('Città');
    expect(new TextDecoder().decode(out.htmlBytes)).toBe(html);
    expect([...out.files.keys()]).toEqual(['images/image1.png']);
    expect(out.files.get('images/image1.png')).toEqual(PNG);
  });

  it('throws when the zip carries no HTML', () => {
    const zip = zipSync({ 'images/image1.png': PNG });
    expect(() => prepareGdocsExport(zip)).toThrow('no HTML file');
  });
});
