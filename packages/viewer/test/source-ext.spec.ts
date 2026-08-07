import { describe, expect, it } from 'vitest';

import {
  buildOriginalSrcdoc,
  buildSrcdoc,
  fontsCss,
  parseSourceExt,
  type SourceExt,
} from '../src/prepare.js';

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

  it('inlines images whose src is entity-encoded and drops srcset/lazy (web pages)', () => {
    // A Next.js-style page: src carries &amp; in the raw markup while the
    // resources map holds the decoded URL, and srcSet would override the
    // inlined src with remote candidates the CSP blocks.
    const src = '/_next/image?url=https%3A%2F%2Fcdn.example%2Fa.png&w=3840&q=75';
    const meta = {
      source: '0.2',
      main: 'ext/source/abc123.html',
      mainName: 'page.html',
      encoding: 'utf-8',
      resources: { [src]: 'content/assets/deadbeef.png' },
    };
    const files = new Map([
      ['ext/source/source.json', enc.encode(JSON.stringify(meta))],
      [
        'ext/source/abc123.html',
        enc.encode(
          '<html><head><title>x</title></head><body>' +
            '<img loading="lazy" srcSet="/_next/image?url=x&amp;w=1920 1x, /_next/image?url=x&amp;w=3840 2x" ' +
            'src="/_next/image?url=https%3A%2F%2Fcdn.example%2Fa.png&amp;w=3840&amp;q=75">' +
            '</body></html>',
        ),
      ],
      ['content/assets/deadbeef.png', new Uint8Array([137, 80, 78, 71])],
    ]);
    const ext = parseSourceExt(files) as SourceExt;
    const srcdoc = buildOriginalSrcdoc(files, ext);
    expect(srcdoc).toContain('src="data:image/png;base64,');
    expect(srcdoc).not.toContain('srcSet');
    expect(srcdoc).not.toContain('srcset');
    expect(srcdoc).not.toContain('loading="lazy"');
  });

  it('inlines embedded source stylesheets in place of their links (WP15)', () => {
    const files = packageFiles();
    const meta = {
      source: '0.2',
      main: 'ext/source/abc123.html',
      mainName: 'saved.html',
      encoding: 'utf-8',
      resources: {},
      stylesheets: { 'site_files/site.css': 'ext/source/cafecafecafecafe.css' },
    };
    files.set('ext/source/source.json', enc.encode(JSON.stringify(meta)));
    files.set(
      'ext/source/abc123.html',
      enc.encode(
        '<html><head><link rel="stylesheet" href="site_files/site.css"></head>' +
          '<body><p>Ciao</p></body></html>',
      ),
    );
    files.set('ext/source/cafecafecafecafe.css', enc.encode('body { color: #7a1f1f; }'));
    const ext = parseSourceExt(files) as SourceExt;
    const srcdoc = buildOriginalSrcdoc(files, ext);
    expect(srcdoc).toContain('<style>body { color: #7a1f1f; }</style>');
    expect(srcdoc).not.toContain('<link rel="stylesheet"');
  });

  it('inlines embedded fonts as data: URIs in the sandbox (WP9)', () => {
    const files = new Map<string, Uint8Array>([
      [
        'ext/fonts/fonts.css',
        enc.encode(
          '@font-face {\n  font-family: "Carlito";\n  src: url("ext/fonts/carlito-latin-400-normal.woff2") format("woff2");\n}\n',
        ),
      ],
      ['ext/fonts/carlito-latin-400-normal.woff2', new Uint8Array([0x77, 0x4f, 0x46, 0x32])],
    ]);
    const css = fontsCss(files);
    expect(css).toContain('url("data:font/woff2;base64,');
    const srcdoc = buildSrcdoc('<html><head></head><body></body></html>', files, 'n');
    expect(srcdoc).toContain('@font-face');
    expect(srcdoc).toContain('font-src data:');
    expect(fontsCss(new Map())).toBeUndefined();
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
