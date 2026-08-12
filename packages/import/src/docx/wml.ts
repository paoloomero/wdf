import { el, isEl, type MEl, type MNode } from '../ast.js';
import { hoistStyles, sanitizeDeclarations, STYLE_TMP_ATTR, type Decls } from '../styles.js';
import { openDocx, resolveTarget, type DocxContainer } from './container.js';
import { parseXml, xmlAttr, xmlChild, xmlChildren, xmlText, type XmlElement } from './xml.js';

// WordprocessingML → importer blocks (WP20 T20.2, plan §10.47): paragraphs
// and runs with the style CHAIN resolved (docDefaults → basedOn chain →
// direct properties), headings from outlineLvl / built-in style names,
// semantic inline mapping (bold→strong, italic→em, vertAlign→sup/sub) and
// the typographic rest translated into the generated stylesheet through the
// SAME whitelist machinery the HTML importer uses (styles.ts). Whitelist
// thinking: what the profile cannot express is reported, never silent.

export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

// ---------------------------------------------------------------------------
// Property model

interface RunProps {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  vertAlign?: 'superscript' | 'subscript' | 'baseline';
  /** w:sz — half-points. */
  sz?: number;
  /** RRGGBB hex, already filtered ('auto' never lands here). */
  color?: string;
  font?: string;
  highlight?: string;
  caps?: boolean;
  smallCaps?: boolean;
  styleId?: string;
}

interface ParaProps {
  styleId?: string;
  outlineLvl?: number;
  jc?: string;
  /** Twips (1/20 pt). */
  indentLeft?: number;
  firstLine?: number;
  hanging?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  /** 240ths of a line, only for w:lineRule="auto". */
  lineAuto?: number;
  /** w:numPr — numbering instance ("0" cancels inherited numbering). */
  numId?: string;
  numIlvl?: number;
}

/** OOXML on/off value: element absent → undefined; w:val 0/false/none → off. */
function onOff(element: XmlElement | undefined): boolean | undefined {
  if (element === undefined) return undefined;
  const val = xmlAttr(element, W_NS, 'val');
  return val === undefined || !/^(0|false|none)$/i.test(val);
}

function wVal(parent: XmlElement, local: string): string | undefined {
  const child = xmlChild(parent, W_NS, local);
  return child === undefined ? undefined : xmlAttr(child, W_NS, 'val');
}

function twips(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseRPr(rPr: XmlElement | undefined): RunProps {
  const props: RunProps = {};
  if (rPr === undefined) return props;
  const set = <K extends keyof RunProps>(key: K, value: RunProps[K] | undefined): void => {
    if (value !== undefined) props[key] = value;
  };
  set('styleId', wVal(rPr, 'rStyle'));
  set('bold', onOff(xmlChild(rPr, W_NS, 'b')));
  set('italic', onOff(xmlChild(rPr, W_NS, 'i')));
  set('strike', onOff(xmlChild(rPr, W_NS, 'strike')));
  set('caps', onOff(xmlChild(rPr, W_NS, 'caps')));
  set('smallCaps', onOff(xmlChild(rPr, W_NS, 'smallCaps')));
  const u = wVal(rPr, 'u');
  if (u !== undefined) props.underline = u !== 'none';
  const vert = wVal(rPr, 'vertAlign');
  if (vert === 'superscript' || vert === 'subscript' || vert === 'baseline') {
    props.vertAlign = vert;
  }
  const sz = twips(wVal(rPr, 'sz'));
  if (sz !== undefined && sz > 0) props.sz = sz;
  const color = wVal(rPr, 'color');
  if (color !== undefined && /^[0-9A-Fa-f]{6}$/.test(color)) props.color = color.toLowerCase();
  const fonts = xmlChild(rPr, W_NS, 'rFonts');
  const ascii = fonts === undefined ? undefined : xmlAttr(fonts, W_NS, 'ascii');
  if (ascii !== undefined && ascii !== '') props.font = ascii;
  const highlight = wVal(rPr, 'highlight');
  if (highlight !== undefined && highlight !== 'none') props.highlight = highlight;
  return props;
}

function parsePPr(pPr: XmlElement | undefined): ParaProps {
  const props: ParaProps = {};
  if (pPr === undefined) return props;
  const styleId = wVal(pPr, 'pStyle');
  if (styleId !== undefined) props.styleId = styleId;
  const outline = twips(wVal(pPr, 'outlineLvl'));
  if (outline !== undefined) props.outlineLvl = outline;
  const jc = wVal(pPr, 'jc');
  if (jc !== undefined) props.jc = jc;
  const ind = xmlChild(pPr, W_NS, 'ind');
  if (ind !== undefined) {
    const left = twips(xmlAttr(ind, W_NS, 'left') ?? xmlAttr(ind, W_NS, 'start'));
    if (left !== undefined) props.indentLeft = left;
    const firstLine = twips(xmlAttr(ind, W_NS, 'firstLine'));
    if (firstLine !== undefined) props.firstLine = firstLine;
    const hanging = twips(xmlAttr(ind, W_NS, 'hanging'));
    if (hanging !== undefined) props.hanging = hanging;
  }
  const numPr = xmlChild(pPr, W_NS, 'numPr');
  if (numPr !== undefined) {
    const numId = wVal(numPr, 'numId');
    if (numId !== undefined) props.numId = numId;
    const ilvl = twips(wVal(numPr, 'ilvl'));
    if (ilvl !== undefined) props.numIlvl = ilvl;
  }
  const spacing = xmlChild(pPr, W_NS, 'spacing');
  if (spacing !== undefined) {
    const before = twips(xmlAttr(spacing, W_NS, 'before'));
    if (before !== undefined) props.spaceBefore = before;
    const after = twips(xmlAttr(spacing, W_NS, 'after'));
    if (after !== undefined) props.spaceAfter = after;
    const line = twips(xmlAttr(spacing, W_NS, 'line'));
    const rule = xmlAttr(spacing, W_NS, 'lineRule');
    if (line !== undefined && line > 0 && (rule === 'auto' || rule === undefined)) {
      props.lineAuto = line;
    }
  }
  return props;
}

function mergeRun(base: RunProps, over: RunProps): RunProps {
  const out: RunProps = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function mergePara(base: ParaProps, over: ParaProps): ParaProps {
  const out: ParaProps = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// styles.xml

interface DocxStyle {
  readonly id: string;
  /** Locale-independent built-in name ("heading 1", "Title"), lowercased. */
  readonly name: string;
  readonly type: string;
  readonly basedOn: string | undefined;
  readonly pPr: ParaProps;
  readonly rPr: RunProps;
}

export class DocxStyles {
  readonly defaultRun: RunProps;
  readonly defaultPara: ParaProps;
  /** Document language from docDefaults (w:lang w:val), when declared. */
  readonly language: string | undefined;
  private readonly byId = new Map<string, DocxStyle>();
  private readonly defaultParagraphStyle: string | undefined;

  constructor(stylesXml: string | undefined) {
    let root: XmlElement | undefined;
    if (stylesXml !== undefined) root = parseXml(stylesXml);
    const docDefaults = root === undefined ? undefined : xmlChild(root, W_NS, 'docDefaults');
    const rPrDefault =
      docDefaults === undefined ? undefined : xmlChild(docDefaults, W_NS, 'rPrDefault');
    const pPrDefault =
      docDefaults === undefined ? undefined : xmlChild(docDefaults, W_NS, 'pPrDefault');
    const defaultRPr = rPrDefault === undefined ? undefined : xmlChild(rPrDefault, W_NS, 'rPr');
    this.defaultRun = parseRPr(defaultRPr);
    this.defaultPara = parsePPr(
      pPrDefault === undefined ? undefined : xmlChild(pPrDefault, W_NS, 'pPr'),
    );
    const lang = defaultRPr === undefined ? undefined : xmlChild(defaultRPr, W_NS, 'lang');
    this.language = lang === undefined ? undefined : xmlAttr(lang, W_NS, 'val');

    let defaultParagraph: string | undefined;
    for (const style of root === undefined ? [] : xmlChildren(root, W_NS, 'style')) {
      const id = xmlAttr(style, W_NS, 'styleId');
      const type = xmlAttr(style, W_NS, 'type') ?? '';
      if (id === undefined) continue;
      const entry: DocxStyle = {
        id,
        name: (wVal(style, 'name') ?? '').toLowerCase(),
        type,
        basedOn: wVal(style, 'basedOn'),
        pPr: parsePPr(xmlChild(style, W_NS, 'pPr')),
        rPr: parseRPr(xmlChild(style, W_NS, 'rPr')),
      };
      this.byId.set(id, entry);
      if (type === 'paragraph' && xmlAttr(style, W_NS, 'default') === '1') {
        defaultParagraph = id;
      }
    }
    this.defaultParagraphStyle = defaultParagraph;
  }

  /** basedOn chain, root first; cycle-safe. */
  chain(styleId: string | undefined): DocxStyle[] {
    const out: DocxStyle[] = [];
    const seen = new Set<string>();
    let id = styleId;
    while (id !== undefined && !seen.has(id)) {
      seen.add(id);
      const style = this.byId.get(id);
      if (style === undefined) break;
      out.unshift(style);
      id = style.basedOn;
    }
    return out;
  }

  /** Effective paragraph properties: docDefaults → style chain → direct. */
  effectivePara(direct: ParaProps): ParaProps {
    let props = this.defaultPara;
    for (const style of this.chain(direct.styleId ?? this.defaultParagraphStyle)) {
      props = mergePara(props, style.pPr);
    }
    return mergePara(props, direct);
  }

  /** Effective run properties: docDefaults → paragraph chain → rStyle chain → direct. */
  effectiveRun(direct: RunProps, paraStyleId: string | undefined): RunProps {
    let props = this.defaultRun;
    for (const style of this.chain(paraStyleId ?? this.defaultParagraphStyle)) {
      props = mergeRun(props, style.rPr);
    }
    for (const style of this.chain(direct.styleId)) {
      props = mergeRun(props, style.rPr);
    }
    return mergeRun(props, direct);
  }

  /**
   * Heading level 1..6 for a paragraph, or undefined: effective outlineLvl
   * first (0..5 → h1..h6), then the built-in style names ("heading N",
   * "title" → h1) — locale-independent, styleIds are localized instead.
   */
  headingLevel(direct: ParaProps): number | undefined {
    const effective = this.effectivePara(direct);
    if (effective.outlineLvl !== undefined && effective.outlineLvl <= 5) {
      return effective.outlineLvl + 1;
    }
    const chain = this.chain(direct.styleId);
    for (let i = chain.length - 1; i >= 0; i--) {
      const name = chain[i]?.name ?? '';
      const m = /^heading ([1-6])$/.exec(name);
      if (m !== null) return Number(m[1]);
      if (name === 'title') return 1;
    }
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// numbering.xml (T20.3): lists

const NUMBERING_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';

/** Numbering formats rendered as <ol> without a report. */
const ORDERED_FORMATS = new Set([
  'decimal',
  'decimalZero',
  'lowerLetter',
  'upperLetter',
  'lowerRoman',
  'upperRoman',
]);

/**
 * The numbering model: w:num instances point at w:abstractNum definitions;
 * each abstract level carries a numFmt. Only the format matters here — the
 * numbers themselves are rendered by the list element, never as text.
 */
export class DocxNumbering {
  /** numId → abstractNumId. */
  private readonly nums = new Map<string, string>();
  /** numId → per-level format overrides (w:lvlOverride). */
  private readonly overrides = new Map<string, Map<number, string>>();
  /** abstractNumId → ilvl → numFmt. */
  private readonly abstract = new Map<string, Map<number, string>>();

  constructor(numberingXml: string | undefined) {
    if (numberingXml === undefined) return;
    const root = parseXml(numberingXml);
    for (const abs of xmlChildren(root, W_NS, 'abstractNum')) {
      const id = xmlAttr(abs, W_NS, 'abstractNumId');
      if (id === undefined) continue;
      const levels = new Map<number, string>();
      for (const lvl of xmlChildren(abs, W_NS, 'lvl')) {
        const ilvl = twips(xmlAttr(lvl, W_NS, 'ilvl'));
        const fmt = wVal(lvl, 'numFmt');
        if (ilvl !== undefined && fmt !== undefined) levels.set(ilvl, fmt);
      }
      this.abstract.set(id, levels);
    }
    for (const num of xmlChildren(root, W_NS, 'num')) {
      const id = xmlAttr(num, W_NS, 'numId');
      const absId = wVal(num, 'abstractNumId');
      if (id === undefined || absId === undefined) continue;
      this.nums.set(id, absId);
      const overrides = new Map<number, string>();
      for (const over of xmlChildren(num, W_NS, 'lvlOverride')) {
        const ilvl = twips(xmlAttr(over, W_NS, 'ilvl'));
        const lvl = xmlChild(over, W_NS, 'lvl');
        const fmt = lvl === undefined ? undefined : wVal(lvl, 'numFmt');
        if (ilvl !== undefined && fmt !== undefined) overrides.set(ilvl, fmt);
      }
      if (overrides.size > 0) this.overrides.set(id, overrides);
    }
  }

  /** numFmt of an instance level, or undefined when the definition is missing. */
  format(numId: string, ilvl: number): string | undefined {
    const override = this.overrides.get(numId)?.get(ilvl);
    if (override !== undefined) return override;
    const absId = this.nums.get(numId);
    if (absId === undefined) return undefined;
    return this.abstract.get(absId)?.get(ilvl);
  }
}

interface ListInfo {
  readonly level: number;
  readonly ordered: boolean;
  readonly numId: string;
}

/**
 * Assembles consecutive list paragraphs into nested ul/ol structures under
 * the profile's constraints: a list contains only <li>, an <li> carries at
 * most ONE nested list, as its last child (§6.2.4). Root lists are pushed
 * into the block stream on creation and grow by mutation; where OOXML can
 * express what the profile cannot (a numbering restart in a nested
 * position), the lists merge with a report.
 */
class ListAssembler {
  private stack: { list: MEl; level: number; numId: string }[] = [];

  add(info: ListInfo, li: MEl, blocks: MEl[], ctx: WmlContext): void {
    let level = info.level;
    let popped: { list: MEl; level: number; numId: string } | undefined;
    while (true) {
      const top = this.stack[this.stack.length - 1];
      if (top !== undefined && top.level > level) {
        popped = this.stack.pop();
        continue;
      }
      if (
        top !== undefined &&
        top.level === level &&
        ((top.list.tag === 'ol') !== info.ordered || top.numId !== info.numId)
      ) {
        if (this.stack.length === 1) {
          this.stack.pop(); // a sibling list can exist at the top level
        } else {
          reportOnce(
            ctx,
            'adjacent list continued: a restart in a nested position is not representable (§6.2.4)',
          );
        }
      }
      break;
    }
    let top = this.stack[this.stack.length - 1];
    if (top === undefined) {
      const list = el(info.ordered ? 'ol' : 'ul');
      // A group that STARTED at a deeper level than this item (Word allows
      // it): the emitted list re-nests under the new, shallower root.
      if (
        popped !== undefined &&
        popped.numId === info.numId &&
        blocks[blocks.length - 1] === popped.list
      ) {
        blocks[blocks.length - 1] = list;
        list.children.push(el('li', {}, [popped.list]));
      } else {
        blocks.push(list);
      }
      top = { list, level, numId: info.numId };
      this.stack.push(top);
    } else if (top.level < level) {
      const lastLi = [...top.list.children].reverse().find(isEl);
      const nested = lastLi === undefined ? undefined : [...lastLi.children].reverse().find(isEl);
      if (lastLi === undefined) {
        level = top.level; // level skip at list start: clamp to the list
      } else if (nested !== undefined && (nested.tag === 'ul' || nested.tag === 'ol')) {
        // The li already carries its one nested list: continue inside it.
        top = { list: nested, level, numId: info.numId };
        this.stack.push(top);
      } else {
        const list = el(info.ordered ? 'ol' : 'ul');
        lastLi.children.push(list);
        top = { list, level, numId: info.numId };
        this.stack.push(top);
      }
    }
    top.list.children.push(li);
  }

  /** Ends the current group: the next list paragraph starts a fresh root. */
  flush(): void {
    this.stack = [];
  }
}

// ---------------------------------------------------------------------------
// Property → CSS translation (whitelist of styles.ts; everything else out)

const HIGHLIGHTS: Record<string, string> = {
  yellow: '#ffff00',
  green: '#00ff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  blue: '#0000ff',
  red: '#ff0000',
  darkBlue: '#00008b',
  darkCyan: '#008b8b',
  darkGreen: '#006400',
  darkMagenta: '#8b008b',
  darkRed: '#8b0000',
  darkYellow: '#808000',
  darkGray: '#a9a9a9',
  lightGray: '#d3d3d3',
  black: '#000000',
  white: '#ffffff',
};

/** Twips → pt with at most 2 decimals, no trailing zeros. */
function pt(tw: number): string {
  return `${String(Math.round(tw * 5) / 100)}pt`;
}

function fontFamily(name: string): string {
  return /^[a-zA-Z][a-zA-Z0-9-]*$/.test(name) ? name : `"${name}"`;
}

/** Typographic declarations of a run (semantics excluded — they become elements). */
function runDecls(props: RunProps): Decls {
  const decls: Decls = new Map();
  if (props.sz !== undefined) decls.set('font-size', `${String(props.sz / 2)}pt`);
  if (props.color !== undefined) decls.set('color', `#${props.color}`);
  if (props.font !== undefined) decls.set('font-family', fontFamily(props.font));
  const deco = [
    ...(props.underline === true ? ['underline'] : []),
    ...(props.strike === true ? ['line-through'] : []),
  ];
  if (deco.length > 0) decls.set('text-decoration', deco.join(' '));
  const highlight = props.highlight === undefined ? undefined : HIGHLIGHTS[props.highlight];
  if (highlight !== undefined) decls.set('background-color', highlight);
  if (props.caps === true) decls.set('text-transform', 'uppercase');
  if (props.smallCaps === true) decls.set('font-variant', 'small-caps');
  return decls;
}

function paraDecls(props: ParaProps): Decls {
  const decls: Decls = new Map();
  if (props.jc !== undefined) {
    const align = { both: 'justify', start: 'left', end: 'right' }[props.jc] ?? props.jc;
    if (/^(left|right|center|justify)$/.test(align)) decls.set('text-align', align);
  }
  if (props.indentLeft !== undefined && props.indentLeft > 0) {
    decls.set('margin-left', pt(props.indentLeft));
  }
  if (props.firstLine !== undefined && props.firstLine > 0) {
    decls.set('text-indent', pt(props.firstLine));
  } else if (props.hanging !== undefined && props.hanging > 0) {
    decls.set('text-indent', `-${pt(props.hanging)}`);
  }
  if (props.spaceBefore !== undefined) decls.set('margin-top', pt(props.spaceBefore));
  if (props.spaceAfter !== undefined) decls.set('margin-bottom', pt(props.spaceAfter));
  if (props.lineAuto !== undefined) {
    decls.set('line-height', String(Math.round((props.lineAuto / 240) * 100) / 100));
  }
  return decls;
}

/** Canonical `prop:value;…` signature (sorted), or undefined when empty. */
function signatureOf(decls: Decls): string | undefined {
  const sanitized = sanitizeDeclarations(decls);
  if (sanitized.size === 0) return undefined;
  return [...sanitized.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
}

function mergeSignatures(base: string | undefined, over: string | undefined): string | undefined {
  if (base === undefined) return over;
  if (over === undefined) return base;
  const decls: Decls = new Map();
  for (const part of [...base.split(';'), ...over.split(';')]) {
    const colon = part.indexOf(':');
    if (colon !== -1) decls.set(part.slice(0, colon), part.slice(colon + 1));
  }
  return [...decls.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
}

// ---------------------------------------------------------------------------
// Runs and paragraphs

/** Run children that are formatting/noise, silently skipped by design. */
const RUN_NOISE = new Set(['rPr', 'lastRenderedPageBreak', 'fldChar', 'instrText', 'delText']);
/** Paragraph children that are markers/noise at this stage. */
const PARA_NOISE = new Set([
  'pPr',
  'proofErr',
  'bookmarkStart',
  'bookmarkEnd',
  'commentRangeStart',
  'commentRangeEnd',
  'commentReference',
]);

interface WmlContext {
  readonly styles: DocxStyles;
  readonly numbering: DocxNumbering;
  readonly report: string[];
  readonly reported: Set<string>;
}

/** Reports once per distinct message — real documents repeat everything. */
function reportOnce(ctx: WmlContext, message: string): void {
  if (ctx.reported.has(message)) return;
  ctx.reported.add(message);
  ctx.report.push(message);
}

function runToNodes(run: XmlElement, paraStyleId: string | undefined, ctx: WmlContext): MNode[] {
  const props = ctx.styles.effectiveRun(parseRPr(xmlChild(run, W_NS, 'rPr')), paraStyleId);
  const content: MNode[] = [];
  for (const child of run.children) {
    if (child.kind !== 'element' || child.ns !== W_NS) continue;
    switch (child.local) {
      case 't':
        content.push(xmlText(child));
        break;
      case 'br': {
        const type = xmlAttr(child, W_NS, 'type');
        if (type === 'page') {
          // Authored page break: becomes ext `pagination` data with T20.6.
          reportOnce(ctx, 'authored page break not yet recorded (arrives with T20.6)');
        } else if (type !== 'column') {
          content.push(el('br'));
        }
        break;
      }
      case 'cr':
        content.push(el('br'));
        break;
      case 'tab':
        content.push(' ');
        break;
      case 'noBreakHyphen':
        content.push('-');
        break;
      case 'softHyphen':
        break;
      case 'drawing':
      case 'pict':
      case 'object':
        reportOnce(ctx, `image/drawing skipped (arrives with T20.5)`);
        break;
      case 'sym':
        reportOnce(ctx, 'symbol run (w:sym) dropped — private-use glyph');
        break;
      default:
        if (!RUN_NOISE.has(child.local)) {
          reportOnce(ctx, `unsupported run content <w:${child.local}> skipped`);
        }
    }
  }
  if (content.length === 0) return [];

  let nodes = content;
  const wrap = (tag: string): void => {
    nodes = [el(tag, {}, nodes)];
  };
  if (props.vertAlign === 'superscript') wrap('sup');
  if (props.vertAlign === 'subscript') wrap('sub');
  if (props.italic === true) wrap('em');
  if (props.bold === true) wrap('strong');
  const signature = signatureOf(runDecls(props));
  if (signature !== undefined) {
    const first = nodes[0];
    if (nodes.length === 1 && first !== undefined && isEl(first)) {
      first.attrs[STYLE_TMP_ATTR] = signature;
    } else {
      nodes = [el('span', { [STYLE_TMP_ATTR]: signature }, nodes)];
    }
  }
  return nodes;
}

/** Appends nodes, merging adjacent strings and identical inline wrappers. */
function appendInline(target: MNode[], nodes: MNode[]): void {
  for (const node of nodes) {
    const last = target[target.length - 1];
    if (typeof node === 'string' && typeof last === 'string') {
      target[target.length - 1] = last + node;
      continue;
    }
    if (
      last !== undefined &&
      typeof node !== 'string' &&
      typeof last !== 'string' &&
      node.tag === last.tag &&
      node.tag !== 'br' &&
      JSON.stringify(node.attrs) === JSON.stringify(last.attrs)
    ) {
      appendInline(last.children, node.children);
      continue;
    }
    target.push(node);
  }
}

/** Inline content of a paragraph-level container (p, hyperlink, ins…). */
function inlineContent(
  parent: XmlElement,
  paraStyleId: string | undefined,
  ctx: WmlContext,
): MNode[] {
  const out: MNode[] = [];
  for (const child of parent.children) {
    if (child.kind !== 'element' || child.ns !== W_NS) continue;
    switch (child.local) {
      case 'r':
        appendInline(out, runToNodes(child, paraStyleId, ctx));
        break;
      case 'hyperlink':
        // Link targets resolve through relationships at T20.5; the text
        // must not be lost meanwhile.
        reportOnce(ctx, 'hyperlink flattened to its text (targets arrive with T20.5)');
        appendInline(out, inlineContent(child, paraStyleId, ctx));
        break;
      case 'ins': // tracked insertion, accepted (final view, T20.7 policy)
      case 'smartTag':
      case 'sdt': {
        const inner = child.local === 'sdt' ? xmlChild(child, W_NS, 'sdtContent') : child;
        if (inner !== undefined) appendInline(out, inlineContent(inner, paraStyleId, ctx));
        break;
      }
      case 'del':
        reportOnce(ctx, 'tracked deletion dropped (final view)');
        break;
      case 'fldSimple':
        appendInline(out, inlineContent(child, paraStyleId, ctx));
        break;
      default:
        if (!PARA_NOISE.has(child.local)) {
          reportOnce(ctx, `unsupported paragraph content <w:${child.local}> skipped`);
        }
    }
  }
  return out;
}

/**
 * If every inline child is a wrapper carrying the SAME style signature, the
 * signature moves onto the paragraph (span wrappers unwrap) — one class on
 * the block instead of a span per run.
 */
function hoistUniformRunStyle(children: MNode[]): { children: MNode[]; signature?: string } {
  const elements = children.filter(isEl);
  if (elements.length === 0 || elements.length !== children.length) return { children };
  const first = elements[0]?.attrs[STYLE_TMP_ATTR];
  if (first === undefined) return { children };
  if (!elements.every((c) => c.attrs[STYLE_TMP_ATTR] === first)) return { children };
  const out: MNode[] = [];
  for (const child of elements) {
    delete child.attrs['__wdf_style']; // = STYLE_TMP_ATTR (lint: no dynamic delete)
    if (child.tag === 'span') {
      appendInline(out, child.children);
    } else {
      appendInline(out, [child]);
    }
  }
  return { children: out, signature: first };
}

/**
 * List membership of a paragraph, from its EFFECTIVE properties (numbering
 * may arrive through the style chain), or undefined for plain paragraphs:
 * numId absent or "0" (cancellation), or numFmt "none" (hidden number).
 */
function listInfoOf(direct: ParaProps, ctx: WmlContext): ListInfo | undefined {
  const effective = ctx.styles.effectivePara(direct);
  const numId = effective.numId;
  if (numId === undefined || numId === '0') return undefined;
  const level = effective.numIlvl ?? 0;
  const fmt = ctx.numbering.format(numId, level);
  if (fmt === 'none') return undefined;
  if (fmt === undefined) {
    reportOnce(ctx, 'list paragraph without a numbering definition rendered as a bullet list');
    return { level, ordered: false, numId };
  }
  if (fmt !== 'bullet' && !ORDERED_FORMATS.has(fmt)) {
    reportOnce(ctx, `exotic numbering format "${fmt}" rendered as a plain ordered list`);
  }
  return { level, ordered: fmt !== 'bullet', numId };
}

function paragraphToBlock(
  p: XmlElement,
  direct: ParaProps,
  tag: string,
  ctx: WmlContext,
): MEl | undefined {
  let children = inlineContent(p, direct.styleId, ctx);
  // Word expresses vertical rhythm with empty paragraphs; spacing is style.
  const text = children.map((c) => (typeof c === 'string' ? c : '')).join('');
  const hasContent = children.some((c) => typeof c !== 'string') || text.trim() !== '';
  if (!hasContent) return undefined;

  // Headings render bold natively: a strong wrapper is redundant semantics —
  // but its typographic signature must survive the unwrap.
  if (/^h[1-6]$/.test(tag)) {
    children = children.flatMap((c) => {
      if (!isEl(c) || c.tag !== 'strong') return [c];
      const sig = c.attrs[STYLE_TMP_ATTR];
      if (sig === undefined) return c.children;
      const only = c.children.length === 1 ? c.children[0] : undefined;
      if (only !== undefined && isEl(only)) {
        only.attrs[STYLE_TMP_ATTR] = mergeSignatures(only.attrs[STYLE_TMP_ATTR], sig) ?? sig;
        return [only];
      }
      return [el('span', { [STYLE_TMP_ATTR]: sig }, c.children)];
    });
  }

  const hoisted = hoistUniformRunStyle(children);
  const effective = ctx.styles.effectivePara(direct);
  if (tag === 'li') {
    // The list structure conveys indentation; translated margins would
    // double it (Word's ind on list items positions number and text).
    delete effective.indentLeft;
    delete effective.firstLine;
    delete effective.hanging;
  }
  const signature = mergeSignatures(signatureOf(paraDecls(effective)), hoisted.signature);
  const attrs: Record<string, string> = {};
  if (signature !== undefined) attrs[STYLE_TMP_ATTR] = signature;
  return el(tag, attrs, hoisted.children);
}

// ---------------------------------------------------------------------------
// Document conversion

export interface DocxConversion {
  blocks: MEl[];
  /** Document language from styles.xml docDefaults, when declared. */
  language: string | undefined;
  /** Generated stylesheet (hoisted classes), or undefined when unstyled. */
  stylesheet: string | undefined;
}

/** Locates and reads styles.xml via the main part's relationships. */
function stylesXmlOf(container: DocxContainer, mainPart: string): string | undefined {
  const rel = container.relationshipsOf(mainPart).find((r) => r.type === STYLES_REL);
  const name = rel === undefined ? 'word/styles.xml' : resolveTarget(mainPart, rel.target);
  return container.partText(name);
}

/** Locates and reads numbering.xml via the main part's relationships. */
function numberingXmlOf(container: DocxContainer, mainPart: string): string | undefined {
  const rel = container.relationshipsOf(mainPart).find((r) => r.type === NUMBERING_REL);
  const name = rel === undefined ? 'word/numbering.xml' : resolveTarget(mainPart, rel.target);
  return container.partText(name);
}

/**
 * Converts the paragraphs of a .docx into importer blocks (T20.2 scope:
 * paragraphs/runs/styles/headings — tables, images, hyperlink targets,
 * notes and fields arrive with T20.4–T20.7 and are reported meanwhile).
 */
export function convertDocx(input: Uint8Array | DocxContainer, report: string[]): DocxConversion {
  const container = input instanceof Uint8Array ? openDocx(input) : input;
  const mainPart = container.mainDocumentPart();
  const mainXml = container.partText(mainPart);
  if (mainXml === undefined) throw new Error(`main part ${mainPart} is unreadable`);
  const styles = new DocxStyles(stylesXmlOf(container, mainPart));
  const numbering = new DocxNumbering(numberingXmlOf(container, mainPart));
  const ctx: WmlContext = { styles, numbering, report, reported: new Set() };

  const body = xmlChild(parseXml(mainXml), W_NS, 'body');
  const blocks: MEl[] = [];
  const lists = new ListAssembler();
  let emptyParagraphs = 0;

  const walkBody = (parent: XmlElement): void => {
    for (const child of parent.children) {
      if (child.kind !== 'element' || child.ns !== W_NS) continue;
      switch (child.local) {
        case 'p': {
          const direct = parsePPr(xmlChild(child, W_NS, 'pPr'));
          const level = ctx.styles.headingLevel(direct);
          const listInfo = level === undefined ? listInfoOf(direct, ctx) : undefined;
          if (level !== undefined && listInfoOf(direct, ctx) !== undefined) {
            reportOnce(
              ctx,
              'numbered heading: the list number is dropped (headings are not list items)',
            );
          }
          const tag =
            level !== undefined ? `h${String(level)}` : listInfo !== undefined ? 'li' : 'p';
          const block = paragraphToBlock(child, direct, tag, ctx);
          if (block === undefined) {
            emptyParagraphs += 1;
            break;
          }
          if (listInfo !== undefined) {
            lists.add(listInfo, block, blocks, ctx);
          } else {
            lists.flush();
            blocks.push(block);
          }
          break;
        }
        case 'tbl':
          lists.flush();
          reportOnce(ctx, 'table skipped (arrives with T20.4)');
          break;
        case 'sdt': {
          const content = xmlChild(child, W_NS, 'sdtContent');
          if (content !== undefined) walkBody(content);
          break;
        }
        case 'sectPr': // section properties: headers/footers/page breaks, T20.6
        case 'bookmarkStart': // markers, not content (ids arrive with T20.5)
        case 'bookmarkEnd':
          break;
        default:
          reportOnce(ctx, `unsupported body element <w:${child.local}> skipped`);
      }
    }
  };
  if (body !== undefined) walkBody(body);

  if (emptyParagraphs > 0) {
    report.push(
      `dropped ${String(emptyParagraphs)} empty paragraph${emptyParagraphs === 1 ? '' : 's'} (spacing is translated style, not content)`,
    );
  }

  return { blocks, language: styles.language, stylesheet: hoistStyles(blocks) };
}
