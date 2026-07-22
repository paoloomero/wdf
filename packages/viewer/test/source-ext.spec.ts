import { describe, expect, it } from 'vitest';

import { buildOriginalSrcdoc, parseSourceExt, type SourceExt } from '../src/prepare.js';

// WP13 (plan §10.18): the "Original" view renders the embedded source with
// mapped images inlined, a no-network CSP, and no injected styling.

const enc = new TextEncoder();

function packageFiles(): Map<string, Uint8Array> {
  const meta = {
    source: '0.1',
    main: 'ext/source/abc123.html',
    mainName: 'doc originale.html',
    encoding: 'utf-8',
    resources: { 'doc%20originale.fld/img.png': 'content/assets/deadbeef.png' },
  };
  return new Map([
    ['ext/source/source.json', enc.encode(JSON.stringify(meta))],
    [
      'ext/source/abc123.html',
      enc.encode(
        '<html><head><title>x</title></head>' +
          '<body><p style="color:red">Ciao</p>' +
          '<img src="doc%20originale.fld/img.png"></body></html>',
      ),
    ],
    ['content/assets/deadbeef.png', new Uint8Array([137, 80, 78, 71])],
  ]);
}

describe('parseSourceExt', () => {
  it('reads a well-formed extension', () => {
    const ext = parseSourceExt(packageFiles());
    expect(ext?.mainName).toBe('doc originale.html');
    expect(ext?.encoding).toBe('utf-8');
  });

  it('returns undefined when absent or when main is missing', () => {
    expect(parseSourceExt(new Map())).toBeUndefined();
    const files = packageFiles();
    files.delete('ext/source/abc123.html');
    expect(parseSourceExt(files)).toBeUndefined();
  });
});

describe('buildOriginalSrcdoc', () => {
  it('inlines mapped images and adds the no-network CSP, nothing else', () => {
    const files = packageFiles();
    const ext = parseSourceExt(files) as SourceExt;
    const srcdoc = buildOriginalSrcdoc(files, ext);
    expect(srcdoc).toContain('src="data:image/png;base64,');
    expect(srcdoc).toContain("default-src 'none'");
    expect(srcdoc).toContain('style="color:red"');
    // The original is untouched: no viewer styling, no controller script.
    expect(srcdoc).not.toContain('<script');
    expect(srcdoc).not.toContain('wdf-flash');
  });

  it('decodes with the declared encoding', () => {
    const files = packageFiles();
    const meta = {
      source: '0.1',
      main: 'ext/source/latin.html',
      mainName: 'latin.html',
      encoding: 'windows-1252',
      resources: {},
    };
    files.set('ext/source/source.json', enc.encode(JSON.stringify(meta)));
    files.set('ext/source/latin.html', new Uint8Array([60, 112, 62, 232, 60, 47, 112, 62])); // <p>è</p> in cp1252
    const ext = parseSourceExt(files) as SourceExt;
    expect(buildOriginalSrcdoc(files, ext)).toContain('<p>è</p>');
  });
});
