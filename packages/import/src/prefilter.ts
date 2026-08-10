import { getAttr, isElement, type WdfDocument, type WdfElement } from '@wdf/core';

/**
 * Geometric pre-filter (T18.3, plan §10.31 "Estrazione articolo"): rules
 * based on what only the rendering knows, written in the plan and
 * implemented as a pure geometries→exclusions function so they are
 * unit-testable and shared by every capture consumer. The capture records
 * facts (extension src/capture.ts); THIS is the policy.
 */

/** Marker attribute stamped on dom-snapshot elements by the extension. */
export const CAPTURE_MARK = 'data-wdf-cap';

export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Per-element rendering facts; `id` matches the data-wdf-cap marker. */
export interface CaptureElementGeometry {
  id: number;
  tag: string;
  /** Document coordinates. */
  rect: CaptureRect;
  display: string;
  visibility: string;
  position: string;
}

export interface CapturePageGeometry {
  viewport: { width: number; height: number; devicePixelRatio: number };
  /** Scrollable size of the document root. */
  document: { width: number; height: number };
  elements: CaptureElementGeometry[];
}

export type ExclusionReason = 'hidden' | 'invisible' | 'fixed-sticky' | 'off-flow';

export interface CaptureExclusion {
  id: number;
  tag: string;
  reason: ExclusionReason;
}

// Never excluded: document structure, and metadata elements whose computed
// display is none BY NATURE (head, title, link, style… all report
// display:none in a real browser — a fact the e2e capture surfaced).
const NEVER_EXCLUDED = new Set([
  'html',
  'head',
  'body',
  'title',
  'meta',
  'link',
  'style',
  'script',
  'base',
  'noscript',
  'template',
]);

/**
 * The enumerable rules of plan §10.31: `display:none` and
 * `visibility:hidden/collapse` (invisible content — dropdown menus, the
 * Wikipedia interlanguage list of §10.27), `position:fixed/sticky` (page
 * chrome — banners, sticky headers), and geometry entirely outside the
 * document box (skip-link traps at left:-9999px). First matching rule
 * names the reason. Descendants of an excluded element need no entry of
 * their own: pruning removes whole subtrees.
 *
 * Declared limit: a `visibility:hidden` container with a
 * `visibility:visible` descendant is excluded whole — the rendered-visible
 * descendant is lost. Rare in page chrome; revisit on field-test evidence.
 */
export function geometryExclusions(geometry: CapturePageGeometry): CaptureExclusion[] {
  const out: CaptureExclusion[] = [];
  const doc = geometry.document;
  for (const el of geometry.elements) {
    if (NEVER_EXCLUDED.has(el.tag)) continue;
    const r = el.rect;
    const hasExtent = r.width > 0 || r.height > 0;
    const fullyOutside =
      r.x + r.width <= 0 || r.y + r.height <= 0 || r.x >= doc.width || r.y >= doc.height;
    let reason: ExclusionReason | undefined;
    if (el.display === 'none') reason = 'hidden';
    else if (el.visibility === 'hidden' || el.visibility === 'collapse') reason = 'invisible';
    else if (el.position === 'fixed' || el.position === 'sticky') reason = 'fixed-sticky';
    else if (hasExtent && fullyOutside) reason = 'off-flow';
    if (reason !== undefined) out.push({ id: el.id, tag: el.tag, reason });
  }
  return out;
}

/**
 * Strips capture markers from a snapshot SERIALIZATION — for embedding the
 * marker-free snapshot as the `source` original (the marker is transport,
 * never content). Anchored to the exact attribute our own serializer
 * emits; a script body containing the literal pattern would be altered
 * too — vanishingly rare and cosmetic only, accepted.
 */
export function stripCaptureMarks(html: string): string {
  return html.replaceAll(new RegExp(` ${CAPTURE_MARK}="\\d+"`, 'g'), '');
}

/**
 * Applies exclusions to a parsed dom-snapshot: marked subtrees whose id is
 * excluded are dropped, and every surviving element loses its capture
 * marker (the attribute is transport, never content). Pure — returns a new
 * tree, the input is untouched.
 */
export function pruneCaptureMarks(
  doc: WdfDocument,
  excluded: ReadonlySet<number>,
): { doc: WdfDocument; removed: number } {
  let removed = 0;
  const pruneEl = (el: WdfElement): WdfElement | null => {
    const mark = getAttr(el, CAPTURE_MARK);
    if (mark !== undefined && excluded.has(Number(mark))) {
      removed++;
      return null;
    }
    return {
      kind: 'element',
      tag: el.tag,
      attrs: el.attrs.filter((a) => a.name !== CAPTURE_MARK),
      children: el.children
        .map((c) => (isElement(c) ? pruneEl(c) : c))
        .filter((c): c is NonNullable<typeof c> => c !== null),
    };
  };
  const html = doc.html === null ? null : pruneEl(doc.html);
  return { doc: { doctype: doc.doctype, html }, removed };
}
