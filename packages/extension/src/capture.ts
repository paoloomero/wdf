// The capture engine (T18.2, plan §10.31/§10.32): everything the content
// script collects from the live page. DOM access is kept at the edges
// (injectable measure/fetch/encode callbacks), so the assembly logic is
// unit-testable without a browser.
import type { CaptureElementGeometry, CapturePageGeometry } from '@wdf-dev/import';

// ---------------------------------------------------------------------------
// Caps. Mirrors @wdf-dev/import DEFAULT_CAPS (asserted by a unit test) instead
// of importing it: the content-script bundle must not drag the import
// pipeline into the page.

export interface CaptureCaps {
  /** Max bytes for a single image. */
  perFile: number;
  /** Max total bytes across all captured images. */
  totalBytes: number;
  /** Max number of images. */
  maxCount: number;
}

export const CAPTURE_CAPS: CaptureCaps = {
  perFile: 5 * 1024 * 1024,
  totalBytes: 20 * 1024 * 1024,
  maxCount: 50,
};

// ---------------------------------------------------------------------------
// Geometry: what only the rendering knows, recorded per element for the
// geometric pre-filter (T18.3). The capture records facts; the policy is
// `geometryExclusions` in @wdf-dev/import (prefilter.ts) — same package that
// consumes this payload at conversion, so producer and consumer share the
// types (type-only imports: nothing of the pipeline enters the bundle).
// The marker attribute stamped below is @wdf-dev/import's CAPTURE_MARK
// ('data-wdf-cap'), kept literal here for the same reason and asserted in
// sync by a unit test.

export type ElementGeometry = CaptureElementGeometry;
export type CaptureGeometry = CapturePageGeometry;

export type Measure = (el: Element) => Omit<ElementGeometry, 'id' | 'tag'>;

export interface DomSnapshot {
  doctype: string;
  html: string;
  baseUrl: string;
  title: string;
  lang: string;
}

/**
 * Serializes the rendered DOM and measures its geometry in one parallel
 * walk. The live document is never touched: a deep clone is stamped with
 * sequential `data-wdf-cap` markers while each live counterpart is
 * measured, so marker N in the snapshot corresponds to `elements[N]`.
 *
 * Snapshot normalization (part of the dom-snapshot semantics, see
 * docs/ext-source.md `kind`): every `img` gets `src` rewritten to its
 * rendered choice (`currentSrc`, absolute) and `srcset`/`sizes` dropped —
 * the snapshot records what THIS rendering displayed, and the conversion
 * maps image bytes by that same URL.
 */
export function snapshotAndMeasure(
  doc: Document,
  measure: Measure,
): { snapshot: DomSnapshot; elements: ElementGeometry[] } {
  const root = doc.documentElement;
  const clone = root.cloneNode(true) as Element;
  const elements: ElementGeometry[] = [];

  const walk = (live: Element, copy: Element): void => {
    const id = elements.length;
    copy.setAttribute('data-wdf-cap', String(id));
    elements.push({ id, tag: live.tagName.toLowerCase(), ...measure(live) });
    if (live.tagName === 'IMG') {
      const img = live as HTMLImageElement;
      const rendered = img.currentSrc !== '' ? img.currentSrc : img.src;
      if (rendered !== '') copy.setAttribute('src', rendered);
      copy.removeAttribute('srcset');
      copy.removeAttribute('sizes');
    }
    if (live.tagName === 'SOURCE') copy.removeAttribute('srcset');
    for (let i = 0; i < live.children.length; i++) {
      const liveChild = live.children[i];
      const copyChild = copy.children[i];
      if (liveChild !== undefined && copyChild !== undefined) walk(liveChild, copyChild);
    }
  };
  walk(root, clone);

  const doctype = doc.doctype === null ? '' : `<!DOCTYPE ${doc.doctype.name}>\n`;
  return {
    snapshot: {
      doctype,
      html: `${doctype}${clone.outerHTML}\n`,
      baseUrl: doc.baseURI,
      title: doc.title,
      lang: root.getAttribute('lang') ?? '',
    },
    elements,
  };
}

/** The browser measurement (content script); tests inject their own. */
export function measureElement(el: Element, win: Window): Omit<ElementGeometry, 'id' | 'tag'> {
  const cs = win.getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    rect: { x: r.x + win.scrollX, y: r.y + win.scrollY, width: r.width, height: r.height },
    display: cs.display,
    visibility: cs.visibility,
    position: cs.position,
  };
}

// ---------------------------------------------------------------------------
// Stylesheets: original sheets via CSSOM where readable, fetch fallback
// when CSSOM is blocked (cross-origin without CORS), declared limit in the
// report when even the fetch fails (§10.31 "Serializzazione").

export interface CapturedStylesheet {
  /** Absolute sheet URL, or "(adopted)" for constructable stylesheets. */
  href: string;
  css: string;
  origin: 'cssom' | 'fetch';
}

/** A minimal view of CSSStyleSheet, so tests can fake blocked sheets. */
export interface SheetLike {
  href: string | null;
  /** Getter may throw SecurityError (cross-origin without CORS). */
  cssRules: ArrayLike<{ cssText: string; constructor: { name: string } }>;
}

export async function collectStylesheets(
  sheets: readonly SheetLike[],
  adopted: readonly SheetLike[],
  fetchText: (url: string) => Promise<string>,
  report: string[],
): Promise<CapturedStylesheet[]> {
  const out: CapturedStylesheet[] = [];
  const cssomText = (sheet: SheetLike): string => {
    let css = '';
    let imports = 0;
    for (const rule of Array.from(sheet.cssRules)) {
      if (rule.constructor.name === 'CSSImportRule') imports++;
      css += `${rule.cssText}\n`;
    }
    if (imports > 0) {
      report.push(
        `stylesheet ${sheet.href ?? '(adopted)'}: ${String(imports)} @import rule(s) not localized`,
      );
    }
    return css;
  };

  for (const sheet of sheets) {
    // Inline <style> elements (href null) are already in the snapshot.
    if (sheet.href === null) continue;
    try {
      out.push({ href: sheet.href, css: cssomText(sheet), origin: 'cssom' });
    } catch {
      try {
        out.push({ href: sheet.href, css: await fetchText(sheet.href), origin: 'fetch' });
      } catch {
        report.push(`stylesheet not captured (CSSOM blocked, fetch failed): ${sheet.href}`);
      }
    }
  }
  for (const sheet of adopted) {
    try {
      out.push({ href: '(adopted)', css: cssomText(sheet), origin: 'cssom' });
    } catch {
      report.push('an adopted stylesheet could not be serialized');
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Images: zero-fetch default — bytes from the render via canvas for
// CORS-clean images; page-context fetch (with the page's session) for the
// rest; whatever stays unreachable goes in the report, never silent
// (§10.31 "Rete e caps").

export interface CapturedImage {
  /** The rendered URL (currentSrc), the map key at conversion time. */
  url: string;
  base64: string;
  mediaType: string;
  origin: 'canvas' | 'fetch';
}

/** A minimal view of HTMLImageElement, so tests can fake render state. */
export interface ImageLike {
  currentSrc: string;
  src: string;
}

export type ImageEncoder = (img: ImageLike) => { base64: string; mediaType: string } | undefined;
export type BytesFetcher = (url: string) => Promise<{ base64: string; mediaType: string }>;

export async function collectImages(
  images: readonly ImageLike[],
  encodeFromRender: ImageEncoder,
  fetchBytes: BytesFetcher,
  caps: CaptureCaps,
  report: string[],
): Promise<CapturedImage[]> {
  const out: CapturedImage[] = [];
  const seen = new Set<string>();
  let total = 0;

  const push = (
    url: string,
    data: { base64: string; mediaType: string },
    origin: 'canvas' | 'fetch',
  ): void => {
    const bytes = Math.floor((data.base64.length * 3) / 4);
    if (bytes > caps.perFile) {
      report.push(`image over the per-file cap (${String(bytes)} bytes), skipped: ${url}`);
      return;
    }
    if (total + bytes > caps.totalBytes) {
      report.push(`image over the total cap, skipped: ${url}`);
      return;
    }
    total += bytes;
    out.push({ url, ...data, origin });
  };

  for (const img of images) {
    const url = img.currentSrc !== '' ? img.currentSrc : img.src;
    if (url === '' || url.startsWith('data:') || seen.has(url)) continue;
    seen.add(url);
    if (seen.size > caps.maxCount) {
      report.push(`image count cap (${String(caps.maxCount)}) reached, skipped: ${url}`);
      continue;
    }
    const rendered = encodeFromRender(img);
    if (rendered !== undefined) {
      push(url, rendered, 'canvas');
      continue;
    }
    try {
      push(url, await fetchBytes(url), 'fetch');
    } catch {
      report.push(`image not captured (render unreadable, fetch failed): ${url}`);
    }
  }
  return out;
}

/** The browser encoder (content script): canvas of the rendered image. */
export function canvasEncoder(doc: Document): ImageEncoder {
  return (img) => {
    const el = img as unknown as HTMLImageElement;
    if (!el.complete || el.naturalWidth === 0) return undefined;
    try {
      const canvas = doc.createElement('canvas');
      canvas.width = el.naturalWidth;
      canvas.height = el.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (ctx === null) return undefined;
      ctx.drawImage(el, 0, 0);
      // Throws SecurityError when the image tainted the canvas
      // (cross-origin without CORS) — the caller falls back to fetch.
      const dataUrl = canvas.toDataURL('image/png');
      return { base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mediaType: 'image/png' };
    } catch {
      return undefined;
    }
  };
}
