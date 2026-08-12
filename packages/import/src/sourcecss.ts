import { elementChildren, findChild, getAttr, parseHtml, sha256Hex } from '@wdf-dev/core';

import type { AssetCaps } from './assets.js';

/**
 * External stylesheets for the `source` extension (WP15, plan §10.23):
 * a web page's original look lives in linked CSS files; without them the
 * Original view is an unstyled skeleton. They are embedded byte-for-byte
 * under ext/source/ and recorded in source.json's `stylesheets` map.
 * Declared limits (v0.2): `url()` and `@import` inside the CSS are not
 * localized — the no-network CSP still applies when viewing.
 */

/** Resolves an href to CSS bytes, or undefined when unavailable/denied. */
export type CssFetcher = (href: string) => Promise<Uint8Array | undefined>;

export async function collectSourceStylesheets(
  html: string,
  fetchCss: CssFetcher,
  caps: AssetCaps,
  report: string[],
): Promise<{ files: Map<string, Uint8Array>; stylesheets: Record<string, string> }> {
  const files = new Map<string, Uint8Array>();
  const collected: [string, string][] = [];
  const root = parseHtml(html).html;
  const head = root === null ? undefined : findChild(root, 'head');
  if (head === undefined) return { files, stylesheets: {} };

  const seen = new Set<string>();
  let total = 0;
  for (const link of elementChildren(head)) {
    if (link.tag !== 'link') continue;
    const rel = (getAttr(link, 'rel') ?? '').toLowerCase().split(/\s+/);
    if (!rel.includes('stylesheet')) continue;
    const href = getAttr(link, 'href');
    if (href === undefined || href === '' || seen.has(href)) continue;
    seen.add(href);
    if (collected.length >= caps.maxCount) {
      report.push(`stylesheet skipped (count limit): ${href}`);
      continue;
    }
    const bytes = await fetchCss(href);
    if (bytes === undefined) {
      report.push(`stylesheet not embedded in the source extension: ${href}`);
      continue;
    }
    if (bytes.length > caps.perFile || total + bytes.length > caps.totalBytes) {
      report.push(`stylesheet skipped (size limit): ${href}`);
      continue;
    }
    total += bytes.length;
    const path = `ext/source/${(await sha256Hex(bytes)).slice(0, 16)}.css`;
    files.set(path, bytes);
    collected.push([href, path]);
  }
  if (collected.length > 0) {
    report.push(`embedded ${String(collected.length)} source stylesheet(s) (WP15)`);
  }
  collected.sort(([a], [b]) => (a < b ? -1 : 1));
  return { files, stylesheets: Object.fromEntries(collected) };
}
