import {
  elementChildren,
  getAttr,
  hasAttr,
  isElement,
  isWhitespaceText,
  meaningfulChildren,
  normalizedText,
  type WdfDocument,
  type WdfElement,
} from './html/ast.js';
import { parseHtml } from './html/parse.js';
import { computeTableGrid, parseSpan, type SpanCell } from './table.js';

/**
 * A violation of the WDF-HTML profile (spec §6). `spec` cites the enforced
 * section; `path` locates the offending element (`html/body/article/p[2]`,
 * with `#id` instead of the index when the element has one). SHOULD-level
 * rules report as warnings; a document conforms when it has no errors.
 */
export interface Violation {
  readonly spec: string;
  readonly path: string;
  readonly message: string;
  readonly severity: 'error' | 'warning';
}

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
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
  ...HEADINGS,
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
const ALL_BODY_ELEMENTS = new Set([
  'article',
  ...SECTIONING,
  ...BLOCKS,
  ...INLINE,
  'img',
  'figcaption',
  'caption',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'li',
  'dt',
  'dd',
  'code',
]);
/** Elements that MUST carry an id (spec §6.4.1); li is contextual. */
const ALWAYS_CITABLE = new Set(['section', ...HEADINGS, 'p', 'table', 'figure', 'blockquote']);

const GLOBAL_ATTRS = new Set(['id', 'class', 'lang', 'dir']);
const EXTRA_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href']),
  img: new Set(['src', 'alt', 'width', 'height']),
  time: new Set(['datetime']),
  abbr: new Set(['title']),
  blockquote: new Set(['cite']),
  th: new Set(['scope', 'colspan', 'rowspan']),
  td: new Set(['colspan', 'rowspan']),
  table: new Set(['data-wdf-dataset']),
};

const ID_PATTERN = /^[a-z]+-[a-z0-9][a-z0-9-]*$/;
const EXTERNAL_HREF = /^(https?:\/\/[^\s<>]+|mailto:[^\s<>]+)$/;
const FRAGMENT_HREF = /^#([a-z]+-[a-z0-9][a-z0-9-]*)$/;
const IMG_SRC = /^content\/assets(\/[A-Za-z0-9][A-Za-z0-9._-]*)+$/;
const DATASET_PATH = /^data(\/[A-Za-z0-9][A-Za-z0-9._-]*)+\.json$/;
const POSITIVE_INT = /^[1-9][0-9]*$/;
const LANGUAGE_TAG = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;
const DATE_OR_DATETIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2}))?$/;
// Control characters other than TAB (spec §6.3.5).
const FORBIDDEN_CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;

class ProfileChecker {
  readonly violations: Violation[] = [];
  readonly ids = new Map<string, string>(); // id → path of first occurrence

  report(spec: string, path: string, message: string, severity: 'error' | 'warning' = 'error') {
    this.violations.push({ spec, path, message, severity });
  }
}

function childPath(parentPath: string, el: WdfElement, indexAmongElements: number): string {
  const id = getAttr(el, 'id');
  const suffix = id !== undefined && id !== '' ? `#${id}` : `[${String(indexAmongElements)}]`;
  return `${parentPath}/${el.tag}${suffix}`;
}

/** First pass: collect every id in the body, for §6.4.2 uniqueness and §6.3.2 fragments. */
function collectIds(el: WdfElement, path: string, c: ProfileChecker): void {
  const children = elementChildren(el);
  children.forEach((child, i) => {
    const p = childPath(path, child, i + 1);
    const id = getAttr(child, 'id');
    if (id !== undefined) {
      if (c.ids.has(id)) {
        c.report('§6.4.2', p, `duplicate id "${id}" (first used at ${c.ids.get(id) ?? ''})`);
      } else {
        c.ids.set(id, p);
      }
    }
    collectIds(child, p, c);
  });
}

function checkAttributes(el: WdfElement, path: string, c: ProfileChecker): void {
  const allowed = EXTRA_ATTRS[el.tag];
  for (const attr of el.attrs) {
    if (FORBIDDEN_CONTROL.test(attr.value)) {
      c.report('§6.3.5', path, `attribute "${attr.name}" contains a control character`);
    }
    if (GLOBAL_ATTRS.has(attr.name) || (allowed?.has(attr.name) ?? false)) continue;
    c.report('§6.3', path, `attribute "${attr.name}" is not permitted on <${el.tag}>`);
  }

  const id = getAttr(el, 'id');
  if (id !== undefined && !ID_PATTERN.test(id)) {
    c.report('§6.4.2', path, `id "${id}" does not match ^[a-z]+-[a-z0-9][a-z0-9-]*$`);
  }

  switch (el.tag) {
    case 'a': {
      const href = getAttr(el, 'href');
      if (href === undefined) {
        c.report('§6.3.2', path, '<a> requires an href attribute');
      } else if (FRAGMENT_HREF.test(href)) {
        const target = href.slice(1);
        if (!c.ids.has(target)) {
          c.report('§6.3.2', path, `fragment link "${href}" has no matching id in this document`);
        }
      } else if (!EXTERNAL_HREF.test(href)) {
        c.report('§6.3.2', path, `href "${href}" is not https/http, mailto, or a local fragment`);
      }
      break;
    }
    case 'img': {
      const src = getAttr(el, 'src');
      if (src === undefined || !IMG_SRC.test(src)) {
        c.report(
          '§6.3.3',
          path,
          `img src must be a package path under content/assets/ (got "${src ?? ''}")`,
        );
      }
      if (!hasAttr(el, 'alt')) {
        c.report('§6.3.3', path, 'img requires an alt attribute (may be empty if decorative)');
      }
      for (const dim of ['width', 'height'] as const) {
        const v = getAttr(el, dim);
        if (v !== undefined && !POSITIVE_INT.test(v)) {
          c.report('§6.3.3', path, `img ${dim} must be a positive integer (got "${v}")`);
        }
      }
      break;
    }
    case 'time': {
      const v = getAttr(el, 'datetime');
      if (v !== undefined && !DATE_OR_DATETIME.test(v)) {
        c.report('§6.3.4', path, `datetime "${v}" is not an RFC 3339 date or date-time`);
      }
      break;
    }
    case 'blockquote': {
      const v = getAttr(el, 'cite');
      if (v !== undefined && !EXTERNAL_HREF.test(v)) {
        c.report(
          '§6.3.4',
          path,
          `blockquote cite "${v}" must be an external https/http/mailto URL`,
        );
      }
      break;
    }
    case 'th': {
      const v = getAttr(el, 'scope');
      if (v !== undefined && v !== 'col' && v !== 'row') {
        c.report('§6.3.4', path, `th scope must be "col" or "row" (got "${v}")`);
      }
      checkSpanAttrs(el, path, c);
      break;
    }
    case 'td':
      checkSpanAttrs(el, path, c);
      break;
    case 'table': {
      const v = getAttr(el, 'data-wdf-dataset');
      if (v !== undefined && !DATASET_PATH.test(v)) {
        c.report('§6.5', path, `data-wdf-dataset "${v}" is not a data/*.json package path`);
      }
      break;
    }
  }
}

// colspan/rowspan: integers 2..1000; the value 1 is expressed by omission (§6.3.4).
const SPAN_VALUE = /^(?:[2-9]|[1-9][0-9]{1,2}|1000)$/;

function checkSpanAttrs(el: WdfElement, path: string, c: ProfileChecker): void {
  for (const name of ['colspan', 'rowspan']) {
    const v = getAttr(el, name);
    if (v !== undefined && !SPAN_VALUE.test(v)) {
      c.report(
        '§6.3.4',
        path,
        `${name} must be an integer between 2 and 1000 — the value 1 is expressed by omitting the attribute (got "${v}")`,
      );
    }
  }
}

interface WalkContext {
  /** Inside a `p` (directly or through inline elements) — img permitted (§6.2.9). */
  inParagraph: boolean;
  /** Nesting depth of ul/ol lists; li at depth 1 is citable (§6.4.1). */
  listDepth: number;
}

function visit(el: WdfElement, path: string, c: ProfileChecker, ctx: WalkContext): void {
  checkAttributes(el, path, c);

  // §6.4.1 — mandatory ids on citable elements.
  const citable = ALWAYS_CITABLE.has(el.tag) || (el.tag === 'li' && ctx.listDepth === 1);
  if (citable && !hasAttr(el, 'id')) {
    c.report('§6.4.1', path, `citable element <${el.tag}> is missing its mandatory id`);
  }

  const children = elementChildren(el);
  const visitChildren = (nextCtx: WalkContext) => {
    children.forEach((child, i) => {
      visit(child, childPath(path, child, i + 1), c, nextCtx);
    });
  };

  // Whitelist (§6.2). Unknown elements: report once, then descend permissively
  // so attribute and id problems underneath are still surfaced.
  if (!ALL_BODY_ELEMENTS.has(el.tag)) {
    c.report('§6.2', path, `element <${el.tag}> is not in the WDF-HTML whitelist`);
    visitChildren(ctx);
    return;
  }

  const noText = (spec: string) => {
    if (el.children.some((n) => !isElement(n) && !isWhitespaceText(n))) {
      c.report(spec, path, `<${el.tag}> must not contain text directly`);
    }
  };

  switch (el.tag) {
    case 'article':
    case 'section':
    case 'header':
    case 'footer':
    case 'nav': {
      noText('§6.2');
      const allowSectioning = el.tag === 'article' || el.tag === 'section';
      for (const [i, child] of children.entries()) {
        const p = childPath(path, child, i + 1);
        if (child.tag === 'img') {
          c.report('§6.2.9', p, '<img> may appear only inside <figure> or inline inside <p>');
        } else if (INLINE.has(child.tag)) {
          c.report('§6.2', p, `inline element <${child.tag}> needs a block container`);
        } else if (!BLOCKS.has(child.tag) && !(allowSectioning && SECTIONING.has(child.tag))) {
          c.report('§6.2', p, `<${child.tag}> is not permitted inside <${el.tag}>`);
        }
      }
      if (el.tag === 'section' && children.length > 0 && !HEADINGS.has(children[0]?.tag ?? '')) {
        c.report('§6.2.1', path, 'section should begin with a heading', 'warning');
      }
      if (el.tag === 'article' && children.length === 0) {
        c.report('§6.1.4', path, 'article must contain at least one block element');
      }
      visitChildren(ctx);
      break;
    }
    case 'p':
      visitChildren({ ...ctx, inParagraph: true });
      checkInlineOnly(el, path, c, { ...ctx, inParagraph: true });
      break;
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
    case 'dt':
    case 'dd':
    case 'figcaption':
    case 'caption':
      visitChildren(ctx);
      checkInlineOnly(el, path, c, ctx);
      break;
    case 'th':
    case 'td':
      for (const [i, child] of children.entries()) {
        if (child.tag === 'br') {
          c.report(
            '§6.2.8',
            childPath(path, child, i + 1),
            '<br> is not permitted inside table cells',
          );
        }
      }
      visitChildren(ctx);
      checkInlineOnly(el, path, c, ctx);
      break;
    case 'li': {
      const listIndex = children.findIndex((ch) => ch.tag === 'ul' || ch.tag === 'ol');
      if (listIndex !== -1 && listIndex !== children.length - 1) {
        c.report('§6.2.4', path, 'a nested list must be the last child of <li>');
      }
      if (children.filter((ch) => ch.tag === 'ul' || ch.tag === 'ol').length > 1) {
        c.report('§6.2.4', path, '<li> may contain at most one nested list');
      }
      for (const [i, child] of children.entries()) {
        if (child.tag === 'ul' || child.tag === 'ol') continue;
        if (!INLINE.has(child.tag)) {
          c.report(
            child.tag === 'img' ? '§6.2.9' : '§6.2.4',
            childPath(path, child, i + 1),
            `<${child.tag}> is not permitted inside <li> (phrasing content plus one nested list)`,
          );
        }
      }
      visitChildren(ctx);
      break;
    }
    case 'ul':
    case 'ol': {
      noText('§6.2');
      for (const [i, child] of children.entries()) {
        if (child.tag !== 'li') {
          c.report('§6.2', childPath(path, child, i + 1), `<${el.tag}> may contain only <li>`);
        }
      }
      visitChildren({ ...ctx, inParagraph: false, listDepth: ctx.listDepth + 1 });
      break;
    }
    case 'dl': {
      noText('§6.2');
      for (const [i, child] of children.entries()) {
        if (child.tag !== 'dt' && child.tag !== 'dd') {
          c.report('§6.2', childPath(path, child, i + 1), '<dl> may contain only <dt> and <dd>');
        }
      }
      visitChildren(ctx);
      break;
    }
    case 'blockquote': {
      noText('§6.2.5');
      if (children.length === 0) {
        c.report('§6.2.5', path, '<blockquote> must contain at least one <p>');
      }
      for (const [i, child] of children.entries()) {
        if (child.tag !== 'p') {
          c.report(
            '§6.2.5',
            childPath(path, child, i + 1),
            '<blockquote> may contain only <p> elements',
          );
        }
      }
      visitChildren(ctx);
      break;
    }
    case 'figure': {
      noText('§6.2.6');
      const shape = children.map((ch) => ch.tag).join(',');
      if (shape !== 'img' && shape !== 'img,figcaption') {
        c.report(
          '§6.2.6',
          path,
          `<figure> must contain exactly one <img>, optionally followed by <figcaption> (got: ${shape === '' ? 'nothing' : shape})`,
        );
      }
      visitChildren(ctx);
      break;
    }
    case 'pre': {
      const ok =
        children.length === 0 ||
        (children.length === 1 &&
          children[0]?.tag === 'code' &&
          elementChildren(children[0]).length === 0 &&
          meaningfulChildren(el).length === 1);
      if (!ok) {
        c.report(
          '§6.2.7',
          path,
          '<pre> must contain text only, or exactly one <code> containing text only',
        );
      }
      visitChildren(ctx);
      break;
    }
    case 'table':
      checkTable(el, path, c);
      visitChildren(ctx);
      break;
    case 'thead':
    case 'tbody':
    case 'tfoot': {
      noText('§6.2.8');
      for (const [i, child] of children.entries()) {
        if (child.tag !== 'tr') {
          c.report('§6.2.8', childPath(path, child, i + 1), `<${el.tag}> may contain only <tr>`);
        }
      }
      visitChildren(ctx);
      break;
    }
    case 'tr': {
      noText('§6.2.8');
      for (const [i, child] of children.entries()) {
        if (child.tag !== 'th' && child.tag !== 'td') {
          c.report('§6.2.8', childPath(path, child, i + 1), '<tr> may contain only <th> and <td>');
        }
      }
      visitChildren(ctx);
      break;
    }
    case 'img':
    case 'br':
    case 'hr':
      // Void elements: placement is checked by the containing element.
      break;
    default:
      // Inline elements: phrasing content; img legality is checked at the img itself.
      visitChildren(ctx);
      checkInlineOnly(el, path, c, ctx);
      break;
  }
}

/** Ensures phrasing containers hold only inline elements (and img where legal). */
function checkInlineOnly(el: WdfElement, path: string, c: ProfileChecker, ctx: WalkContext): void {
  const children = elementChildren(el);
  for (const [i, child] of children.entries()) {
    const p = childPath(path, child, i + 1);
    if (child.tag === 'img') {
      if (!ctx.inParagraph) {
        c.report('§6.2.9', p, '<img> may appear only inside <figure> or inline inside <p>');
      }
      continue;
    }
    if (!INLINE.has(child.tag)) {
      c.report('§6.2.3', p, `<${child.tag}> is not phrasing content (inside <${el.tag}>)`);
    }
  }
}

function checkTable(el: WdfElement, path: string, c: ProfileChecker): void {
  const children = elementChildren(el);
  const shape = children.map((ch) => ch.tag).join(',');
  if (shape !== 'caption,thead,tbody' && shape !== 'caption,thead,tbody,tfoot') {
    c.report(
      '§6.2.8',
      path,
      `<table> must contain caption, thead, tbody[, tfoot] in order (got: ${shape === '' ? 'nothing' : shape})`,
    );
    return;
  }

  const bound = hasAttr(el, 'data-wdf-dataset');
  if (bound && shape.endsWith('tfoot')) {
    c.report('§6.5.2', path, 'a dataset-bound table must not contain <tfoot>');
  }

  const thead = children[1];
  if (thead !== undefined) {
    const headRows = elementChildren(thead);
    if (headRows.length !== 1) {
      c.report('§6.2.8', `${path}/thead[2]`, '<thead> must contain exactly one <tr>');
    }
    for (const tr of headRows) {
      if (elementChildren(tr).some((cell) => cell.tag !== 'th')) {
        c.report('§6.2.8', `${path}/thead[2]`, 'the header row must contain only <th> cells');
      }
    }
  }

  // §6.5.2 — a dataset-bound table is a full grid: no merged cells.
  const spanCells = (tr: WdfElement): SpanCell[] =>
    elementChildren(tr).map((cell) => ({
      colspan: parseSpan(getAttr(cell, 'colspan')),
      rowspan: parseSpan(getAttr(cell, 'rowspan')),
    }));
  if (bound) {
    const spanned = children
      .flatMap((sect) => elementChildren(sect).filter((r) => r.tag === 'tr'))
      .some((tr) =>
        elementChildren(tr).some((cell) => hasAttr(cell, 'colspan') || hasAttr(cell, 'rowspan')),
      );
    if (spanned) {
      c.report('§6.5.2', path, 'a dataset-bound table must not contain colspan or rowspan');
    }
  }

  // §6.2.8 — the grid must be exactly rectangular.
  const rowGroups = children
    .filter((ch) => ch.tag === 'thead' || ch.tag === 'tbody' || ch.tag === 'tfoot')
    .map((sect) =>
      elementChildren(sect)
        .filter((r) => r.tag === 'tr')
        .map(spanCells),
    );
  for (const problem of computeTableGrid(rowGroups).problems) {
    c.report('§6.2.8', path, `table grid is not rectangular: ${problem}`);
  }
}

function checkHead(head: WdfElement, path: string, c: ProfileChecker): void {
  const children = elementChildren(head);

  const first = children[0];
  if (
    first === undefined ||
    first.tag !== 'meta' ||
    (getAttr(first, 'charset') ?? '').toLowerCase() !== 'utf-8'
  ) {
    c.report('§6.1.3', path, 'the first child of <head> must be <meta charset="utf-8">');
  }

  const titles = children.filter((ch) => ch.tag === 'title');
  if (titles.length !== 1) {
    c.report(
      '§6.1.3',
      path,
      `<head> must contain exactly one <title> (found ${String(titles.length)})`,
    );
  } else if (normalizedText(titles[0] as WdfElement) === '') {
    c.report('§6.1.3', `${path}/title`, '<title> must not be empty');
  }

  let links = 0;
  children.forEach((child, i) => {
    const p = childPath(path, child, i + 1);
    switch (child.tag) {
      case 'meta': {
        if (i === 0 && hasAttr(child, 'charset')) break;
        const name = getAttr(child, 'name');
        if (name !== 'viewport') {
          c.report(
            '§6.1.3',
            p,
            'only the charset meta and <meta name="viewport"> are permitted in <head>',
          );
        }
        break;
      }
      case 'title':
        break;
      case 'link': {
        links += 1;
        if (links > 1) {
          c.report('§6.7.1', p, 'at most one stylesheet link is permitted');
        } else if (
          getAttr(child, 'rel') !== 'stylesheet' ||
          getAttr(child, 'href') !== 'content/styles.css'
        ) {
          c.report(
            '§6.7.1',
            p,
            '<link> must be exactly rel="stylesheet" href="content/styles.css"',
          );
        }
        break;
      }
      default:
        c.report('§6.1.3', p, `<${child.tag}> is not permitted in <head>`);
    }
  });
}

/**
 * Validates a document against the WDF-HTML profile (spec §6). Accepts raw
 * HTML (parsed with parse5) or an already-parsed document from either adapter.
 * Note: checks run on the parsed tree, so constructs the WHATWG parser fixes
 * up silently (unclosed tags, missing head) surface as the resulting tree's
 * violations rather than as syntax errors.
 */
export function validateProfile(input: string | WdfDocument): Violation[] {
  const doc = typeof input === 'string' ? parseHtml(input) : input;
  const c = new ProfileChecker();

  if (doc.doctype === null) {
    c.report('§6.1.1', '(document)', 'missing <!DOCTYPE html>');
  } else if (
    doc.doctype.name !== 'html' ||
    doc.doctype.publicId !== '' ||
    doc.doctype.systemId !== ''
  ) {
    c.report('§6.1.1', '(document)', 'the doctype must be exactly <!DOCTYPE html>');
  }

  const html = doc.html;
  if (html === null) {
    c.report('§6.1.1', '(document)', 'document has no <html> element');
    return c.violations;
  }

  const lang = getAttr(html, 'lang');
  if (lang === undefined || !LANGUAGE_TAG.test(lang)) {
    c.report('§6.1.2', 'html', `<html> must carry a BCP 47 lang attribute (got "${lang ?? ''}")`);
  }
  for (const attr of html.attrs) {
    if (attr.name !== 'lang' && attr.name !== 'dir') {
      c.report('§6.3', 'html', `attribute "${attr.name}" is not permitted on <html>`);
    }
  }

  const head = elementChildren(html).find((ch) => ch.tag === 'head');
  const body = elementChildren(html).find((ch) => ch.tag === 'body');
  if (head !== undefined) checkHead(head, 'html/head', c);

  if (body !== undefined) {
    const bodyPath = 'html/body';
    collectIds(body, bodyPath, c);
    if (body.children.some((n) => !isElement(n) && !isWhitespaceText(n))) {
      c.report('§6.1.4', bodyPath, '<body> must not contain text directly');
    }
    const bodyChildren = elementChildren(body);
    if (bodyChildren.length !== 1 || bodyChildren[0]?.tag !== 'article') {
      c.report(
        '§6.1.4',
        bodyPath,
        `<body> must contain exactly one <article> (found: ${bodyChildren.map((e) => e.tag).join(', ') || 'nothing'})`,
      );
    }
    bodyChildren.forEach((child, i) => {
      visit(child, childPath(bodyPath, child, i + 1), c, { inParagraph: false, listDepth: 0 });
    });

    const h1s = countTag(body, 'h1');
    if (h1s !== 1) {
      c.report(
        '§6.1.5',
        bodyPath,
        `document should contain exactly one <h1> (found ${String(h1s)})`,
        'warning',
      );
    }
  }

  return c.violations;
}

function countTag(el: WdfElement, tag: string): number {
  return elementChildren(el).reduce((n, ch) => n + (ch.tag === tag ? 1 : 0) + countTag(ch, tag), 0);
}

const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
const CSS_RULES: [RegExp, string][] = [
  [/@import\b/i, '@import is not permitted'],
  [/@font-face\b/i, '@font-face is not permitted'],
  [/\burl\s*\(/i, 'url(…) is not permitted in any form'],
  [/\bposition\s*:\s*fixed\b/i, 'position: fixed is not permitted'],
  [/\bposition\s*:\s*sticky\b/i, 'position: sticky is not permitted'],
];

/** Validates content/styles.css against spec §6.7.2. */
export function validateStylesheet(css: string): Violation[] {
  const stripped = css.replace(CSS_COMMENT, '');
  const violations: Violation[] = [];
  for (const [re, message] of CSS_RULES) {
    if (re.test(stripped)) {
      violations.push({ spec: '§6.7.2', path: 'content/styles.css', message, severity: 'error' });
    }
  }
  return violations;
}
