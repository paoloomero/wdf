/** Mutable document tree used by the importers, then serialized to WDF-HTML. */

export interface MEl {
  tag: string;
  attrs: Record<string, string>;
  children: MNode[];
}
export type MNode = MEl | string;

export function el(tag: string, attrs: Record<string, string> = {}, children: MNode[] = []): MEl {
  return { tag, attrs, children };
}

export function isEl(node: MNode): node is MEl {
  return typeof node !== 'string';
}

export function textOf(node: MNode): string {
  return isEl(node) ? node.children.map(textOf).join('') : node;
}

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const ID_PATTERN = /^[a-z]+-[a-z0-9][a-z0-9-]*$/;

/** ASCII slug for heading/section ids (import-time convenience, spec §6.4.3). */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

/**
 * Assigns mandatory ids to citable elements (spec §6.4.1): slugs for
 * headings/sections, zero-padded counters for the rest. Existing conforming
 * ids are kept; malformed or duplicate ones are replaced (and reported).
 */
export function ensureIds(blocks: MEl[], report: string[]): void {
  const used = new Set<string>();
  const counters = { p: 0, li: 0, tbl: 0, fig: 0, bq: 0, sec: 0, h: 0 };

  const claim = (candidate: string): string => {
    let id = candidate;
    let n = 2;
    while (used.has(id)) id = `${candidate}-${String(n++)}`;
    used.add(id);
    return id;
  };

  const keepOrDrop = (node: MEl): void => {
    const existing = node.attrs['id'];
    if (existing === undefined) return;
    if (ID_PATTERN.test(existing) && !used.has(existing)) {
      used.add(existing);
    } else {
      delete node.attrs['id'];
      report.push(`replaced non-conforming or duplicate id "${existing}" on <${node.tag}>`);
    }
  };

  const preScan = (nodes: MNode[]): void => {
    for (const node of nodes) {
      if (!isEl(node)) continue;
      keepOrDrop(node);
      preScan(node.children);
    }
  };
  preScan(blocks);

  const padded = (n: number): string => String(n).padStart(4, '0');

  const assign = (node: MEl, listDepth: number): void => {
    const citable =
      node.tag === 'section' ||
      HEADINGS.has(node.tag) ||
      node.tag === 'p' ||
      node.tag === 'table' ||
      node.tag === 'figure' ||
      node.tag === 'blockquote' ||
      (node.tag === 'li' && listDepth === 1);
    if (citable && node.attrs['id'] === undefined) {
      if (HEADINGS.has(node.tag)) {
        const slug = slugify(textOf(node));
        node.attrs['id'] = claim(slug === '' ? `h-${String(++counters.h)}` : `h-${slug}`);
      } else if (node.tag === 'section') {
        node.attrs['id'] = claim(`sec-${String(++counters.sec)}`);
      } else if (node.tag === 'p') {
        node.attrs['id'] = claim(`p-${padded(++counters.p)}`);
      } else if (node.tag === 'li') {
        node.attrs['id'] = claim(`li-${padded(++counters.li)}`);
      } else if (node.tag === 'table') {
        node.attrs['id'] = claim(`tbl-${String(++counters.tbl)}`);
      } else if (node.tag === 'figure') {
        node.attrs['id'] = claim(`fig-${String(++counters.fig)}`);
      } else {
        node.attrs['id'] = claim(`bq-${String(++counters.bq)}`);
      }
    }
    const nextDepth = node.tag === 'ul' || node.tag === 'ol' ? listDepth + 1 : listDepth;
    for (const child of node.children) {
      if (isEl(child)) assign(child, nextDepth);
    }
  };
  for (const block of blocks) assign(block, 0);
}

/** Collects every id present in the tree. */
export function collectIds(blocks: MEl[]): Set<string> {
  const ids = new Set<string>();
  const walk = (nodes: MNode[]): void => {
    for (const node of nodes) {
      if (!isEl(node)) continue;
      const id = node.attrs['id'];
      if (id !== undefined) ids.add(id);
      walk(node.children);
    }
  };
  walk(blocks);
  return ids;
}

/** Unwraps internal links whose fragment target does not exist (§6.3.2). */
export function fixDanglingFragments(blocks: MEl[], report: string[]): void {
  const ids = collectIds(blocks);
  const walk = (node: MEl): void => {
    node.children = node.children.flatMap((child): MNode[] => {
      if (!isEl(child)) return [child];
      walk(child);
      const href = child.attrs['href'];
      if (
        child.tag === 'a' &&
        href !== undefined &&
        href.startsWith('#') &&
        !ids.has(href.slice(1))
      ) {
        report.push(`unwrapped link to missing fragment "${href}"`);
        return child.children;
      }
      return [child];
    });
  };
  for (const block of blocks) walk(block);
}

// ---------------------------------------------------------------------------
// Serialization to WDF-HTML

const VOID = new Set(['meta', 'link', 'img', 'br', 'hr']);
const LEAF_LINE = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'dt',
  'dd',
  'figcaption',
  'caption',
  'th',
  'td',
  'title',
]);

function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s: string): string {
  return escText(s).replace(/"/g, '&quot;');
}

function openTag(node: MEl): string {
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => ` ${k}="${escAttr(v)}"`)
    .join('');
  return `<${node.tag}${attrs}>`;
}

function serializeInlineChildren(node: MEl): string {
  return node.children
    .map((child) =>
      isEl(child)
        ? VOID.has(child.tag)
          ? openTag(child).replace(/>$/, ' />')
          : `${openTag(child)}${serializeInlineChildren(child)}</${child.tag}>`
        : escText(child),
    )
    .join('');
}

export function serializeNode(node: MEl, indent: string): string {
  if (node.tag === 'pre') {
    // No added whitespace: pre content is significant (spec §7.5.8).
    return `${indent}${openTag(node)}${serializeInlineChildren(node)}</${node.tag}>`;
  }
  if (VOID.has(node.tag)) {
    return `${indent}${openTag(node).replace(/>$/, ' />')}`;
  }
  if (LEAF_LINE.has(node.tag) || node.children.every((c) => !isEl(c))) {
    return `${indent}${openTag(node)}${serializeInlineChildren(node)}</${node.tag}>`;
  }
  if (node.tag === 'li') {
    const inlinePart = node.children.filter((c) => !isEl(c) || (c.tag !== 'ul' && c.tag !== 'ol'));
    const lists = node.children.filter(
      (c) => isEl(c) && (c.tag === 'ul' || c.tag === 'ol'),
    ) as MEl[];
    const text = serializeInlineChildren(el('x', {}, inlinePart));
    if (lists.length === 0) return `${indent}${openTag(node)}${text}</li>`;
    const nested = lists.map((l) => serializeNode(l, `${indent}  `)).join('\n');
    return `${indent}${openTag(node)}${text}\n${nested}\n${indent}</li>`;
  }
  const children = node.children
    .filter((c) => isEl(c) || c.trim() !== '')
    .map((c) => (isEl(c) ? serializeNode(c, `${indent}  `) : `${indent}  ${escText(c.trim())}`))
    .join('\n');
  return `${indent}${openTag(node)}\n${children}\n${indent}</${node.tag}>`;
}

/** Serializes a complete WDF-HTML entry document. */
export function serializeDocument(
  lang: string,
  title: string,
  blocks: MEl[],
  hasStylesheet = false,
): string {
  const article = el('article', {}, blocks);
  const link = hasStylesheet ? '\n    <link rel="stylesheet" href="content/styles.css" />' : '';
  return `<!DOCTYPE html>
<html lang="${escAttr(lang)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escText(title)}</title>${link}
  </head>
  <body>
${serializeNode(article, '    ')}
  </body>
</html>
`;
}
