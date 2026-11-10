/**
 * Standalone distribution profile (spec §9): one HTML file — the viewer's
 * standalone template — with the package embedded as base64. One filler for
 * every producer (CLI, browser extension, Reader converter; plan §10.80), so
 * the same package and title always yield the same file, on any platform.
 */

import { WdfError } from './errors.js';

// The placeholders are assembled at run time, never written as literals:
// the Reader bundles this module INTO the template it fills, and a literal
// would be a second occurrence — the title (HTML-escaped only) would land in
// the template's own script and a quote in it would break the file.
const mark = (name: string): string => ['', '', 'WDF', name, '', ''].join('_');
export const STANDALONE_TITLE = mark('TITLE');
export const STANDALONE_PACKAGE = mark('PACKAGE_BASE64');

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Standard base64 (RFC 4648 §4, padded) without Node's Buffer. */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/**
 * Fills the template's placeholders: the title (every occurrence,
 * HTML-escaped) and the package (once). Replacer functions keep `$`
 * sequences in the title or payload literal.
 */
export function fillStandalone(template: string, title: string, wdfBase64: string): string {
  return template
    .replaceAll(STANDALONE_TITLE, () => escapeHtml(title))
    .replace(STANDALONE_PACKAGE, () => wdfBase64);
}

const EMBED_OPEN = '<script type="application/wdf+zip" id="wdf-package">';
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Re-extracts the embedded package from a standalone file (spec §9.2). Only
 * the form of §9.1 is accepted: exactly one embedding script, standard
 * base64 whose only allowed extra character is the line feed. Anything else
 * is rejected — the bytes returned still go through readPackage() and
 * validatePackage() like any other package.
 */
export function extractStandalone(html: string): Uint8Array {
  const parts = html.split(EMBED_OPEN);
  if (parts.length !== 2) {
    throw new WdfError(
      parts.length === 1
        ? 'not a standalone file: no embedded package script'
        : 'ambiguous standalone file: more than one embedded package script',
      '§9.1',
    );
  }
  const rest = parts[1] ?? '';
  const end = rest.indexOf('</script>');
  if (end === -1) throw new WdfError('unterminated embedded package script', '§9.1');
  const encoded = rest.slice(0, end).replaceAll('\n', '');
  if (encoded.length === 0 || encoded.length % 4 !== 0 || !BASE64.test(encoded)) {
    throw new WdfError('embedded package is not standard base64 (RFC 4648)', '§9.1');
  }
  const bin = atob(encoded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
