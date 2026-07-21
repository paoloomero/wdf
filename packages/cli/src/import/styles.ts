import { getAttr, isElement, type WdfElement, type WdfNode } from '@wdf/core';

import { isEl, type MEl } from './ast.js';

/**
 * Style translation (plan §10.7, T7.2): the imported document keeps its
 * typographic identity — fonts, sizes, colors, alignment, table borders —
 * by translating source presentation (inline styles, <style> blocks,
 * presentational attributes) into a generated content/styles.css with
 * deterministically named classes. Fixed page layout is deliberately NOT
 * preserved: the target is "il documento riconoscibile e responsive",
 * never a pixel copy.
 */

export type Decls = Map<string, string>;

/** Typographic properties that survive translation (plan §10.7 whitelist). */
const PROPERTY_WHITELIST = new Set([
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant',
  'color',
  'background-color',
  'background',
  'text-align',
  'text-decoration',
  'text-decoration-line',
  'text-transform',
  'text-indent',
  'letter-spacing',
  'line-height',
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-color',
  'border-style',
  'border-width',
  'border-collapse',
  'border-radius',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'width',
  'max-width',
  'height',
  'vertical-align',
]);

/** Values that could smuggle behavior or external references (§6.7.2). */
const VALUE_FORBIDDEN = /url\s*\(|expression|javascript|@import|@font-face|<|>/i;
const POSITION_FORBIDDEN = /fixed|sticky/i;

const SERIF_HINTS = /times|georgia|garamond|cambria|palatino|book antiqua|charter|serif/i;
const MONO_HINTS = /courier|consolas|menlo|monaco|mono/i;
const GENERIC_FAMILY = /\b(serif|sans-serif|monospace|system-ui|cursive|fantasy)\b/i;

/** Appends a generic fallback so unavailable fonts degrade gracefully. */
function ensureFontFallback(value: string): string {
  if (GENERIC_FAMILY.test(value)) return value;
  if (MONO_HINTS.test(value)) return `${value}, monospace`;
  if (SERIF_HINTS.test(value)) return `${value}, serif`;
  return `${value}, sans-serif`;
}

/** Parses `prop: value; prop: value` declaration text, dropping mso-* noise. */
export function parseDeclarations(text: string): Decls {
  const decls: Decls = new Map();
  for (const chunk of text.split(';')) {
    const colon = chunk.indexOf(':');
    if (colon === -1) continue;
    const prop = chunk.slice(0, colon).trim().toLowerCase();
    const value = chunk.slice(colon + 1).trim();
    if (prop === '' || value === '' || value.length > 200) continue;
    if (prop.startsWith('mso-')) continue;
    decls.set(prop, value);
  }
  return decls;
}

/** Keeps only whitelisted, safe declarations; adds font fallbacks. */
export function sanitizeDeclarations(decls: Decls): Decls {
  const out: Decls = new Map();
  for (const [prop, value] of decls) {
    if (!PROPERTY_WHITELIST.has(prop)) continue;
    if (VALUE_FORBIDDEN.test(value)) continue;
    if (prop === 'position' || POSITION_FORBIDDEN.test(value)) continue;
    out.set(prop, prop === 'font-family' ? ensureFontFallback(value) : value);
  }
  return out;
}

export interface StyleRule {
  tag?: string;
  cls?: string;
  decls: Decls;
}

/**
 * Parses the subset of CSS that Word and simple pages actually use: flat
 * `tag`, `.class` and `tag.class` rules. At-rules (@page, @media, …),
 * comments and complex selectors are skipped whole.
 */
export function parseStylesheet(css: string): StyleRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--|-->/g, '');
  const rules: StyleRule[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open === -1) break;
    const selectorText = text.slice(i, open).trim();
    // Find the matching close brace (at-rules may nest one level).
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth += 1;
      else if (text[j] === '}') depth -= 1;
      j += 1;
    }
    const body = text.slice(open + 1, j - 1);
    i = j;
    if (selectorText.startsWith('@')) continue;
    const decls = parseDeclarations(body);
    if (decls.size === 0) continue;
    for (const selector of selectorText.split(',')) {
      const m = /^([a-zA-Z][a-zA-Z0-9]*)?(?:\.([A-Za-z_][\w-]*))?$/.exec(selector.trim());
      if (m === null || (m[1] === undefined && m[2] === undefined)) continue;
      const rule: StyleRule = { decls };
      if (m[1] !== undefined) rule.tag = m[1].toLowerCase();
      if (m[2] !== undefined) rule.cls = m[2];
      rules.push(rule);
    }
  }
  return rules;
}

/** Collects the text of every <style> element in the parsed source document. */
export function collectStyleRules(root: WdfNode): StyleRule[] {
  const rules: StyleRule[] = [];
  const walk = (node: WdfNode): void => {
    if (!isElement(node)) return;
    if (node.tag === 'style') {
      const css = node.children.map((c) => (isElement(c) ? '' : c.text)).join('');
      rules.push(...parseStylesheet(css));
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(root);
  return rules;
}

/** Legacy presentational attributes translated to declarations. */
function presentationalDecls(node: WdfElement): Decls {
  const decls: Decls = new Map();
  const align = getAttr(node, 'align');
  if (align !== undefined && /^(left|right|center|justify)$/i.test(align)) {
    decls.set('text-align', align.toLowerCase());
  }
  const bgcolor = getAttr(node, 'bgcolor');
  if (bgcolor !== undefined) decls.set('background-color', bgcolor);
  if (node.tag === 'font') {
    const face = getAttr(node, 'face');
    if (face !== undefined) decls.set('font-family', face);
    const color = getAttr(node, 'color');
    if (color !== undefined) decls.set('color', color);
  }
  if (node.tag === 'td' || node.tag === 'th' || node.tag === 'table') {
    const width = getAttr(node, 'width');
    if (width !== undefined && /^\d+%?$/.test(width)) {
      decls.set('width', width.endsWith('%') ? width : `${width}px`);
    }
  }
  return decls;
}

/**
 * Resolves the effective, sanitized declarations for a source element:
 * presentational attributes < tag rules < class rules < inline style
 * (a pragmatic approximation of the cascade, adequate for Word output).
 */
export class StyleResolver {
  private readonly rules: StyleRule[];

  constructor(rules: StyleRule[]) {
    this.rules = rules;
  }

  /** Canonical signature `prop:value;…` (sorted), or undefined when unstyled. */
  resolve(node: WdfElement): string | undefined {
    const merged: Decls = new Map();
    const apply = (decls: Decls): void => {
      for (const [k, v] of decls) merged.set(k, v);
    };

    apply(presentationalDecls(node));
    const classes = (getAttr(node, 'class') ?? '').split(/\s+/).filter((c) => c !== '');
    for (const rule of this.rules) {
      if (rule.cls !== undefined) continue;
      if (rule.tag === node.tag) apply(rule.decls);
    }
    for (const rule of this.rules) {
      if (rule.cls === undefined || !classes.includes(rule.cls)) continue;
      if (rule.tag !== undefined && rule.tag !== node.tag) continue;
      apply(rule.decls);
    }
    const inline = getAttr(node, 'style');
    if (inline !== undefined) apply(parseDeclarations(inline));

    const sanitized = sanitizeDeclarations(merged);
    if (sanitized.size === 0) return undefined;
    return [...sanitized.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${k}:${v}`)
      .join(';');
  }
}

/** Temporary attribute carrying the style signature until hoisting. */
export const STYLE_TMP_ATTR = '__wdf_style';

/** Responsive base emitted with every generated stylesheet. */
const BASE_CSS = `article {
  max-width: 46rem;
  margin: 0 auto;
  line-height: 1.55;
}
img {
  max-width: 100%;
  height: auto;
}
table {
  border-collapse: collapse;
}
`;

/**
 * Replaces style signatures with deterministic class names (`w1`, `w2`, … in
 * document order) and returns the generated stylesheet, or undefined when the
 * document carries no translatable style.
 */
export function hoistStyles(blocks: MEl[]): string | undefined {
  const classes = new Map<string, string>();
  const walk = (el: MEl): void => {
    const signature = el.attrs[STYLE_TMP_ATTR];
    if (signature !== undefined) {
      delete el.attrs['__wdf_style'];
      let name = classes.get(signature);
      if (name === undefined) {
        name = `w${String(classes.size + 1)}`;
        classes.set(signature, name);
      }
      // Source class names (MsoNormal, …) are meaningless after import.
      el.attrs['class'] = name;
    } else {
      delete el.attrs['class'];
    }
    for (const child of el.children) {
      if (isEl(child)) walk(child);
    }
  };
  for (const block of blocks) walk(block);

  if (classes.size === 0) return undefined;
  const rules = [...classes.entries()]
    .map(([signature, name]) => {
      const body = signature
        .split(';')
        .map((decl) => `  ${decl.replace(':', ': ')};`)
        .join('\n');
      return `.${name} {\n${body}\n}`;
    })
    .join('\n');
  return `${BASE_CSS}${rules}\n`;
}
