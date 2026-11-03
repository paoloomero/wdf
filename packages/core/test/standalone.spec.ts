import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  bytesToBase64,
  fillStandalone,
  STANDALONE_PACKAGE,
  STANDALONE_TITLE,
} from '../src/index.js';

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
  });

  const built = join(import.meta.dirname, '../../viewer/dist/standalone.html');
  it.runIf(existsSync(built))('the built template holds each placeholder exactly once', () => {
    const template = readFileSync(built, 'utf8');
    expect(template.split(STANDALONE_TITLE).length - 1).toBe(1);
    expect(template.split(STANDALONE_PACKAGE).length - 1).toBe(1);
  });
});
