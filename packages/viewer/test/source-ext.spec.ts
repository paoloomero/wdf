import { describe, expect, it } from 'vitest';

import {
  binarySourceDetails,
  buildOriginalSrcdoc,
  buildSrcdoc,
  fontsCss,
  parseSourceExt,
  visualSourceDetails,
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

  it('defaults kind to "fetched-html" (v0.3 retro-compatibility)', () => {
    // The 0.1-style fixture above has no `kind`.
    expect(parseSourceExt(packageFiles())?.kind).toBe('fetched-html');
  });

  it('reads kind "dom-snapshot" and normalizes unknown values (v0.3)', () => {
    const files = packageFiles();
    const meta = JSON.parse(
      new TextDecoder().decode(files.get('ext/source/source.json')),
    ) as Record<string, unknown>;
    files.set(
      'ext/source/source.json',
      enc.encode(JSON.stringify({ ...meta, source: '0.3', kind: 'dom-snapshot' })),
    );
    expect(parseSourceExt(files)?.kind).toBe('dom-snapshot');
    files.set(
      'ext/source/source.json',
      enc.encode(JSON.stringify({ ...meta, source: '0.3', kind: 'reserved-future-value' })),
    );
    expect(parseSourceExt(files)?.kind).toBe('fetched-html');
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

// ext-source 0.4: a binary original (e.g. .docx) is never rendered — the
// Original view presents metadata and offers the embedded bytes instead.
describe('binary source kind (ext-source 0.4)', () => {
  function binaryFiles(mediaType?: string): Map<string, Uint8Array> {
    const meta: Record<string, unknown> = {
      source: '0.4',
      kind: 'binary',
      main: 'ext/source/cafebabe12345678.docx',
      mainName: 'delibera 42.docx',
      resources: {},
    };
    if (mediaType !== undefined) meta['mediaType'] = mediaType;
    return new Map([
      ['ext/source/source.json', enc.encode(JSON.stringify(meta))],
      ['ext/source/cafebabe12345678.docx', new Uint8Array(2048)],
    ]);
  }

  it('parseSourceExt reads kind and mediaType', () => {
    const ext = parseSourceExt(
      binaryFiles('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    );
    expect(ext?.kind).toBe('binary');
    expect(ext?.mediaType).toContain('wordprocessingml');
    expect(ext?.mainName).toBe('delibera 42.docx');
  });

  it('unknown kinds still normalize to fetched-html', () => {
    const files = packageFiles();
    const meta = JSON.parse(new TextDecoder().decode(files.get('ext/source/source.json'))) as {
      kind?: string;
    };
    meta.kind = 'quantum-entangled';
    files.set('ext/source/source.json', enc.encode(JSON.stringify(meta)));
    expect(parseSourceExt(files)?.kind).toBe('fetched-html');
  });

  it('binarySourceDetails reports name, type and size', () => {
    const files = binaryFiles('application/msword');
    const ext = parseSourceExt(files);
    expect(ext).toBeDefined();
    const details = binarySourceDetails(files, ext as SourceExt);
    expect(details).toEqual({
      fileName: 'delibera 42.docx',
      mediaType: 'application/msword',
      sizeLabel: '2.0 KB',
    });
  });

  it('binarySourceDetails falls back to the package name and unknown type', () => {
    const files = binaryFiles();
    const ext = parseSourceExt(files);
    expect(ext).toBeDefined();
    const noName = { ...(ext as SourceExt), mainName: '' };
    const details = binarySourceDetails(files, noName);
    expect(details?.fileName).toBe('cafebabe12345678.docx');
    expect(details?.mediaType).toBe('unknown type');
  });

  it('binarySourceDetails is undefined when the bytes are missing', () => {
    const files = binaryFiles();
    files.delete('ext/source/cafebabe12345678.docx');
    // parseSourceExt already refuses a dangling main; call the helper directly.
    const ext: SourceExt = {
      kind: 'binary',
      main: 'ext/source/cafebabe12345678.docx',
      mainName: 'delibera 42.docx',
      encoding: 'utf-8',
      resources: {},
      stylesheets: {},
    };
    expect(binarySourceDetails(files, ext)).toBeUndefined();
  });
});

// WP21 (docs/ext-source.md 0.5): the author's visual rendition — parsed
// tolerantly, surfaced by the download card in the Original view.
describe('the visual rendition (ext-source 0.5, WP21)', () => {
  function visualFiles(overrides?: Record<string, unknown>): Map<string, Uint8Array> {
    const meta: Record<string, unknown> = {
      source: '0.5',
      kind: 'binary',
      main: 'ext/source/cafebabe12345678.docx',
      mainName: 'delibera 42.docx',
      mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      visual: {
        path: 'ext/source/0123456789abcdef.pdf',
        mediaType: 'application/pdf',
        name: 'delibera 42.pdf',
        ...overrides,
      },
      resources: {},
    };
    return new Map([
      ['ext/source/source.json', enc.encode(JSON.stringify(meta))],
      ['ext/source/cafebabe12345678.docx', new Uint8Array(2048)],
      ['ext/source/0123456789abcdef.pdf', new Uint8Array(3 * 1024)],
    ]);
  }

  it('parseSourceExt reads a well-formed visual', () => {
    const ext = parseSourceExt(visualFiles());
    expect(ext?.visual).toEqual({
      path: 'ext/source/0123456789abcdef.pdf',
      mediaType: 'application/pdf',
      name: 'delibera 42.pdf',
    });
  });

  it('drops a dangling visual without losing the extension', () => {
    const files = visualFiles();
    files.delete('ext/source/0123456789abcdef.pdf');
    const ext = parseSourceExt(files);
    expect(ext).toBeDefined();
    expect(ext?.visual).toBeUndefined();
  });

  it('defaults mediaType and name when malformed', () => {
    const ext = parseSourceExt(visualFiles({ mediaType: 42, name: '' }));
    expect(ext?.visual?.mediaType).toBe('application/pdf');
    expect(ext?.visual?.name).toBe('0123456789abcdef.pdf');
  });

  it('visualSourceDetails reports name, type and size', () => {
    const files = visualFiles();
    const ext = parseSourceExt(files);
    expect(visualSourceDetails(files, ext as SourceExt)).toEqual({
      fileName: 'delibera 42.pdf',
      mediaType: 'application/pdf',
      sizeLabel: '3.0 KB',
    });
  });

  it('visualSourceDetails is undefined without a visual or without bytes', () => {
    const files = binaryNoVisual();
    const ext = parseSourceExt(files);
    expect(ext).toBeDefined();
    expect(visualSourceDetails(files, ext as SourceExt)).toBeUndefined();
  });

  function binaryNoVisual(): Map<string, Uint8Array> {
    const meta = {
      source: '0.4',
      kind: 'binary',
      main: 'ext/source/cafebabe12345678.docx',
      mainName: 'delibera 42.docx',
      resources: {},
    };
    return new Map([
      ['ext/source/source.json', enc.encode(JSON.stringify(meta))],
      ['ext/source/cafebabe12345678.docx', new Uint8Array(2048)],
    ]);
  }
});
