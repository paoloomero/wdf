import {
  elementChildren,
  findChild,
  getAttr,
  isElement,
  normalizedText,
  textContent,
  type WdfDocument,
  type WdfElement,
  type WdfNode,
} from './html/ast.js';
import { parseHtml } from './html/parse.js';
import type { WdfOutlineNode, WdfOutlineNodeType } from './types.js';

/**
 * Canonical extraction (spec §7): a pure, byte-deterministic function of the
 * entry document. Defined only for profile-valid documents (§7.2); on other
 * input it degrades silently but deterministically. Never let platform,
 * locale, or iteration order leak into the output (spec §7.1.3).
 */
export interface ExtractResult {
  readonly markdown: string;
  readonly outline: WdfOutlineNode[];
}

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

// ---------------------------------------------------------------------------
// Inline serialization (§7.4)

/** Always-escaped characters in text runs (§7.4.1). */
const ESCAPE_RE = /([\\`*_[\]{}<>&|#])/g;

function escapeText(s: string): string {
  return s.replace(ESCAPE_RE, '\\$1');
}

/** Line-start escapes (§7.4.1): `- `, `+ `, `1. `, `1) ` forms. */
function positionalEscape(s: string): string {
  if (/^[-+]( |$)/.test(s)) return `\\${s}`;
  const m = /^(\d+)([.)])( |$)/.exec(s);
  if (m !== null) {
    const digits = m[1] ?? '';
    return `${digits}\\${s.slice(digits.length)}`;
  }
  return s;
}

type Item = { t: 'sp' } | { t: 'br' } | { t: 'chunk'; s: string };

const SP: Item = { t: 'sp' };
const BR: Item = { t: 'br' };
const WS_SPLIT = /([\t\n\f\r ]+)/;

interface InlineOptions {
  /** false in single-line contexts: hard breaks render as spaces (§7.4.2). */
  hardBreaks: boolean;
}

function serializeInline(nodes: readonly WdfNode[], opts: InlineOptions): Item[] {
  const items: Item[] = [];
  for (const node of nodes) {
    if (!isElement(node)) {
      for (const part of node.text.split(WS_SPLIT)) {
        if (part === '') continue;
        items.push(WS_SPLIT.test(part) ? SP : { t: 'chunk', s: escapeText(part) });
      }
      continue;
    }
    items.push(...serializeInlineElement(node, opts));
  }
  return items;
}

/** §7.3.3 — moves outer space items outside the element's delimiters. */
function stripOuter(items: Item[]): { lead: boolean; core: Item[]; trail: boolean } {
  let start = 0;
  let end = items.length;
  while (start < end && items[start]?.t === 'sp') start += 1;
  while (end > start && items[end - 1]?.t === 'sp') end -= 1;
  return { lead: start > 0, core: items.slice(start, end), trail: end < items.length };
}

function wrapped(inner: Item[], open: string, close: string): Item[] {
  const { lead, core, trail } = stripOuter(inner);
  if (core.length === 0) return lead || trail ? [SP] : [];
  const out: Item[] = [];
  if (lead) out.push(SP);
  out.push({ t: 'chunk', s: open }, ...core, { t: 'chunk', s: close });
  if (trail) out.push(SP);
  return out;
}

function serializeCodeSpan(el: WdfElement): Item[] {
  const raw = textContent(el).replace(/[\t\n\f\r ]+/g, ' ');
  const content = raw.replace(/^ | $/g, '');
  const hadOuter = raw !== content;
  if (content === '') return hadOuter ? [SP] : [];
  let longest = 0;
  for (const run of content.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const delim = '`'.repeat(longest + 1);
  const pad = content.startsWith('`') || content.endsWith('`') ? ' ' : '';
  const items: Item[] = [];
  if (hadOuter && raw.startsWith(' ')) items.push(SP);
  items.push({ t: 'chunk', s: `${delim}${pad}${content}${pad}${delim}` });
  if (hadOuter && raw.endsWith(' ')) items.push(SP);
  return items;
}

function serializeImage(el: WdfElement): { t: 'chunk'; s: string } {
  const alt = (getAttr(el, 'alt') ?? '').replace(/[\t\n\f\r ]+/g, ' ').replace(/^ | $/g, '');
  const src = getAttr(el, 'src') ?? '';
  return { t: 'chunk', s: `![${escapeText(alt)}](<${src}>)` };
}

function serializeInlineElement(el: WdfElement, opts: InlineOptions): Item[] {
  switch (el.tag) {
    case 'br':
      return [opts.hardBreaks ? BR : SP];
    case 'em':
    case 'cite':
      return wrapped(serializeInline(el.children, opts), '*', '*');
    case 'strong':
      return wrapped(serializeInline(el.children, opts), '**', '**');
    case 'q':
      return wrapped(serializeInline(el.children, opts), '"', '"');
    case 'a': {
      const href = getAttr(el, 'href') ?? '';
      return wrapped(serializeInline(el.children, opts), '[', `](<${href}>)`);
    }
    case 'code':
      return serializeCodeSpan(el);
    case 'img':
      return [serializeImage(el)];
    default:
      // sub, sup, span, time, abbr — and, defensively, anything unexpected —
      // are transparent: content only (§7.4.2).
      return serializeInline(el.children, opts);
  }
}

/** Renders items into line strings, splitting at hard breaks; spaces adjacent
 * to a break are dropped (§7.4.2, §7.7 no-trailing-whitespace). */
function renderLines(items: Item[]): string[] {
  const lines: string[] = [];
  let out = '';
  let pending = false;
  let started = false;
  const flush = (hardBreak: boolean) => {
    // The backslash is the CommonMark hard-break marker (§7.4.2).
    lines.push(positionalEscape(out) + (hardBreak ? '\\' : ''));
    out = '';
    pending = false;
    started = false;
  };
  for (const item of items) {
    if (item.t === 'sp') {
      if (started) pending = true;
    } else if (item.t === 'br') {
      flush(true);
    } else {
      if (pending) out += ' ';
      out += item.s;
      pending = false;
      started = true;
    }
  }
  flush(false);
  return lines;
}

function renderSingleLine(nodes: readonly WdfNode[]): string {
  const [line] = renderLines(serializeInline(nodes, { hardBreaks: false }));
  return line ?? '';
}

// ---------------------------------------------------------------------------
// Block serialization (§7.5) and anchors (§7.6)

/** A group is a run of lines; groups are joined by one blank line (§7.7). */
type Group = string[];

function appendAnchor(line: string, id: string): string {
  return line === '' ? `{#${id}}` : `${line} {#${id}}`;
}

/** §7.6.3 — a container appends its anchor to the first line of its output. */
function anchorContainer(groups: Group[], id: string | undefined): Group[] {
  if (id === undefined) return groups;
  const first = groups[0]?.[0];
  if (first === undefined) return [[`{#${id}}`]];
  const rest = groups[0]?.slice(1) ?? [];
  return [[appendAnchor(first, id), ...rest], ...groups.slice(1)];
}

function serializeParagraph(el: WdfElement): Group {
  const lines = renderLines(serializeInline(el.children, { hardBreaks: true }));
  const id = getAttr(el, 'id');
  if (id === undefined) return lines;
  const last = lines.length - 1;
  return lines.map((line, i) => (i === last ? appendAnchor(line, id) : line));
}

function serializeHeading(el: WdfElement): Group {
  const level = Number(el.tag.slice(1));
  const text = renderSingleLine(el.children);
  const id = getAttr(el, 'id');
  const line = `${'#'.repeat(level)} ${text}`;
  return [id === undefined ? line : appendAnchor(line, id)];
}

function serializeBlockquote(el: WdfElement): Group[] {
  const inner = elementChildren(el).flatMap((child) => serializeBlock(child, 0));
  const lines: string[] = [];
  inner.forEach((group, i) => {
    if (i > 0) lines.push('>');
    for (const line of group) lines.push(`> ${line}`);
  });
  const groups = lines.length === 0 ? [] : [lines];
  return anchorContainer(groups, getAttr(el, 'id'));
}

function serializeList(el: WdfElement, depth: number): Group {
  const ordered = el.tag === 'ol';
  const lines: string[] = [];
  elementChildren(el).forEach((li, index) => {
    if (li.tag !== 'li') return;
    const marker = ordered ? `${String(index + 1)}. ` : '- ';
    const phrasing = li.children.filter((n) => !isElement(n) || (n.tag !== 'ul' && n.tag !== 'ol'));
    const nested = elementChildren(li).find((c) => c.tag === 'ul' || c.tag === 'ol');
    let text = renderSingleLine(phrasing);
    const id = getAttr(li, 'id');
    if (depth === 0 && id !== undefined) text = appendAnchor(text, id);
    lines.push(`${marker}${text}`.replace(/ $/, ''));
    if (nested !== undefined) {
      const indent = ' '.repeat(marker.length);
      for (const line of serializeList(nested, depth + 1)) lines.push(`${indent}${line}`);
    }
  });
  return lines;
}

function serializeDefinitionList(el: WdfElement): Group[] {
  const groups: Group[] = [];
  for (const child of elementChildren(el)) {
    if (child.tag === 'dt') {
      groups.push([`**${renderSingleLine(child.children)}**`]);
    } else if (child.tag === 'dd') {
      groups.push([renderSingleLine(child.children)]);
    }
  }
  return groups;
}

function serializeFigure(el: WdfElement): Group {
  const lines: string[] = [];
  const img = findChild(el, 'img');
  if (img !== undefined) lines.push(serializeImage(img).s);
  const figcaption = findChild(el, 'figcaption');
  if (figcaption !== undefined) lines.push(renderSingleLine(figcaption.children));
  const id = getAttr(el, 'id');
  if (id === undefined) return lines;
  if (lines.length === 0) return [`{#${id}}`];
  const last = lines.length - 1;
  return lines.map((line, i) => (i === last ? appendAnchor(line, id) : line));
}

function serializePre(el: WdfElement): Group {
  const code = findChild(el, 'code');
  const source = code ?? el;
  let content = textContent(source).replace(/\r\n?/g, '\n');
  if (content.endsWith('\n')) content = content.slice(0, -1);
  let longest = 0;
  for (const run of content.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  const info = /^language-([A-Za-z0-9+-]+)$/.exec(getAttr(code ?? el, 'class') ?? '')?.[1] ?? '';
  return [`${fence}${info}`, ...(content === '' ? [] : content.split('\n')), fence];
}

function serializeTable(el: WdfElement): Group[] {
  const children = elementChildren(el);
  const caption = children.find((c) => c.tag === 'caption');
  const captionLine = caption === undefined ? '' : renderSingleLine(caption.children);
  const id = getAttr(el, 'id');
  const captionGroup: Group = [id === undefined ? captionLine : appendAnchor(captionLine, id)];

  const rows: WdfElement[] = [];
  for (const section of children) {
    if (section.tag === 'thead' || section.tag === 'tbody' || section.tag === 'tfoot') {
      rows.push(...elementChildren(section).filter((r) => r.tag === 'tr'));
    }
  }
  if (rows.length === 0) return [captionGroup];

  const renderRow = (tr: WdfElement): string => {
    const cells = elementChildren(tr).map((cell) => renderSingleLine(cell.children));
    return `| ${cells.join(' | ')} |`;
  };
  const width = elementChildren(rows[0] as WdfElement).length;
  const delimiter = `| ${Array.from({ length: width }, () => '---').join(' | ')} |`;
  const [head, ...body] = rows.map(renderRow);
  return [captionGroup, [head ?? '', delimiter, ...body]];
}

function serializeBlock(el: WdfElement, listDepth: number): Group[] {
  switch (el.tag) {
    case 'section':
      return anchorContainer(
        elementChildren(el).flatMap((c) => serializeBlock(c, listDepth)),
        getAttr(el, 'id'),
      );
    case 'header':
    case 'footer':
    case 'nav':
      return elementChildren(el).flatMap((c) => serializeBlock(c, listDepth));
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return [serializeHeading(el)];
    case 'p':
      return [serializeParagraph(el)];
    case 'blockquote':
      return serializeBlockquote(el);
    case 'ul':
    case 'ol':
      return [serializeList(el, listDepth)];
    case 'dl':
      return serializeDefinitionList(el);
    case 'figure':
      return [serializeFigure(el)];
    case 'pre':
      return [serializePre(el)];
    case 'table':
      return serializeTable(el);
    case 'hr':
      return [['---']];
    default:
      // Not a block of the profile: contributes nothing, deterministically.
      return [];
  }
}

// ---------------------------------------------------------------------------
// Outline (§7.8)

function firstHeadingText(section: WdfElement): string | undefined {
  const find = (el: WdfElement): WdfElement | undefined => {
    for (const child of elementChildren(el)) {
      if (HEADINGS.has(child.tag)) return child;
      if (child.tag === 'section') continue;
      const deep = find(child);
      if (deep !== undefined) return deep;
    }
    return undefined;
  };
  const heading = find(section);
  if (heading === undefined) return undefined;
  const text = normalizedText(heading);
  return text === '' ? undefined : text;
}

function outlineType(tag: string): WdfOutlineNodeType | undefined {
  if (tag === 'section') return 'section';
  if (HEADINGS.has(tag)) return 'heading';
  if (tag === 'p') return 'paragraph';
  if (tag === 'table') return 'table';
  if (tag === 'figure') return 'figure';
  if (tag === 'blockquote') return 'blockquote';
  return undefined;
}

function nodeTitle(el: WdfElement, type: WdfOutlineNodeType): string | undefined {
  let text: string | undefined;
  if (type === 'heading') text = normalizedText(el);
  else if (type === 'section') return firstHeadingText(el);
  else if (type === 'table') {
    const caption = findChild(el, 'caption');
    text = caption === undefined ? undefined : normalizedText(caption);
  } else if (type === 'figure') {
    const figcaption = findChild(el, 'figcaption');
    text = figcaption === undefined ? undefined : normalizedText(figcaption);
  } else {
    return undefined;
  }
  return text === '' ? undefined : text;
}

function buildOutline(article: WdfElement): WdfOutlineNode[] {
  const nodes: WdfOutlineNode[] = [];

  const walk = (el: WdfElement, parent: string | null, listDepth: number): void => {
    for (const child of elementChildren(el)) {
      const depth = child.tag === 'ul' || child.tag === 'ol' ? listDepth + 1 : listDepth;
      const type =
        child.tag === 'li' && listDepth === 1 ? ('list-item' as const) : outlineType(child.tag);
      const id = getAttr(child, 'id');

      let nextParent = parent;
      if (type !== undefined && id !== undefined) {
        // Field order is normative (§7.8): id, type, level, title, parent.
        const ordered: Record<string, unknown> = { id, type };
        if (type === 'heading') ordered['level'] = Number(child.tag.slice(1));
        const title = nodeTitle(child, type);
        if (title !== undefined) ordered['title'] = title;
        ordered['parent'] = parent;
        nodes.push(ordered as unknown as WdfOutlineNode);
        nextParent = id;
      }
      walk(child, nextParent, depth);
    }
  };

  walk(article, null, 0);
  return nodes;
}

// ---------------------------------------------------------------------------
// Entry points

/** Canonical JSON serialization of an outline (§7.9). */
export function serializeOutline(outline: readonly WdfOutlineNode[]): string {
  return `${JSON.stringify(outline, null, 2)}\n`;
}

/**
 * The canonical extraction algorithm (spec §7.2–§7.8). Accepts raw HTML
 * (parsed with parse5) or a document from either parser adapter; output is
 * byte-identical across adapters and platforms.
 */
export function extract(input: string | WdfDocument): ExtractResult {
  const doc = typeof input === 'string' ? parseHtml(input) : input;
  const body = doc.html === null ? undefined : findChild(doc.html, 'body');
  const article = body === undefined ? undefined : findChild(body, 'article');
  if (article === undefined) {
    return { markdown: '\n', outline: [] };
  }
  const groups = elementChildren(article).flatMap((el) => serializeBlock(el, 0));
  const markdown = `${groups.map((g) => g.join('\n')).join('\n\n')}\n`;
  return { markdown, outline: buildOutline(article) };
}
