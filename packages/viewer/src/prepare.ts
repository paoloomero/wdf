import type { WdfOutline, WdfOutlineNode } from '@wdf/core';

/** Pure helpers of the viewer — kept DOM-free so they are unit-testable. */

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  webp: 'image/webp',
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
 * Builds the sandboxed srcdoc: restrictive CSP (only the nonce'd controller
 * may run — the profile already forbids scripts, this is defense in depth),
 * base styles, inlined resources, controller (spec §11.1).
 */
export function buildSrcdoc(
  entryHtml: string,
  files: ReadonlyMap<string, Uint8Array>,
  nonce: string,
): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'" />`;
  let out = inlineResources(entryHtml, files);
  out = out.replace(/<head([^>]*)>/, (match) => `${match}${csp}<style>${BASE_CSS}</style>`);
  const controller = `<script nonce="${nonce}">${CONTROLLER_JS}</script>`;
  out = out.includes('</body>') ? out.replace('</body>', `${controller}</body>`) : out + controller;
  return out;
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
