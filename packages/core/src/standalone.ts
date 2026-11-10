/**
 * Standalone distribution profile (spec §9): one HTML file — the viewer's
 * standalone template — with the package embedded as base64. One filler for
 * every producer (CLI, browser extension, Reader converter; plan §10.80), so
 * the same package and title always yield the same file, on any platform.
 */

import { unzipSync } from 'fflate';

import { WdfError } from './errors.js';
import type { Violation } from './profile.js';
import { validatePackage, type ValidationResult } from './validate.js';

// The placeholders are assembled at run time, never written as literals:
// the Reader bundles this module INTO the template it fills, and a literal
// would be a second occurrence — the title (HTML-escaped only) would land in
// the template's own script and a quote in it would break the file.
const mark = (name: string): string => ['', '', 'WDF', name, '', ''].join('_');
export const STANDALONE_TITLE = mark('TITLE');
export const STANDALONE_PACKAGE = mark('PACKAGE_BASE64');
/** The readable copy of ai/content.md (spec §9.5, plan §10.91). */
export const STANDALONE_READABLE = mark('READABLE_MARKDOWN');

/** Text content: only &, < and > are escaped (the §9.5 readable copy relies on it). */
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Attribute values too: the title also fills <meta name="description" content="…">. */
function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
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
 * Fills the template's placeholders in ONE pass — the title (every
 * occurrence, HTML-escaped), the readable copy (§9.5) and the package
 * (once) — so text inserted for one placeholder is never scanned for
 * another (a document may well contain a placeholder's spelling).
 * Templates without the readable placeholder (older ones) are filled as
 * before.
 */
export function fillStandalone(
  template: string,
  title: string,
  wdfBase64: string,
  readableMarkdown = '',
): string {
  const markers = new RegExp(
    [STANDALONE_TITLE, STANDALONE_READABLE, STANDALONE_PACKAGE].join('|'),
    'g',
  );
  let packageFilled = false;
  return template.replace(markers, (marker) => {
    if (marker === STANDALONE_TITLE) return escapeAttr(title);
    if (marker === STANDALONE_READABLE) return escapeText(readableMarkdown);
    if (packageFilled) return marker;
    packageFilled = true;
    return wdfBase64;
  });
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** The package's ai/content.md (§7), read straight from the archive. */
export function aiMarkdownOf(wdfBytes: Uint8Array): string {
  const files = unzipSync(wdfBytes, { filter: (f) => f.name === 'ai/content.md' });
  const md = files['ai/content.md'];
  if (md === undefined) throw new WdfError('the package has no ai/content.md', '§3.3.1');
  return utf8.decode(md);
}

/**
 * The standalone file of a package (spec §9): template, title, embedded
 * package and readable copy of its ai/content.md. The one entry point of
 * every producer — CLI, Reader converter, browser extension — so the same
 * package and title always yield the same bytes.
 */
export function standaloneFor(template: string, title: string, wdfBytes: Uint8Array): string {
  return fillStandalone(template, title, bytesToBase64(wdfBytes), aiMarkdownOf(wdfBytes));
}

const READABLE_OPEN = '<pre id="wdf-readable">';
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>' };

/**
 * The readable copy of a standalone file (spec §9.5), decoded, or undefined
 * when the file has none. Only &amp; &lt; &gt; are decoded: any other
 * reference stays literal, and the comparison of §9.6 then fails.
 */
export function readableCopyOf(html: string): string | undefined {
  const parts = html.split(READABLE_OPEN);
  if (parts.length === 1) return undefined;
  if (parts.length > 2)
    throw new WdfError('more than one readable copy (pre#wdf-readable)', '§9.5');
  const rest = parts[1] ?? '';
  const end = rest.indexOf('</pre>');
  if (end === -1) throw new WdfError('unterminated readable copy (pre#wdf-readable)', '§9.5');
  return rest.slice(0, end).replace(/&(amp|lt|gt);/g, (_, e: string) => ENTITIES[e] ?? '');
}

/**
 * Adds the §9.6 check to a package's verdict: a readable copy that differs
 * from ai/content.md makes the standalone file non-conforming — it would
 * show agents a text the package does not vouch for. No copy: unchanged.
 */
export function checkReadableCopy(
  result: ValidationResult,
  html: string,
  aiMarkdown: string,
): ValidationResult {
  let violation: Violation | undefined;
  try {
    const copy = readableCopyOf(html);
    if (copy === undefined || copy === aiMarkdown) return result;
    violation = {
      spec: '§9.6',
      path: 'pre#wdf-readable',
      message: "the readable copy differs from the embedded package's ai/content.md",
      severity: 'error',
    };
  } catch (e) {
    if (!(e instanceof WdfError)) throw e;
    violation = { spec: '§9.5', path: 'pre#wdf-readable', message: e.message, severity: 'error' };
  }
  const downgraded = result.status === 'verified';
  return {
    ...result,
    status: downgraded ? 'not-conforming' : result.status,
    verified: false,
    conformance: false,
    violations: [...result.violations, violation],
  };
}

/** Validates a standalone file: its embedded package (§9.2) and its readable copy (§9.6). */
export async function validateStandalone(html: string): Promise<ValidationResult> {
  const bytes = extractStandalone(html);
  const result = await validatePackage(bytes);
  let markdown: string;
  try {
    markdown = aiMarkdownOf(bytes);
  } catch {
    return result; // the package verdict already reports what is missing
  }
  return checkReadableCopy(result, html, markdown);
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
