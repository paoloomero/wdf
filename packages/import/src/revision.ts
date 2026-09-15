import {
  elementChildren,
  getAttr,
  isElement,
  normalizedText,
  parseHtml,
  sha256Hex,
  type WdfElement,
  type WdfNode,
} from '@wdf-dev/core';

import { isEl, textOf, type MEl, type MNode } from './ast.js';

/**
 * Document identity across imports (review F07, plan §10.70).
 *
 * Spec §4.1: the manifest `id` identifies the document, not a revision, and
 * MUST NOT change when content is revised. By default an import derives the
 * id from the canonical HTML, so any change yields a new document. Two
 * producer paths make revisions possible: an explicit `previous` revision
 * (inherit its id, its creation date and the ids of unchanged elements,
 * §6.4.4) and, for captures, an id derived from the page URL (re-captures of
 * the same address are revisions of the same logical document).
 */

const enc = new TextEncoder();

/** RFC 4122 layout over a SHA-256 hex digest (version nibble 5, RFC variant). */
export function deterministicUuid(hex: string): string {
  const variant = ((parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const DOCUMENT_ID_PATTERN =
  /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Document id of a captured or fetched page: a function of its URL without
 * the fragment, so every capture of the same address shares the id (same
 * logical document, successive revisions). Scheme, host, path and query
 * are taken verbatim — two spellings of one address are two documents.
 */
export async function documentIdForUrl(url: string): Promise<string> {
  const canonical = url.replace(/#.*$/, '');
  return deterministicUuid(await sha256Hex(enc.encode(canonical)));
}

/** The earlier revision an import updates. */
export interface PreviousRevision {
  /** Manifest id of the earlier revision — inherited as-is (§4.1). */
  id: string;
  /** Its manifest `created`, preserved when it precedes the new date. */
  created?: string;
  /** Its content/index.html, source of the element ids to inherit (§6.4.4). */
  html: string;
}

/** Seed for id assignment: ids never to reissue and counters to continue from. */
export interface IdSeed {
  used: Set<string>;
  counters: Partial<Record<'p' | 'li' | 'tbl' | 'fig' | 'bq' | 'sec' | 'h', number>>;
}

const CITABLE = new Set([
  'section',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'table',
  'figure',
  'blockquote',
]);
const COUNTED = /^(p|li|tbl|fig|bq|sec|h)-(\d+)$/;

function norm(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** `tag|normalized text`: the identity of a logical element for matching. */
function keyOf(tag: string, text: string): string {
  return `${tag}|${norm(text)}`;
}

/** Citable elements of the previous entry document, keyed, in document order. */
function previousElements(html: string): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  const walk = (node: WdfNode, listDepth: number): void => {
    if (!isElement(node)) return;
    const el: WdfElement = node;
    const id = getAttr(el, 'id');
    const citable = CITABLE.has(el.tag) || (el.tag === 'li' && listDepth === 1);
    if (citable && id !== undefined) {
      const key = keyOf(el.tag, normalizedText(el));
      const list = byKey.get(key) ?? [];
      list.push(id);
      byKey.set(key, list);
    }
    const next = el.tag === 'ul' || el.tag === 'ol' ? listDepth + 1 : listDepth;
    for (const child of elementChildren(el)) walk(child, next);
  };
  const root = parseHtml(html).html;
  if (root !== null) walk(root, 0);
  return byKey;
}

/**
 * Carries the ids of unchanged elements from the previous revision onto the
 * new blocks (same tag, same normalized text — matched in document order
 * when a text repeats), before fresh ids are assigned. Returns the seed
 * that keeps every previous id, present or gone, out of the fresh pool:
 * an id is never reassigned to a different logical element (§6.4.4).
 */
export function inheritIds(blocks: MEl[], previousHtml: string, report: string[]): IdSeed {
  const byKey = previousElements(previousHtml);
  const seed: IdSeed = { used: new Set<string>(), counters: {} };
  for (const ids of byKey.values()) {
    for (const id of ids) {
      seed.used.add(id);
      const m = COUNTED.exec(id);
      if (m !== null) {
        const prefix = m[1] as keyof IdSeed['counters'];
        const n = Number(m[2]);
        seed.counters[prefix] = Math.max(seed.counters[prefix] ?? 0, n);
      }
    }
  }
  let inherited = 0;
  let fresh = 0;
  const walk = (nodes: MNode[], listDepth: number): void => {
    for (const node of nodes) {
      if (!isEl(node)) continue;
      const citable = CITABLE.has(node.tag) || (node.tag === 'li' && listDepth === 1);
      if (citable && node.attrs['id'] === undefined) {
        const candidates = byKey.get(keyOf(node.tag, textOf(node)));
        const id = candidates?.shift();
        if (id !== undefined) {
          node.attrs['id'] = id;
          // Now legitimately on an element: ensureIds keeps it (and treats a
          // second occurrence as the duplicate it would be).
          seed.used.delete(id);
          inherited++;
        } else {
          fresh++;
        }
      }
      const next = node.tag === 'ul' || node.tag === 'ol' ? listDepth + 1 : listDepth;
      walk(node.children, next);
    }
  };
  walk(blocks, 0);
  report.push(
    `revision of an earlier document: ${String(inherited)} element id(s) inherited, ${String(fresh)} new (spec §6.4.4)`,
  );
  return seed;
}
