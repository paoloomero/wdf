import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  aiMarkdownOf,
  bytesToBase64,
  extractStandalone,
  fillStandalone,
  readableCopyOf,
  standaloneFor,
  STANDALONE_PACKAGE,
  STANDALONE_READABLE,
  STANDALONE_TITLE,
  validateStandalone,
} from '../src/index.js';
import { extract, serializeOutline } from '../src/extract.js';
import { computeHashes, serializeHashes } from '../src/integrity.js';
import { writePackage } from '../src/package.js';

describe('standalone filler (spec §9)', () => {
  it('encodes base64 exactly like Node, across chunk boundaries', () => {
    const bytes = new Uint8Array(0x8000 * 2 + 5);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) & 0xff;
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    expect(bytesToBase64(new Uint8Array())).toBe('');
  });

  it('escapes the title everywhere and embeds the payload once, literally', () => {
    const template =
      '<title>__WDF_TITLE__</title><h1>__WDF_TITLE__</h1><script>__WDF_PACKAGE_BASE64__</script>';
    expect(fillStandalone(template, 'A <b> & $& title', 'QUJD$1')).toBe(
      '<title>A &lt;b&gt; &amp; $&amp; title</title><h1>A &lt;b&gt; &amp; $&amp; title</h1><script>QUJD$1</script>',
    );
  });

  it('names the placeholders the viewer build writes', () => {
    expect(STANDALONE_TITLE).toBe('__WDF_TITLE__');
    expect(STANDALONE_PACKAGE).toBe('__WDF_PACKAGE_BASE64__');
  });

  // Plan §10.80: the Reader bundles this filler into the very template it
  // fills. A literal placeholder in the source would reach the bundle as a
  // second occurrence, and the title would be written into the script.
  it('never spells a placeholder literally in the filler source', () => {
    const src = readFileSync(join(import.meta.dirname, '../src/standalone.ts'), 'utf8');
    expect(src).not.toContain(STANDALONE_TITLE);
    expect(src).not.toContain(STANDALONE_PACKAGE);
    expect(src).not.toContain(STANDALONE_READABLE);
  });

  const built = join(import.meta.dirname, '../../viewer/dist/standalone.html');
  it.runIf(existsSync(built))('the built template holds each placeholder where expected', () => {
    const template = readFileSync(built, 'utf8');
    // <title> and <meta name="description"> (§9.7); package and readable copy once.
    expect(template.split(STANDALONE_TITLE).length - 1).toBe(2);
    expect(template.split(STANDALONE_PACKAGE).length - 1).toBe(1);
    expect(template.split(STANDALONE_READABLE).length - 1).toBe(1);
  });
});

describe('standalone extraction (spec §9.2)', () => {
  const embed = (b64: string): string =>
    `<!doctype html><title>t</title><script type="application/wdf+zip" id="wdf-package">${b64}</script><script>/* viewer */</script>`;

  it('re-extracts the byte-identical package from a filled template', () => {
    const bytes = new Uint8Array(0x8000 + 7);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 13) & 0xff;
    const template = embed(STANDALONE_PACKAGE).replace('<title>t', `<title>${STANDALONE_TITLE}`);
    const html = fillStandalone(template, 'Title', bytesToBase64(bytes));
    expect(extractStandalone(html)).toEqual(bytes);
  });

  it('accepts line feeds inside the encoded text (§9.1)', () => {
    expect(extractStandalone(embed('QU\nJD\n'))).toEqual(new TextEncoder().encode('ABC'));
  });

  it('rejects anything but exactly one well-formed embedding, citing §9.1', () => {
    for (const html of [
      '<html>no package</html>',
      embed('QUJD') + embed('QUJD'),
      embed('QU JD'),
      embed('QUJD\r\n'),
      embed('QUJ'),
      embed(''),
      '<script type="application/wdf+zip" id="wdf-package">QUJD',
    ]) {
      expect(() => extractStandalone(html)).toThrow(/§9\.1/);
    }
  });
});

// Spec §9.5–§9.7 (plan §10.91): an agent that runs no script must find the
// document — the canonical Markdown — not only the viewer.
describe('standalone readable copy (spec §9.5–§9.7)', () => {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const exampleDir = join(import.meta.dirname, '../../../examples/municipal-decree');

  async function decreePackage(): Promise<Uint8Array> {
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
    files.set('integrity/hashes.json', enc.encode(serializeHashes(await computeHashes(files))));
    return writePackage({ manifest: JSON.parse(dec.decode(files.get('manifest.json'))), files });
  }

  const TEMPLATE =
    '<!doctype html><html><head><title>__WDF_TITLE__</title>' +
    '<meta name="description" content="__WDF_TITLE__" /></head><body>' +
    '<p id="wdf-agent-note">WDF document.</p><pre id="wdf-readable">__WDF_READABLE_MARKDOWN__</pre>' +
    '<script type="application/wdf+zip" id="wdf-package">__WDF_PACKAGE_BASE64__</script>' +
    '<script>/* viewer */</script></body></html>';

  /** What a text extractor keeps: no script, no style, markup gone, references decoded. */
  const extractorView = (html: string): string =>
    html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');

  it('carries ai/content.md, readable without scripts, and stays verified', async () => {
    const bytes = await decreePackage();
    const html = standaloneFor(TEMPLATE, 'Decree "87" <2026>', bytes);
    const markdown = aiMarkdownOf(bytes);
    expect(readableCopyOf(html)).toBe(markdown);
    expect(extractorView(html)).toContain(markdown);
    expect(markdown).toContain('{#'); // the citation anchors travel too
    expect(html).toContain(
      '<meta name="description" content="Decree &quot;87&quot; &lt;2026&gt;" />',
    );
    expect(extractStandalone(html)).toEqual(bytes);
    const result = await validateStandalone(html);
    expect(result.status).toBe('verified');
    // Same package, same title: same bytes.
    expect(standaloneFor(TEMPLATE, 'Decree "87" <2026>', bytes)).toBe(html);
  });

  it('a readable copy altered by one byte is a §9.6 error', async () => {
    const bytes = await decreePackage();
    const html = standaloneFor(TEMPLATE, 'Decree', bytes);
    const tampered = html.replace('Decree no. 87/2026', 'Decree no. 88/2026');
    expect(tampered).not.toBe(html);
    const result = await validateStandalone(tampered);
    expect(result.verified).toBe(false);
    expect(result.status).toBe('not-conforming');
    expect(result.violations.at(-1)).toMatchObject({ spec: '§9.6', severity: 'error' });
  });

  it('a file without a readable copy stays conforming (additive errata)', async () => {
    const bytes = await decreePackage();
    const old = fillStandalone(
      TEMPLATE.replace(/<pre id="wdf-readable">[^<]*<\/pre>/, ''),
      'Decree',
      bytesToBase64(bytes),
    );
    expect(readableCopyOf(old)).toBeUndefined();
    expect((await validateStandalone(old)).status).toBe('verified');
  });

  it('fills in one pass: a document spelling a placeholder stays literal', () => {
    const md = 'See __WDF_PACKAGE_BASE64__ and __WDF_TITLE__ & <tags>.';
    const html = fillStandalone(TEMPLATE, 'T', 'QUJD', md);
    expect(readableCopyOf(html)).toBe(md);
    expect(extractStandalone(html)).toEqual(new Uint8Array([0x41, 0x42, 0x43]));
  });

  it('two readable copies are a §9.5 error', async () => {
    const bytes = await decreePackage();
    const html = standaloneFor(TEMPLATE, 'Decree', bytes);
    const doubled = html.replace('<body>', '<body><pre id="wdf-readable">x</pre>');
    const result = await validateStandalone(doubled);
    expect(result.violations.at(-1)).toMatchObject({ spec: '§9.5', severity: 'error' });
  });
});
