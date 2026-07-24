import type { WdfOutline, WdfOutlineNode } from '@wdf/core';

/** Pure helpers of the viewer — kept DOM-free so they are unit-testable. */

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  woff2: 'font/woff2',
};

export function mimeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return MIME[ext] ?? 'application/octet-stream';
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function toDataUri(path: string, bytes: Uint8Array): string {
  return `data:${mimeFor(path)};base64,${bytesToBase64(bytes)}`;
}

/**
 * Inlines package resources into the entry document: the stylesheet becomes a
 * <style> element, image sources become data: URIs. The sandboxed frame can
 * then render with zero requests (spec §11.3).
 */
export function inlineResources(html: string, files: ReadonlyMap<string, Uint8Array>): string {
  let out = html.replace(/<link\b[^>]*rel="stylesheet"[^>]*\/?>/, () => {
    const css = files.get('content/styles.css');
    if (css === undefined) return '';
    return `<style>\n${new TextDecoder().decode(css)}\n</style>`;
  });
  out = out.replace(/src="(content\/assets\/[^"]+)"/g, (match, path: string) => {
    const data = files.get(path);
    return data === undefined ? match : `src="${toDataUri(path, data)}"`;
  });
  return out;
}

/**
 * Paper view (WP10, plan §10.20): an A4 "sheet" look for the screen,
 * toggled by the controller via the wdf-paged class. Presentation only —
 * the content flows continuously; true pagination happens in print/PDF.
 */
export const PAGED_CSS = `
  html.wdf-paged body { background: #676d77; padding: 1.5rem 0; }
  html.wdf-paged article {
    background: #fff; width: 210mm; max-width: 210mm; box-sizing: border-box;
    margin: 0 auto; padding: 20mm; min-height: 297mm;
    box-shadow: 0 3px 18px rgba(0, 0, 0, 0.45);
  }
  /* Breathing space at section boundaries, mirroring the print breaks. */
  html.wdf-paged article > h1:not(:first-child),
  html.wdf-paged article > section:not(:first-child) { margin-top: 3.5em; }
  html.wdf-paged article > h2:not(:first-child) { margin-top: 2.4em; }
  html.wdf-paged table, html.wdf-paged figure { margin-top: 1.6em; margin-bottom: 1.6em; }
`;

/** Paged-media sheet for print/PDF export (WP10): the browser paginates. */
export const PRINT_CSS = `
  @page { size: A4; margin: 20mm; }
  body { margin: 0; padding: 0; background: #fff; }
  article { max-width: none; margin: 0; }
  h1, h2, h3, h4, h5, h6 { break-after: avoid; }
  figure, tr { break-inside: avoid; }
  thead { display: table-header-group; }
  /* A top-level section (or its h1) starts on a fresh page, like a Word
     section break. Never the first one: the title stays with page one. */
  article > h1:not(:first-child),
  article > section:not(:first-child) { break-before: page; }
`;

/** Base typography for packages without a stylesheet, plus selection flash. */
export const BASE_CSS = `
  body { margin: 0; padding: 1.25rem; font: 17px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1a1f2b; }
  article { max-width: 42rem; margin: 0 auto; }
  h1 { line-height: 1.25; } h1, h2, h3 { margin: 1.4em 0 0.5em; }
  table { border-collapse: collapse; margin: 1em 0; width: 100%; }
  caption { text-align: left; font-weight: 600; padding: 0.3em 0; }
  th, td { border: 1px solid #d5d9df; padding: 0.4em 0.6em; text-align: left; }
  th { background: #f3f5f8; }
  figure { margin: 1.2em 0; } img { max-width: 100%; height: auto; }
  figcaption { color: #5b6472; font-size: 0.9em; margin-top: 0.4em; }
  blockquote { margin: 1em 0; padding: 0.2em 1em; border-left: 3px solid #c9d2e0; color: #3c4454; }
  pre { background: #f3f5f8; padding: 0.8em 1em; border-radius: 8px; overflow-x: auto; }
  hr { border: none; border-top: 1px solid #d5d9df; margin: 1.6em 0; }
  a { color: #1a56c4; }
  [id] { scroll-margin-top: 1rem; }
  .wdf-flash { outline: 2px solid #1a56c4; outline-offset: 4px; border-radius: 2px; }
`;

/** Controller injected into the sandboxed frame (the only script its CSP allows). */
export const CONTROLLER_JS = `
  document.addEventListener('click', function (e) {
    var target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    var ext = target.closest('a[href^="http"], a[href^="mailto:"]');
    if (ext) {
      e.preventDefault();
      parent.postMessage({ type: 'wdf-link', href: ext.getAttribute('href') }, '*');
      return;
    }
    var el = target.closest('[id]');
    if (el) parent.postMessage({ type: 'wdf-click', id: el.id }, '*');
  });
  addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type === 'wdf-paged') {
      document.documentElement.classList.toggle('wdf-paged', d.on === true);
      return;
    }
    if (d.type === 'wdf-scroll' && typeof d.id === 'string') {
      var t = document.getElementById(d.id);
      if (t) {
        t.scrollIntoView({ behavior: 'smooth', block: 'start' });
        t.classList.add('wdf-flash');
        setTimeout(function () { t.classList.remove('wdf-flash'); }, 1400);
      }
    }
  });
`;

/**
 * The fonts extension's @font-face sheet (WP9, docs/ext-fonts.md) with the
 * packaged woff2 files inlined as data: URIs, or undefined when absent.
 */
export function fontsCss(files: ReadonlyMap<string, Uint8Array>): string | undefined {
  const sheet = files.get('ext/fonts/fonts.css');
  if (sheet === undefined) return undefined;
  return new TextDecoder()
    .decode(sheet)
    .replace(/url\("(ext\/fonts\/[^"]+)"\)/g, (match, path: string) => {
      const bytes = files.get(path);
      return bytes === undefined ? match : `url("${toDataUri(path, bytes)}")`;
    });
}

/**
 * Builds the sandboxed srcdoc: restrictive CSP (only the nonce'd controller
 * may run — the profile already forbids scripts, this is defense in depth),
 * base styles, inlined resources, embedded fonts, controller (spec §11.1).
 */
export function buildSrcdoc(
  entryHtml: string,
  files: ReadonlyMap<string, Uint8Array>,
  nonce: string,
): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; script-src 'nonce-${nonce}'" />`;
  let out = inlineResources(entryHtml, files);
  const fonts = fontsCss(files);
  const fontStyle = fonts === undefined ? '' : `<style>${fonts}</style>`;
  out = out.replace(
    /<head([^>]*)>/,
    (match) => `${match}${csp}<style>${BASE_CSS}</style><style>${PAGED_CSS}</style>${fontStyle}`,
  );
  const controller = `<script nonce="${nonce}">${CONTROLLER_JS}</script>`;
  out = out.includes('</body>') ? out.replace('</body>', `${controller}</body>`) : out + controller;
  return out;
}

/**
 * Builds the print/PDF document (WP10, plan §10.20): inlined resources,
 * base styles, embedded fonts, and the paged-media sheet — no controller,
 * and a CSP with no script-src at all. Rendered in a dedicated frame
 * without allow-scripts; the browser's print engine does the pagination.
 */
export function buildPrintSrcdoc(
  entryHtml: string,
  files: ReadonlyMap<string, Uint8Array>,
): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:" />`;
  const out = inlineResources(entryHtml, files);
  const fonts = fontsCss(files);
  const fontStyle = fonts === undefined ? '' : `<style>${fonts}</style>`;
  return out.replace(
    /<head([^>]*)>/,
    (match) => `${match}${csp}<style>${BASE_CSS}</style>${fontStyle}<style>${PRINT_CSS}</style>`,
  );
}

// ---------------------------------------------------------------------------
// `source` extension (WP13, docs/ext-source.md)

export interface SourceExt {
  main: string;
  mainName: string;
  encoding: string;
  resources: Record<string, string>;
}

/** Reads ext/source/source.json, or undefined when absent or malformed. */
export function parseSourceExt(files: ReadonlyMap<string, Uint8Array>): SourceExt | undefined {
  const raw = files.get('ext/source/source.json');
  if (raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as {
      main?: unknown;
      mainName?: unknown;
      encoding?: unknown;
      resources?: unknown;
    };
    if (typeof parsed.main !== 'string' || !files.has(parsed.main)) return undefined;
    const resources: Record<string, string> = {};
    if (typeof parsed.resources === 'object' && parsed.resources !== null) {
      for (const [k, v] of Object.entries(parsed.resources)) {
        if (typeof v === 'string') resources[k] = v;
      }
    }
    return {
      main: parsed.main,
      mainName: typeof parsed.mainName === 'string' ? parsed.mainName : '',
      encoding: typeof parsed.encoding === 'string' ? parsed.encoding : 'utf-8',
      resources,
    };
  } catch {
    return undefined;
  }
}

/**
 * Builds the srcdoc for the "Original" view: the embedded source decoded
 * with its declared encoding, mapped resources inlined as data: URIs, the
 * same no-network CSP — and deliberately NO injected styling or controller:
 * the point of the view is the untouched original (docs/ext-source.md).
 */
export function buildOriginalSrcdoc(
  files: ReadonlyMap<string, Uint8Array>,
  ext: SourceExt,
): string {
  const bytes = files.get(ext.main) ?? new Uint8Array();
  let html: string;
  try {
    html = new TextDecoder(ext.encoding).decode(bytes);
  } catch {
    html = new TextDecoder().decode(bytes);
  }
  for (const [original, path] of Object.entries(ext.resources)) {
    const data = files.get(path);
    if (data === undefined) continue;
    html = html.split(`src="${original}"`).join(`src="${toDataUri(path, data)}"`);
  }
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'" />`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, (match) => `${match}${csp}`);
  }
  return csp + html;
}

export interface AgentBlock {
  text: string;
  ids: string[];
}

/** Splits ai/content.md into its blocks, each tagged with the anchor ids it carries. */
export function agentBlocks(markdown: string): AgentBlock[] {
  const body = markdown.endsWith('\n') ? markdown.slice(0, -1) : markdown;
  if (body === '') return [];
  return body.split('\n\n').map((text) => ({
    text,
    ids: [...text.matchAll(/\{#([a-z]+-[a-z0-9-]*)\}/g)].map((m) => m[1] ?? ''),
  }));
}

export interface OutlineTreeNode {
  node: WdfOutlineNode;
  children: OutlineTreeNode[];
}

/** Rebuilds the tree from the flat parent-linked outline (spec §7.8). */
export function outlineTree(outline: WdfOutline): OutlineTreeNode[] {
  const byId = new Map<string, OutlineTreeNode>();
  const roots: OutlineTreeNode[] = [];
  for (const node of outline) {
    const treeNode: OutlineTreeNode = { node, children: [] };
    byId.set(node.id, treeNode);
    const parent = node.parent === null ? undefined : byId.get(node.parent);
    if (parent === undefined) roots.push(treeNode);
    else parent.children.push(treeNode);
  }
  return roots;
}

/** Citation URI per spec §7.10. */
export function citation(documentId: string, elementId: string): string {
  return `wdf:${documentId}#${elementId}`;
}
