import {
  computeTableGrid,
  elementChildren,
  findChild,
  getAttr,
  isElement,
  normalizedText,
  parseHtml,
  parseSpan,
  type SpanCell,
  type WdfElement,
  type WdfNode,
} from '@wdf/core';

import { el, isEl, textOf, type MEl, type MNode } from './ast.js';
import {
  DEFAULT_CAPS,
  resolveDocumentAssets,
  type AssetCaps,
  type AssetLoader,
  type LoadedAsset,
} from './assets.js';
import { decodeHtml } from './encoding.js';
import { promoteHeadings } from './headings.js';
import {
  findFileListDir,
  isPageResidue,
  preprocessHeaderHtml,
  selectPageParts,
} from './pageheader.js';
import { collectStyleRules, hoistStyles, StyleResolver, STYLE_TMP_ATTR } from './styles.js';

/**
 * Best-effort HTML → WDF-HTML conversion (plan T3.4): keep what the profile
 * allows, unwrap generic containers, drop what cannot be expressed, and
 * report every drop. The output then goes through ensureIds and the
 * canonical serializer.
 */

const DROP = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'object',
  'embed',
  'video',
  'audio',
  'canvas',
  'svg',
  'math',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'label',
  'head',
  'title',
  'meta',
  'link',
  'base',
]);
const RENAME: Record<string, string> = {
  b: 'strong',
  i: 'em',
  dfn: 'em',
  var: 'code',
  kbd: 'code',
  samp: 'code',
  font: 'span',
};

// Active during one importHtml run (imports are single-shot).
let resolver: StyleResolver | undefined;
// original img src → resolved content/assets/ path (T7.3).
let assetMap: Map<string, string> | undefined;

/** Resolved package path for an img src, or undefined if not packageable. */
function resolveImgSrc(src: string): string | undefined {
  const mapped = assetMap?.get(src);
  if (mapped !== undefined) return mapped;
  return IMG_SRC_OK.test(src) ? src : undefined;
}
const INLINE = new Set([
  'a',
  'em',
  'strong',
  'code',
  'sub',
  'sup',
  'time',
  'cite',
  'q',
  'abbr',
  'span',
  'br',
]);
const BLOCKS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'blockquote',
  'figure',
  'pre',
  'hr',
  'ul',
  'ol',
  'dl',
  'table',
]);
const SECTIONING = new Set(['section', 'header', 'footer', 'nav']);
const HREF_OK = /^(https?:\/\/[^\s<>]+|mailto:[^\s<>]+|#.+)$/;
const IMG_SRC_OK = /^content\/assets(\/[A-Za-z0-9][A-Za-z0-9._-]*)+$/;
const GLOBAL_ATTRS = ['id', 'class', 'lang', 'dir'];
const EXTRA_ATTRS: Record<string, string[]> = {
  a: ['href'],
  img: ['src', 'alt', 'width', 'height'],
  time: ['datetime'],
  abbr: ['title'],
  blockquote: ['cite'],
  th: ['scope'],
  table: ['data-wdf-dataset'],
};

function pickAttrs(node: WdfElement, tag: string): Record<string, string> {
  const allowed = new Set([...GLOBAL_ATTRS, ...(EXTRA_ATTRS[tag] ?? [])]);
  const attrs: Record<string, string> = {};
  for (const { name, value } of node.attrs) {
    if (allowed.has(name)) attrs[name] = value;
  }
  // T7.2 style translation: carry the resolved style signature until hoisting.
  const signature = resolver?.resolve(node);
  if (signature !== undefined) attrs[STYLE_TMP_ATTR] = signature;
  return attrs;
}

function phrasing(nodes: readonly WdfNode[], report: string[], inP: boolean): MNode[] {
  const out: MNode[] = [];
  for (const node of nodes) {
    if (!isElement(node)) {
      out.push(node.text);
      continue;
    }
    const tag = RENAME[node.tag] ?? node.tag;
    if (DROP.has(tag)) {
      report.push(`dropped <${node.tag}> (not representable in WDF-HTML)`);
      continue;
    }
    if (tag === 'img') {
      const src = getAttr(node, 'src') ?? '';
      const resolved = inP ? resolveImgSrc(src) : undefined;
      if (resolved !== undefined) {
        const attrs = pickAttrs(node, 'img');
        attrs['src'] = resolved;
        attrs['alt'] = attrs['alt'] ?? '';
        out.push(el('img', attrs));
      } else if (!inP) {
        report.push(`dropped <img src="${src}"> (not inside a paragraph or figure)`);
      }
      continue;
    }
    if (tag === 'br') {
      out.push(el('br'));
      continue;
    }
    // Word's full "Web Page" export carries images as VML <v:imagedata>, not
    // <img>; treat the src the same way so those images survive (T7.4).
    if (tag === 'v:imagedata') {
      const src = getAttr(node, 'src') ?? '';
      const resolved = inP ? resolveImgSrc(src) : undefined;
      if (resolved !== undefined) {
        out.push(el('img', { src: resolved, alt: getAttr(node, 'o:title') ?? '' }));
      }
      continue;
    }
    if (INLINE.has(tag)) {
      if (tag === 'a') {
        const href = getAttr(node, 'href') ?? '';
        if (!HREF_OK.test(href)) {
          report.push(`unwrapped <a href="${href}"> (scheme not permitted)`);
          out.push(...phrasing(node.children, report, inP));
          continue;
        }
      }
      out.push(el(tag, pickAttrs(node, tag), phrasing(node.children, report, inP)));
      continue;
    }
    // Block or unknown element in phrasing position: unwrap its content.
    out.push(...phrasing(node.children, report, inP));
  }
  return out;
}

function rebuildTable(node: WdfElement, report: string[]): MEl | undefined {
  const rows: WdfElement[] = [];
  const collectRows = (elm: WdfElement): void => {
    for (const child of elementChildren(elm)) {
      if (child.tag === 'tr') rows.push(child);
      else collectRows(child);
    }
  };
  collectRows(node);
  if (rows.length === 0) {
    report.push('dropped <table> with no rows');
    return undefined;
  }

  const captionSrc = elementChildren(node).find((c) => c.tag === 'caption');
  const captionText = captionSrc === undefined ? '' : normalizedText(captionSrc);
  if (captionSrc === undefined) report.push('synthesized empty <caption> for a table');

  // Merged cells survive when the grid is exactly rectangular (§6.2.8);
  // otherwise every span is stripped and rows are padded as before (T11.3).
  const spanOf = (cell: WdfElement, name: 'colspan' | 'rowspan'): number => {
    const n = parseSpan(getAttr(cell, name));
    return n >= 2 ? n : 1;
  };
  const spanCells = (tr: WdfElement): SpanCell[] =>
    elementChildren(tr).map((cell) => ({
      colspan: spanOf(cell, 'colspan'),
      rowspan: spanOf(cell, 'rowspan'),
    }));
  const [firstRow, ...restRows] = rows;
  const spanGroups = [[spanCells(firstRow as WdfElement)], restRows.map(spanCells)];
  const spansPresent = spanGroups.flat(2).some((s) => s.colspan > 1 || s.rowspan > 1);
  const keepSpans = spansPresent && computeTableGrid(spanGroups).problems.length === 0;
  if (spansPresent) {
    report.push(
      keepSpans
        ? 'kept merged cells (colspan/rowspan)'
        : 'dropped colspan/rowspan (table grid could not be reconciled)',
    );
  }

  const width = Math.max(...rows.map((r) => elementChildren(r).length));
  const cellsOf = (tr: WdfElement, cellTag: 'th' | 'td'): MEl[] => {
    const cells = elementChildren(tr).map((cell) => {
      // Inline images are permitted in cells (§6.2.9, WP12); br is not (§6.2.8).
      const content = phrasing(cell.children, report, true).filter(
        (n) => !(isEl(n) && n.tag === 'br'),
      );
      const attrs = pickAttrs(cell, cellTag);
      if (keepSpans) {
        for (const name of ['colspan', 'rowspan'] as const) {
          const n = spanOf(cell, name);
          if (n > 1) attrs[name] = String(n);
        }
      }
      return el(cellTag, attrs, content);
    });
    if (!keepSpans) {
      while (cells.length < width) cells.push(el(cellTag));
    }
    return cells;
  };

  const tableAttrs = pickAttrs(node, 'table');
  if (tableAttrs['data-wdf-dataset'] !== undefined) {
    report.push(
      `dropped data-wdf-dataset="${tableAttrs['data-wdf-dataset']}" (import does not carry dataset files)`,
    );
    delete tableAttrs['data-wdf-dataset'];
  }
  const [headRow, ...bodyRows] = rows;
  const table = el('table', tableAttrs, [
    el('caption', {}, captionText === '' ? [] : [captionText]),
    el('thead', {}, [el('tr', {}, cellsOf(headRow as WdfElement, 'th'))]),
    el(
      'tbody',
      {},
      bodyRows.map((r) => el('tr', {}, cellsOf(r, 'td'))),
    ),
  ]);
  if (bodyRows.length === 0) {
    report.push('table had a single row: kept as header with empty body');
  }
  return table;
}

function blockOf(node: WdfElement, report: string[]): MNode[] {
  const tag = RENAME[node.tag] ?? node.tag;
  if (DROP.has(tag)) {
    report.push(`dropped <${node.tag}> (not representable in WDF-HTML)`);
    return [];
  }
  switch (tag) {
    case 'section':
    case 'header':
    case 'footer':
    case 'nav':
      return [el(tag, pickAttrs(node, tag), toBlocks(node.children, report))];
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return [el(tag, pickAttrs(node, tag), phrasing(node.children, report, false))];
    case 'p': {
      // Word marks the document title as a styled paragraph, not a heading.
      if (/\bMsoTitle\b/.test(getAttr(node, 'class') ?? '')) {
        report.push('mapped Word MsoTitle paragraph to <h1>');
        return [el('h1', pickAttrs(node, 'h1'), phrasing(node.children, report, false))];
      }
      return [el('p', pickAttrs(node, 'p'), phrasing(node.children, report, true))];
    }
    case 'blockquote': {
      const inner = toBlocks(node.children, report);
      const ps = inner.filter((b) => b.tag === 'p');
      for (const other of inner.filter((b) => b.tag !== 'p')) {
        report.push(`dropped <${other.tag}> inside blockquote (only paragraphs allowed)`);
      }
      if (ps.length === 0) return [];
      return [el('blockquote', pickAttrs(node, 'blockquote'), ps)];
    }
    case 'ul':
    case 'ol':
      return [rebuildList(node, report)];
    case 'dl': {
      const items = elementChildren(node)
        .filter((c) => c.tag === 'dt' || c.tag === 'dd')
        .map((c) => el(c.tag, {}, phrasing(c.children, report, false)));
      return items.length === 0 ? [] : [el('dl', pickAttrs(node, 'dl'), items)];
    }
    case 'figure': {
      const img = elementChildren(node).find((c) => c.tag === 'img');
      const src = img === undefined ? '' : (getAttr(img, 'src') ?? '');
      const resolved = img === undefined ? undefined : resolveImgSrc(src);
      if (img === undefined || resolved === undefined) {
        report.push('unwrapped <figure> without a packageable image');
        return toBlocks(
          node.children.filter((c) => !isElement(c) || c.tag !== 'img'),
          report,
        );
      }
      const attrs = pickAttrs(img, 'img');
      attrs['src'] = resolved;
      attrs['alt'] = attrs['alt'] ?? '';
      const children: MNode[] = [el('img', attrs)];
      const figcaption = elementChildren(node).find((c) => c.tag === 'figcaption');
      if (figcaption !== undefined) {
        children.push(el('figcaption', {}, phrasing(figcaption.children, report, false)));
      }
      return [el('figure', pickAttrs(node, 'figure'), children)];
    }
    case 'pre': {
      const code = elementChildren(node).find((c) => c.tag === 'code');
      const text = textContentOf(code ?? node);
      const language = /language-[A-Za-z0-9+-]+/.exec(
        code === undefined ? '' : (getAttr(code, 'class') ?? ''),
      )?.[0];
      const codeEl = el('code', language === undefined ? {} : { class: language }, [text]);
      return [el('pre', pickAttrs(node, 'pre'), [codeEl])];
    }
    case 'table': {
      const table = rebuildTable(node, report);
      return table === undefined ? [] : [table];
    }
    case 'hr':
      return [el('hr')];
    case 'img':
    case 'br':
      // img at block level: promote into a figure so it survives (§6.2.9).
      if (tag === 'img') {
        const src = getAttr(node, 'src') ?? '';
        const resolved = resolveImgSrc(src);
        if (resolved !== undefined) {
          const attrs = pickAttrs(node, 'img');
          attrs['src'] = resolved;
          attrs['alt'] = attrs['alt'] ?? '';
          report.push('wrapped a top-level <img> in <figure>');
          return [el('figure', {}, [el('img', attrs)])];
        }
      }
      return [];
    default:
      if (INLINE.has(tag)) return phrasing([node], report, false);
      // div, main, aside, unknown containers: unwrap.
      return toBlocksNodes(node.children, report);
  }
}

function rebuildList(node: WdfElement, report: string[]): MEl {
  const items: MEl[] = [];
  for (const li of elementChildren(node)) {
    if (li.tag !== 'li') {
      report.push(`dropped <${li.tag}> inside a list`);
      continue;
    }
    const nestedSrc = elementChildren(li).filter((c) => c.tag === 'ul' || c.tag === 'ol');
    const inlineSrc = li.children.filter(
      (c) => !isElement(c) || (c.tag !== 'ul' && c.tag !== 'ol'),
    );
    const children: MNode[] = phrasing(inlineSrc, report, false);
    if (nestedSrc.length > 0) {
      children.push(rebuildList(nestedSrc[0] as WdfElement, report));
      if (nestedSrc.length > 1) report.push('merged multiple nested lists into one');
    }
    items.push(el('li', pickAttrs(li, 'li'), children));
  }
  return el(node.tag, pickAttrs(node, node.tag), items);
}

function textContentOf(node: WdfNode): string {
  return isElement(node) ? node.children.map(textContentOf).join('') : node.text;
}

/** Groups a mixed node list into WDF-HTML blocks, wrapping stray phrasing runs in <p>. */
function toBlocksNodes(nodes: readonly WdfNode[], report: string[]): MEl[] {
  const blocks: MEl[] = [];
  let run: MNode[] = [];
  const flushRun = (): void => {
    const meaningful = run.some((n) => (isEl(n) ? true : n.trim() !== ''));
    if (meaningful) blocks.push(el('p', {}, run));
    run = [];
  };
  for (const node of nodes) {
    if (!isElement(node)) {
      if (node.text.trim() !== '' || run.length > 0) run.push(node.text);
      continue;
    }
    const tag = RENAME[node.tag] ?? node.tag;
    if (INLINE.has(tag) || tag === 'img') {
      run.push(...phrasing([node], report, true));
      continue;
    }
    flushRun();
    const produced = blockOf(node, report);
    for (const b of produced) {
      if (isEl(b) && (BLOCKS.has(b.tag) || SECTIONING.has(b.tag))) blocks.push(b);
      else run.push(b);
    }
  }
  flushRun();
  return blocks;
}

function toBlocks(nodes: readonly WdfNode[], report: string[]): MEl[] {
  return toBlocksNodes(nodes, report);
}

const PRUNE_CONTAINERS = new Set(['section', 'header', 'footer', 'nav']);

/**
 * Drops Word's spacer paragraphs (content reduced to whitespace/&nbsp;/br,
 * typically emitted as `<p class=MsoNormal><o:p>&nbsp;</o:p></p>`), and
 * blockquotes left empty by the pruning. Returns how many were removed.
 */
function hasImg(node: MEl): boolean {
  return node.children.some((c) => isEl(c) && (c.tag === 'img' || hasImg(c)));
}

function pruneSpacerParagraphs(blocks: MEl[]): { blocks: MEl[]; removed: number } {
  let removed = 0;
  // A spacer is an empty paragraph with no image anywhere in it - Word nests
  // images inside spans, so the check looks through the whole subtree.
  const isSpacer = (b: MEl): boolean =>
    b.tag === 'p' && textOf(b).replace(/[\s ]/g, '') === '' && !hasImg(b);

  const walk = (list: MEl[]): MEl[] =>
    list
      .map((block): MEl | undefined => {
        if (isSpacer(block)) {
          removed += 1;
          return undefined;
        }
        if (PRUNE_CONTAINERS.has(block.tag) || block.tag === 'blockquote') {
          const inner = walk(block.children.filter(isEl));
          const text = block.children.filter((c) => !isEl(c));
          block.children = [...text, ...inner];
          const dropWhenEmpty =
            block.tag === 'blockquote' ||
            block.tag === 'header' ||
            block.tag === 'footer' ||
            block.tag === 'nav';
          if (dropWhenEmpty && inner.length === 0) {
            removed += 1;
            return undefined;
          }
        }
        return block;
      })
      .filter((b): b is MEl => b !== undefined);

  const pruned = walk(blocks);
  return { blocks: pruned, removed };
}

export interface HtmlImportResult {
  blocks: MEl[];
  title: string | undefined;
  language: string | undefined;
  /** Generated content/styles.css (T7.2), when the source carries style. */
  stylesheet: string | undefined;
  /** Images pulled into content/assets/ (T7.3). */
  assets: LoadedAsset[];
  /** Original `src` value → package path, for the `source` extension (WP13). */
  sourceMap: Record<string, string>;
  report: string[];
}

export interface HtmlImportOptions {
  /** When present, referenced images are resolved and packaged (T7.3). */
  loadAsset?: AssetLoader;
  caps?: AssetCaps;
  /** Keep assets even when the canonical document drops them (WP13). */
  keepAllAssets?: boolean;
  /**
   * Loads a file from the input's directory (Word support folders), for
   * the page header/footer import (T14.1). Undefined = not available.
   */
  loadSibling?: (relPath: string) => Promise<Uint8Array | undefined>;
}

/** Package paths of every content/assets/ image still referenced by blocks. */
function usedAssetPaths(blocks: MEl[]): Set<string> {
  const used = new Set<string>();
  const walk = (node: MEl): void => {
    if (node.tag === 'img') {
      const src = node.attrs['src'];
      if (src !== undefined && src.startsWith('content/assets/')) used.add(src);
    }
    for (const child of node.children) if (isEl(child)) walk(child);
  };
  for (const block of blocks) walk(block);
  return used;
}

export async function importHtml(
  html: string,
  options: HtmlImportOptions = {},
): Promise<HtmlImportResult> {
  const report: string[] = [];
  const doc = parseHtml(html);
  const root = doc.html;

  // T14.1 — the Word support folder may carry page headers/footers.
  let headerRoot: WdfElement | null = null;
  let fldDir: string | undefined;
  if (root !== null && options.loadSibling !== undefined) {
    fldDir = findFileListDir(root);
    if (fldDir !== undefined) {
      for (const name of ['header.html', 'header.htm']) {
        const bytes = await options.loadSibling(`${fldDir}/${name}`);
        if (bytes !== undefined) {
          headerRoot = parseHtml(preprocessHeaderHtml(decodeHtml(bytes).text)).html;
          break;
        }
      }
    }
  }

  let assets: LoadedAsset[] = [];
  let sourceMap: Record<string, string> = {};
  if (root !== null && options.loadAsset !== undefined) {
    const resolved = await resolveDocumentAssets(
      root,
      options.loadAsset,
      options.caps ?? DEFAULT_CAPS,
      report,
    );
    assetMap = resolved.map;
    assets = resolved.assets;
    sourceMap = Object.fromEntries(
      [...resolved.map.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
    );
    // Header/footer images live in the support folder and are referenced
    // relative to it: resolve them through a prefixed loader.
    if (headerRoot !== null && fldDir !== undefined) {
      const loadAsset = options.loadAsset;
      const dir = fldDir;
      const resolvedHeader = await resolveDocumentAssets(
        headerRoot,
        (src) => loadAsset(`${dir}/${src}`),
        options.caps ?? DEFAULT_CAPS,
        report,
      );
      for (const [key, value] of resolvedHeader.map) assetMap.set(key, value);
      for (const asset of resolvedHeader.assets) {
        if (!assets.some((a) => a.path === asset.path)) assets.push(asset);
      }
    }
  } else {
    assetMap = undefined;
  }

  resolver =
    root === null
      ? undefined
      : new StyleResolver([
          ...collectStyleRules(root),
          ...(headerRoot === null ? [] : collectStyleRules(headerRoot)),
        ]);
  const body = root === null ? undefined : findChild(root, 'body');
  const article = body === undefined ? undefined : findChild(body, 'article');
  const source = article ?? body;
  const raw = source === undefined ? [] : toBlocks(source.children, report);

  // T14.1 — page header/footer content enters the document once, as the
  // article's <header> and <footer>; page-counter residue is dropped.
  let withPage = raw;
  if (headerRoot !== null) {
    let residue = 0;
    const parts = selectPageParts(headerRoot);
    const convertPart = (
      part: WdfElement | undefined,
      tag: 'header' | 'footer',
    ): MEl | undefined => {
      if (part === undefined) return undefined;
      const inner = toBlocks(part.children, report).filter((block) => {
        if (block.tag !== 'p') return true;
        const text = textOf(block).replace(/\s+/g, ' ').trim();
        if (text === '' || !isPageResidue(text) || hasImg(block)) return true;
        residue += 1;
        return false;
      });
      return inner.length === 0 ? undefined : el(tag, {}, inner);
    };
    const pageHeader = convertPart(parts.header, 'header');
    const pageFooter = convertPart(parts.footer, 'footer');
    if (pageHeader !== undefined) {
      withPage = [pageHeader, ...withPage];
      report.push('imported the Word page header as <header> (T14.1)');
    }
    if (pageFooter !== undefined) {
      withPage = [...withPage, pageFooter];
      report.push('imported the Word page footer as <footer> (T14.1)');
    }
    if (residue > 0) {
      report.push(`dropped ${String(residue)} page-number paragraph(s) (page-agnostic format)`);
    }
  }

  resolver = undefined;
  assetMap = undefined;
  const { blocks, removed } = pruneSpacerParagraphs(withPage);
  if (removed > 0) {
    report.push(`dropped ${String(removed)} empty spacer paragraph(s)`);
  }
  // T7.7: styled title paragraphs become headings while style signatures
  // are still attached (the heuristic reads resolved font sizes).
  promoteHeadings(blocks, report);
  // Drop assets whose images did not survive the profile — unless the
  // source extension needs them all for the original view (WP13).
  if (options.keepAllAssets !== true) {
    const used = usedAssetPaths(blocks);
    assets = assets.filter((a) => used.has(a.path));
  }

  const stylesheet = hoistStyles(blocks);
  if (stylesheet !== undefined) {
    report.push('translated source styling into a generated content/styles.css');
  }

  const head = root === null ? undefined : findChild(root, 'head');
  if (
    head !== undefined &&
    elementChildren(head).some(
      (c) => c.tag === 'link' && (getAttr(c, 'rel') ?? '').toLowerCase().includes('stylesheet'),
    )
  ) {
    report.push('external stylesheet not imported (site CSS is dropped; inline styles translated)');
  }

  const titleEl = head === undefined ? undefined : findChild(head, 'title');
  const title = titleEl === undefined ? undefined : normalizedText(titleEl) || undefined;
  const language = root === null ? undefined : (getAttr(root, 'lang') ?? undefined);
  return { blocks, title, language, stylesheet, assets, sourceMap, report };
}
