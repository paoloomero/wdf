import { computeTableGrid, sha256Hex } from '@wdf-dev/core';

import { el, isEl, slugify, textOf, type MEl, type MNode } from '../ast.js';
import { DEFAULT_CAPS, identifyImage, type AssetCaps, type LoadedAsset } from '../assets.js';
import { hoistStyles, sanitizeDeclarations, STYLE_TMP_ATTR, type Decls } from '../styles.js';
import { openDocx, resolveTarget, type DocxContainer, type Relationship } from './container.js';
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
/** DrawingML namespaces (T20.5): images travel as a:blip r:embed → rels. */
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
/** Namespace of r:id / r:embed attributes. */
const R_OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

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
// Table properties (T20.4): borders and shading

interface BorderSpec {
  /** true = a visible line; false = explicitly none/nil. */
  readonly visible: boolean;
  /** Eighths of a point (w:sz). */
  readonly size: number;
  /** RRGGBB hex or undefined for "auto". */
  readonly color: string | undefined;
}

interface TableBorders {
  top?: BorderSpec;
  bottom?: BorderSpec;
  left?: BorderSpec;
  right?: BorderSpec;
  insideH?: BorderSpec;
  insideV?: BorderSpec;
}

const BORDER_SIDES = ['top', 'bottom', 'left', 'right', 'insideH', 'insideV'] as const;

function parseTblBorders(tblPr: XmlElement | undefined): TableBorders {
  const out: TableBorders = {};
  const borders = tblPr === undefined ? undefined : xmlChild(tblPr, W_NS, 'tblBorders');
  if (borders === undefined) return out;
  for (const side of BORDER_SIDES) {
    const b = xmlChild(borders, W_NS, side);
    if (b === undefined) continue;
    const val = xmlAttr(b, W_NS, 'val') ?? 'single';
    const color = xmlAttr(b, W_NS, 'color');
    out[side] = {
      visible: val !== 'none' && val !== 'nil',
      size: twips(xmlAttr(b, W_NS, 'sz')) ?? 4,
      color:
        color !== undefined && /^[0-9A-Fa-f]{6}$/.test(color) ? color.toLowerCase() : undefined,
    };
  }
  return out;
}

function mergeBorders(base: TableBorders, over: TableBorders): TableBorders {
  const out: TableBorders = { ...base };
  for (const side of BORDER_SIDES) {
    const b = over[side];
    if (b !== undefined) out[side] = b;
  }
  return out;
}

/** CSS border value: eighths-of-a-point width (min 0.5pt for visibility). */
function borderCss(b: BorderSpec): string {
  const width = Math.max(0.5, Math.round((b.size / 8) * 4) / 4);
  return `${String(width)}pt solid #${b.color ?? '000000'}`;
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
  /** Table borders of a w:type="table" style (T20.4). */
  readonly tbl: TableBorders;
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
        tbl: parseTblBorders(xmlChild(style, W_NS, 'tblPr')),
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

  /** Effective table borders: style chain (w:tblStyle) then direct tblPr. */
  effectiveTableBorders(styleId: string | undefined, direct: TableBorders): TableBorders {
    let borders: TableBorders = {};
    for (const style of this.chain(styleId)) {
      borders = mergeBorders(borders, style.tbl);
    }
    return mergeBorders(borders, direct);
  }

  /** True when the paragraph uses the built-in "caption" style. */
  isCaption(direct: ParaProps): boolean {
    return this.chain(direct.styleId).some((s) => s.name === 'caption');
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
  /** Container access for media parts (T20.5). */
  readonly container: DocxContainer;
  readonly mainPart: string;
  /** Main-part relationships by id (images, hyperlinks). */
  readonly rels: ReadonlyMap<string, Relationship>;
  readonly caps: AssetCaps;
  /** Media parts referenced by emitted <img> (src = part name until resolution). */
  readonly media: Map<string, { bytes: Uint8Array; ext: string; mediaType: string }>;
  /** Bookmark name → generated element id, for names a hyperlink references. */
  readonly bookmarkIds: ReadonlyMap<string, string>;
  /** Shared across part contexts (header/footer, T20.6): global caps. */
  readonly mediaTotal: { bytes: number };
  /** Footnotes/endnotes (T20.7): content by id, and the reference order. */
  readonly notes: NotesRegistry;
}

/** OOXML math namespace (T20.7): formulas flatten to their text. */
const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const FOOTNOTES_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';
const ENDNOTES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes';

interface NoteRef {
  readonly number: number;
  readonly kind: 'footnote' | 'endnote';
  readonly noteId: string;
  /** Whether the backlink target (noteref-N) has been emitted already. */
  refIdEmitted: boolean;
}

interface NotesRegistry {
  /** 'footnote:3' → assigned reference. Numbers are first-reference order. */
  readonly byKey: Map<string, NoteRef>;
  /** w:footnote elements by w:id (separators excluded). */
  readonly footnotes: Map<string, XmlElement>;
  readonly endnotes: Map<string, XmlElement>;
  footnotesPart: string | undefined;
  endnotesPart: string | undefined;
}

/** Loads a notes part (footnotes.xml / endnotes.xml) into an id → element map. */
function loadNotesPart(
  container: DocxContainer,
  mainPart: string,
  relType: string,
  fallback: string,
  local: 'footnote' | 'endnote',
): { part: string | undefined; byId: Map<string, XmlElement> } {
  const rel = container.relationshipsOf(mainPart).find((r) => r.type === relType);
  const part = rel === undefined ? fallback : resolveTarget(mainPart, rel.target);
  const xml = container.partText(part);
  const byId = new Map<string, XmlElement>();
  if (xml === undefined) return { part: undefined, byId };
  for (const note of xmlChildren(parseXml(xml), W_NS, local)) {
    const type = xmlAttr(note, W_NS, 'type');
    if (type === 'separator' || type === 'continuationSeparator') continue;
    const id = xmlAttr(note, W_NS, 'id');
    if (id !== undefined) byId.set(id, note);
  }
  return { part, byId };
}

/** A context for another part (header/footer): same document, its own rels. */
function partContext(ctx: WmlContext, partName: string): WmlContext {
  return {
    ...ctx,
    mainPart: partName,
    rels: new Map(ctx.container.relationshipsOf(partName).map((r) => [r.id, r])),
  };
}

/** Reports once per distinct message — real documents repeat everything. */
function reportOnce(ctx: WmlContext, message: string): void {
  if (ctx.reported.has(message)) return;
  ctx.reported.add(message);
  ctx.report.push(message);
}

/** First descendant with the given (namespace, local name), depth first. */
function findDescendant(root: XmlElement, ns: string, local: string): XmlElement | undefined {
  for (const child of root.children) {
    if (child.kind !== 'element') continue;
    if (child.ns === ns && child.local === local) return child;
    const found = findDescendant(child, ns, local);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Emits an <img> for a media relationship (T20.5). The src carries the PART
 * NAME until the asset-resolution phase hashes the bytes and rewrites it to
 * content/assets/<hash>.<ext> — the same naming the HTML importer uses.
 */
function emitImage(
  relId: string | undefined,
  alt: string,
  width: number,
  height: number,
  ctx: WmlContext,
): MEl | undefined {
  if (relId === undefined) {
    reportOnce(ctx, 'image without a relationship reference dropped');
    return undefined;
  }
  const rel = ctx.rels.get(relId);
  if (rel === undefined) {
    ctx.report.push(`dropped image (missing relationship ${relId})`);
    return undefined;
  }
  if (rel.targetMode === 'External') {
    ctx.report.push(
      `dropped external image reference "${rel.target}" (images come from the package, never the network)`,
    );
    return undefined;
  }
  const part = resolveTarget(ctx.mainPart, rel.target);
  const known = ctx.media.get(part);
  if (known === undefined) {
    const bytes = ctx.container.part(part);
    if (bytes === undefined) {
      ctx.report.push(`dropped image (media part ${part} is missing)`);
      return undefined;
    }
    const kind = identifyImage(bytes);
    if (kind === undefined) {
      const ext = part.slice(part.lastIndexOf('.') + 1).toLowerCase();
      ctx.report.push(
        `dropped image ${part} (format "${ext}" is not web-renderable — legacy formats need conversion)`,
      );
      return undefined;
    }
    if (ctx.media.size >= ctx.caps.maxCount) {
      ctx.report.push(`dropped image ${part} (max ${String(ctx.caps.maxCount)} images reached)`);
      return undefined;
    }
    if (bytes.length > ctx.caps.perFile) {
      ctx.report.push(`dropped image ${part} (exceeds per-file size limit)`);
      return undefined;
    }
    if (ctx.mediaTotal.bytes + bytes.length > ctx.caps.totalBytes) {
      ctx.report.push(`dropped image ${part} (total asset size limit reached)`);
      return undefined;
    }
    ctx.media.set(part, { bytes, ext: kind.ext, mediaType: kind.mediaType });
    ctx.mediaTotal.bytes += bytes.length;
  }
  const attrs: Record<string, string> = { src: part, alt };
  if (width > 0) attrs['width'] = String(width);
  if (height > 0) attrs['height'] = String(height);
  return el('img', attrs);
}

/** <img> from a w:drawing (DrawingML): blip r:embed, extent, docPr alt. */
function imageFromDrawing(drawing: XmlElement, ctx: WmlContext): MEl | undefined {
  if (findDescendant(drawing, WP_NS, 'anchor') !== undefined) {
    reportOnce(
      ctx,
      'floating image anchored inline at its paragraph (fixed layout is not preserved)',
    );
  }
  const blip = findDescendant(drawing, A_NS, 'blip');
  if (blip === undefined) {
    const data = findDescendant(drawing, A_NS, 'graphicData');
    const uri = data === undefined ? '' : (xmlAttr(data, '', 'uri') ?? '');
    const what = /chart/i.test(uri)
      ? 'chart'
      : /diagram/i.test(uri)
        ? 'SmartArt diagram'
        : 'drawing';
    reportOnce(
      ctx,
      `${what} without an embedded picture dropped (needs rendering — not representable in core 0.1)`,
    );
    return undefined;
  }
  const docPr = findDescendant(drawing, WP_NS, 'docPr');
  const alt = docPr === undefined ? '' : (xmlAttr(docPr, '', 'descr') ?? '');
  const extent = findDescendant(drawing, WP_NS, 'extent');
  // EMU → CSS px at 96dpi: 9525 EMU per pixel.
  const px = (v: string | undefined): number => Math.round((twips(v) ?? 0) / 9525);
  return emitImage(
    xmlAttr(blip, R_OFFICE, 'embed'),
    alt,
    px(extent === undefined ? undefined : xmlAttr(extent, '', 'cx')),
    px(extent === undefined ? undefined : xmlAttr(extent, '', 'cy')),
    ctx,
  );
}

/** <img> from legacy VML (w:pict / w:object): v:imagedata r:id. */
function imageFromVml(pict: XmlElement, ctx: WmlContext): MEl | undefined {
  let imagedata: XmlElement | undefined;
  const walk = (node: XmlElement): void => {
    for (const child of node.children) {
      if (child.kind !== 'element') continue;
      if (child.local === 'imagedata') {
        imagedata ??= child;
        return;
      }
      walk(child);
    }
  };
  walk(pict);
  if (imagedata === undefined) {
    reportOnce(ctx, 'legacy shape (VML) without an image skipped');
    return undefined;
  }
  const relId = xmlAttr(imagedata, R_OFFICE, 'id') ?? xmlAttr(imagedata, '', 'id');
  const alt = xmlAttr(imagedata, '', 'title') ?? '';
  return emitImage(relId, alt, 0, 0, ctx);
}

/**
 * A footnote/endnote reference (T20.7): notes move to the final Notes
 * section; the reference becomes a sup-wrapped fragment link. Numbers are
 * unified across kinds, in first-reference order; the FIRST reference
 * carries the backlink target id.
 */
function noteReference(
  kind: 'footnote' | 'endnote',
  noteId: string | undefined,
  ctx: WmlContext,
): MEl | undefined {
  if (noteId === undefined) return undefined;
  const source = kind === 'footnote' ? ctx.notes.footnotes : ctx.notes.endnotes;
  if (!source.has(noteId)) {
    reportOnce(ctx, `${kind} reference without a matching note dropped`);
    return undefined;
  }
  const key = `${kind}:${noteId}`;
  let ref = ctx.notes.byKey.get(key);
  if (ref === undefined) {
    ref = { number: ctx.notes.byKey.size + 1, kind, noteId, refIdEmitted: false };
    ctx.notes.byKey.set(key, ref);
  }
  const attrs: Record<string, string> = {};
  if (!ref.refIdEmitted) {
    attrs['id'] = `noteref-${String(ref.number)}`;
    ref.refIdEmitted = true;
  }
  return el('sup', attrs, [el('a', { href: `#note-${String(ref.number)}` }, [String(ref.number)])]);
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
          // Authored page break: collected per paragraph (T20.6) — the br
          // itself renders nothing.
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
      case 'drawing': {
        const img = imageFromDrawing(child, ctx);
        if (img !== undefined) content.push(img);
        break;
      }
      case 'pict':
      case 'object': {
        const img = imageFromVml(child, ctx);
        if (img !== undefined) content.push(img);
        break;
      }
      case 'sym':
        reportOnce(ctx, 'symbol run (w:sym) dropped — private-use glyph');
        break;
      case 'footnoteRef': // the marker inside the note's own text: skip
      case 'endnoteRef':
        break;
      case 'footnoteReference':
      case 'endnoteReference': {
        const sup = noteReference(
          child.local === 'footnoteReference' ? 'footnote' : 'endnote',
          xmlAttr(child, W_NS, 'id'),
          ctx,
        );
        if (sup !== undefined) content.push(sup);
        break;
      }
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
    if (child.kind !== 'element') continue;
    if (child.ns === M_NS) {
      // OMML math (T20.7): MathML is excluded from core 0.1 — the formula
      // flattens to its plain text so no content is lost silently.
      const text = xmlText(child).trim();
      if (text !== '') {
        reportOnce(ctx, 'math formula flattened to its text (MathML is excluded from core 0.1)');
        appendInline(out, [text]);
      }
      continue;
    }
    if (child.ns !== W_NS) continue;
    switch (child.local) {
      case 'r':
        appendInline(out, runToNodes(child, paraStyleId, ctx));
        break;
      case 'hyperlink': {
        const inner = inlineContent(child, paraStyleId, ctx);
        if (inner.length === 0) break;
        const relId = xmlAttr(child, R_OFFICE, 'id');
        const anchor = xmlAttr(child, W_NS, 'anchor') ?? xmlAttr(child, '', 'anchor');
        let href: string | undefined;
        if (relId !== undefined) {
          const rel = ctx.rels.get(relId);
          if (rel !== undefined && rel.targetMode === 'External') {
            if (/^(https?:|mailto:)/i.test(rel.target)) {
              href = rel.target;
            } else {
              ctx.report.push(`unwrapped link to "${rel.target}" (scheme not allowed)`);
            }
          } else {
            reportOnce(ctx, 'unwrapped hyperlink without a resolvable external target');
          }
        } else if (anchor !== undefined) {
          const id = ctx.bookmarkIds.get(anchor);
          if (id !== undefined) {
            href = `#${id}`;
          } else {
            reportOnce(ctx, 'unwrapped link to a bookmark that does not exist in the document');
          }
        }
        appendInline(out, href === undefined ? inner : [el('a', { href }, inner)]);
        break;
      }
      case 'ins': // tracked insertion, accepted (final view, T20.7 policy)
      case 'moveTo': // tracked move destination: the final position
      case 'smartTag':
      case 'sdt': {
        const inner = child.local === 'sdt' ? xmlChild(child, W_NS, 'sdtContent') : child;
        if (inner !== undefined) appendInline(out, inlineContent(inner, paraStyleId, ctx));
        break;
      }
      case 'del':
      case 'moveFrom':
        reportOnce(ctx, 'tracked deletion dropped (final view)');
        break;
      case 'fldSimple': {
        const instr = xmlAttr(child, W_NS, 'instr') ?? '';
        if (/^\s*TOC\b/.test(instr)) {
          reportOnce(ctx, 'table of contents dropped (the outline is derived from headings, §7.3)');
          break;
        }
        appendInline(out, inlineContent(child, paraStyleId, ctx));
        break;
      }
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
  // A referenced bookmark starting in this paragraph anchors here (T20.5):
  // the block carries the generated id, internal links resolve to it.
  for (const name of bookmarkNames(p)) {
    const id = ctx.bookmarkIds.get(name);
    if (id !== undefined) {
      attrs['id'] = id;
      break;
    }
  }
  return el(tag, attrs, hoisted.children);
}

/** Names of every w:bookmarkStart in the subtree, document order. */
function bookmarkNames(root: XmlElement): string[] {
  const out: string[] = [];
  const walk = (node: XmlElement): void => {
    for (const child of node.children) {
      if (child.kind !== 'element') continue;
      if (child.ns === W_NS && child.local === 'bookmarkStart') {
        const name = xmlAttr(child, W_NS, 'name');
        if (name !== undefined) out.push(name);
      }
      walk(child);
    }
  };
  walk(root);
  return out;
}

// ---------------------------------------------------------------------------
// Tables (T20.4): gridSpan → colspan, vMerge → rowspan, on the WP11 model

interface RawCell {
  readonly tc: XmlElement;
  readonly colspan: number;
  readonly vMerge: 'restart' | 'continue' | undefined;
  /** Leftmost grid column this cell occupies. */
  readonly col: number;
  /** RRGGBB shading fill, when declared and concrete. */
  readonly shd: string | undefined;
  rowspan: number;
}

/** Removes <br> from cell content at any depth (§6.2.8 forbids it there). */
function stripBr(nodes: MNode[]): MNode[] {
  return nodes.flatMap((n): MNode[] => {
    if (!isEl(n)) return [n];
    if (n.tag === 'br') return [];
    n.children = stripBr(n.children);
    return [n];
  });
}

/** The w:p descendants of a cell, nested tables flattened with a report. */
function cellParagraphs(tc: XmlElement, ctx: WmlContext): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (parent: XmlElement): void => {
    for (const child of parent.children) {
      if (child.kind !== 'element' || child.ns !== W_NS) continue;
      if (child.local === 'p') {
        out.push(child);
      } else if (child.local === 'tbl') {
        reportOnce(ctx, 'nested table flattened into its cell (§6.2.8: cells hold phrasing)');
        walk(child);
      } else if (['tr', 'tc', 'sdt', 'sdtContent'].includes(child.local)) {
        walk(child);
      }
    }
  };
  walk(tc);
  return out;
}

function tableToBlock(tbl: XmlElement, caption: string, ctx: WmlContext): MEl | undefined {
  const trs = xmlChildren(tbl, W_NS, 'tr');
  if (trs.length === 0) {
    ctx.report.push('dropped a table with no rows');
    return undefined;
  }
  const tblPr = xmlChild(tbl, W_NS, 'tblPr');
  const styleId = tblPr === undefined ? undefined : wVal(tblPr, 'tblStyle');
  const borders = ctx.styles.effectiveTableBorders(styleId, parseTblBorders(tblPr));

  const rawRows: RawCell[][] = trs.map((tr) => {
    let col = 0;
    return xmlChildren(tr, W_NS, 'tc').map((tc) => {
      const tcPr = xmlChild(tc, W_NS, 'tcPr');
      const span = tcPr === undefined ? undefined : twips(wVal(tcPr, 'gridSpan'));
      const vm = tcPr === undefined ? undefined : xmlChild(tcPr, W_NS, 'vMerge');
      const fill =
        tcPr === undefined
          ? undefined
          : (() => {
              const shd = xmlChild(tcPr, W_NS, 'shd');
              return shd === undefined ? undefined : xmlAttr(shd, W_NS, 'fill');
            })();
      const cell: RawCell = {
        tc,
        colspan: span !== undefined && span >= 2 ? span : 1,
        vMerge:
          vm === undefined
            ? undefined
            : xmlAttr(vm, W_NS, 'val') === 'restart'
              ? 'restart'
              : 'continue',
        col,
        shd: fill !== undefined && /^[0-9A-Fa-f]{6}$/.test(fill) ? fill.toLowerCase() : undefined,
        rowspan: 1,
      };
      col += cell.colspan;
      return cell;
    });
  });

  // vMerge: the restart cell spans over the continue cells below it (same
  // grid column); continue cells leave the output.
  for (const [i, row] of rawRows.entries()) {
    for (const cell of row) {
      if (cell.vMerge !== 'restart') continue;
      for (let j = i + 1; j < rawRows.length; j++) {
        const cont = rawRows[j]?.find((c) => c.col === cell.col && c.vMerge === 'continue');
        if (cont === undefined) break;
        cell.rowspan += 1;
      }
    }
  }
  const outRows = rawRows.map((row) => row.filter((c) => c.vMerge !== 'continue'));

  // Merged cells survive when the grid is exactly rectangular (§6.2.8);
  // otherwise every span is stripped and rows are padded — same policy as
  // the HTML importer (WP11).
  const [firstRow, ...restRows] = outRows;
  const spanGroups = [
    [(firstRow ?? []).map((c) => ({ colspan: c.colspan, rowspan: c.rowspan }))],
    restRows.map((r) => r.map((c) => ({ colspan: c.colspan, rowspan: c.rowspan }))),
  ];
  const spansPresent = outRows.flat().some((c) => c.colspan > 1 || c.rowspan > 1);
  const keepSpans = spansPresent && computeTableGrid(spanGroups).problems.length === 0;
  if (spansPresent) {
    ctx.report.push(
      keepSpans
        ? 'kept merged cells (colspan/rowspan)'
        : 'dropped colspan/rowspan (table grid could not be reconciled)',
    );
  }
  const width = Math.max(...outRows.map((r) => r.length));

  const inside = [borders.insideH, borders.insideV].find((b) => b?.visible === true);
  const cellOf = (cell: RawCell, tag: 'th' | 'td'): MEl => {
    const parts: MNode[] = [];
    let align: string | undefined;
    for (const p of cellParagraphs(cell.tc, ctx)) {
      const direct = parsePPr(xmlChild(p, W_NS, 'pPr'));
      const inline = stripBr(inlineContent(p, direct.styleId, ctx));
      if (inline.length === 0) continue;
      align ??= ctx.styles.effectivePara(direct).jc;
      if (parts.length > 0) appendInline(parts, [' ']);
      appendInline(parts, inline);
    }
    const hoisted = hoistUniformRunStyle(parts);
    const decls: Decls = new Map();
    if (inside !== undefined) decls.set('border', borderCss(inside));
    if (cell.shd !== undefined) decls.set('background-color', `#${cell.shd}`);
    if (align !== undefined) {
      const mapped = { both: 'justify', start: 'left', end: 'right' }[align] ?? align;
      if (/^(left|right|center|justify)$/.test(mapped)) decls.set('text-align', mapped);
    }
    const signature = mergeSignatures(signatureOf(decls), hoisted.signature);
    const attrs: Record<string, string> = {};
    if (signature !== undefined) attrs[STYLE_TMP_ATTR] = signature;
    if (keepSpans) {
      if (cell.colspan > 1) attrs['colspan'] = String(cell.colspan);
      if (cell.rowspan > 1) attrs['rowspan'] = String(cell.rowspan);
    }
    return el(tag, attrs, hoisted.children);
  };
  const rowOf = (row: RawCell[], tag: 'th' | 'td'): MEl => {
    const cells = row.map((c) => cellOf(c, tag));
    if (!keepSpans) {
      while (cells.length < width) cells.push(el(tag));
    }
    return el('tr', {}, cells);
  };

  const tableDecls: Decls = new Map();
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const b = borders[side];
    if (b?.visible === true) tableDecls.set(`border-${side}`, borderCss(b));
  }
  const tableAttrs: Record<string, string> = {};
  const tableSignature = signatureOf(tableDecls);
  if (tableSignature !== undefined) tableAttrs[STYLE_TMP_ATTR] = tableSignature;

  if (caption === '') ctx.report.push('synthesized empty <caption> for a table');
  const bodyRows = restRows;
  if (bodyRows.length === 0) {
    ctx.report.push('table had a single row: kept as header with empty body');
  }
  return el('table', tableAttrs, [
    el('caption', {}, caption === '' ? [] : [caption]),
    el('thead', {}, [rowOf(firstRow ?? [], 'th')]),
    el(
      'tbody',
      {},
      bodyRows.map((r) => rowOf(r, 'td')),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Document conversion

export interface DocxConversion {
  blocks: MEl[];
  /** Document language from styles.xml docDefaults, when declared. */
  language: string | undefined;
  /** Generated stylesheet (hoisted classes), or undefined when unstyled. */
  stylesheet: string | undefined;
  /** Packaged images (content-hashed under content/assets/, T20.5). */
  assets: LoadedAsset[];
  /**
   * Blocks an AUTHORED page break lands before (T20.6) — references into
   * `blocks`. Ids exist only after ensureIds: the caller derives the
   * ext-pagination breakBefore list from these elements' ids.
   */
  pageBreakBlocks: MEl[];
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
 * Converts the body of a .docx into importer blocks: paragraphs, runs and
 * styles (T20.2), lists (T20.3), tables (T20.4) — images, hyperlink
 * targets, notes and fields arrive with T20.5–T20.7 and are reported
 * meanwhile.
 */
export async function convertDocx(
  input: Uint8Array | DocxContainer,
  report: string[],
  caps: AssetCaps = DEFAULT_CAPS,
): Promise<DocxConversion> {
  const container = input instanceof Uint8Array ? openDocx(input) : input;
  const mainPart = container.mainDocumentPart();
  const mainXml = container.partText(mainPart);
  if (mainXml === undefined) throw new Error(`main part ${mainPart} is unreadable`);
  const styles = new DocxStyles(stylesXmlOf(container, mainPart));
  const numbering = new DocxNumbering(numberingXmlOf(container, mainPart));
  const root = parseXml(mainXml);

  // Bookmark prepass (T20.5): only names some hyperlink actually references
  // become element ids — no id litter from Word's internal bookmarks.
  const referenced = new Set<string>();
  const collectAnchors = (node: XmlElement): void => {
    for (const child of node.children) {
      if (child.kind !== 'element') continue;
      if (child.ns === W_NS && child.local === 'hyperlink') {
        const anchor = xmlAttr(child, W_NS, 'anchor') ?? xmlAttr(child, '', 'anchor');
        if (anchor !== undefined) referenced.add(anchor);
      }
      collectAnchors(child);
    }
  };
  collectAnchors(root);
  const bookmarkIds = new Map<string, string>();
  const usedIds = new Set<string>();
  for (const name of bookmarkNames(root)) {
    if (!referenced.has(name) || bookmarkIds.has(name)) continue;
    const slug = slugify(name);
    let id = `bm-${slug === '' ? String(bookmarkIds.size + 1) : slug}`;
    let n = 2;
    while (usedIds.has(id)) id = `bm-${slug}-${String(n++)}`;
    usedIds.add(id);
    bookmarkIds.set(name, id);
  }

  const loadedFootnotes = loadNotesPart(
    container,
    mainPart,
    FOOTNOTES_REL,
    'word/footnotes.xml',
    'footnote',
  );
  const loadedEndnotes = loadNotesPart(
    container,
    mainPart,
    ENDNOTES_REL,
    'word/endnotes.xml',
    'endnote',
  );
  const ctx: WmlContext = {
    styles,
    numbering,
    report,
    reported: new Set(),
    container,
    mainPart,
    rels: new Map(container.relationshipsOf(mainPart).map((r) => [r.id, r])),
    caps,
    media: new Map(),
    bookmarkIds,
    mediaTotal: { bytes: 0 },
    notes: {
      byKey: new Map(),
      footnotes: loadedFootnotes.byId,
      endnotes: loadedEndnotes.byId,
      footnotesPart: loadedFootnotes.part,
      endnotesPart: loadedEndnotes.part,
    },
  };

  const body = xmlChild(root, W_NS, 'body');
  const bodyResult =
    body === undefined ? { blocks: [], empty: 0, pageBreaks: [] } : convertBlocks(body, ctx, true);
  const blocks = bodyResult.blocks;
  const pageBreakBlocks = bodyResult.pageBreaks;
  let emptyParagraphs = bodyResult.empty;

  // Page header/footer (T20.6, T14.1 policy): the body's trailing sectPr
  // names the parts; the first-page variant wins only when w:titlePg
  // activates it, the even-page variant is never used. Header/footer parts
  // carry their OWN relationships (images resolve against them).
  const sectPr = body === undefined ? undefined : xmlChild(body, W_NS, 'sectPr');
  if (sectPr !== undefined) {
    const titlePg = onOff(xmlChild(sectPr, W_NS, 'titlePg')) === true;
    for (const kind of ['header', 'footer'] as const) {
      const refs = xmlChildren(sectPr, W_NS, `${kind}Reference`);
      const byType = (t: string): XmlElement | undefined =>
        refs.find((r) => (xmlAttr(r, W_NS, 'type') ?? 'default') === t);
      const ref = (titlePg ? byType('first') : undefined) ?? byType('default');
      if (ref === undefined) continue;
      const relId = xmlAttr(ref, R_OFFICE, 'id');
      const rel = relId === undefined ? undefined : ctx.rels.get(relId);
      if (rel === undefined || rel.targetMode === 'External') continue;
      const part = resolveTarget(mainPart, rel.target);
      const partXml = container.partText(part);
      if (partXml === undefined) continue;
      const partResult = convertBlocks(parseXml(partXml), partContext(ctx, part), false);
      emptyParagraphs += partResult.empty;
      if (partResult.blocks.length === 0) continue; // empty containers are pruned (T14.1)
      if (kind === 'header') {
        blocks.unshift(el('header', {}, partResult.blocks));
      } else {
        blocks.push(el('footer', {}, partResult.blocks));
      }
      report.push(`imported page ${kind} (${part})`);
    }
  }

  // Notes section (T20.7): referenced footnotes/endnotes become a final
  // "Note"/"Notes" section — an ordered list whose numbering matches the
  // sup references; each item ends with a backlink to its first reference.
  if (ctx.notes.byKey.size > 0) {
    const items: MEl[] = [];
    for (const ref of [...ctx.notes.byKey.values()].sort((a, b) => a.number - b.number)) {
      const source = ref.kind === 'footnote' ? ctx.notes.footnotes : ctx.notes.endnotes;
      const partName = ref.kind === 'footnote' ? ctx.notes.footnotesPart : ctx.notes.endnotesPart;
      const note = source.get(ref.noteId);
      if (note === undefined || partName === undefined) continue;
      const noteCtx = partContext(ctx, partName);
      const parts: MNode[] = [];
      for (const para of xmlChildren(note, W_NS, 'p')) {
        const direct = parsePPr(xmlChild(para, W_NS, 'pPr'));
        const inline = inlineContent(para, direct.styleId, noteCtx);
        if (inline.length === 0) continue;
        if (parts.length > 0) appendInline(parts, [' ']);
        appendInline(parts, inline);
      }
      if (ref.refIdEmitted) {
        appendInline(parts, [' ']);
        parts.push(el('a', { href: `#noteref-${String(ref.number)}` }, ['\u21a9']));
      }
      items.push(el('li', { id: `note-${String(ref.number)}` }, parts));
    }
    if (items.length > 0) {
      const heading = (styles.language ?? '').toLowerCase().startsWith('it') ? 'Note' : 'Notes';
      const notesBlocks = [el('h2', {}, [heading]), el('ol', {}, items)];
      const footerAt = blocks.findIndex((b) => b.tag === 'footer');
      blocks.splice(footerAt === -1 ? blocks.length : footerAt, 0, ...notesBlocks);
      report.push(
        `moved ${String(items.length)} note${items.length === 1 ? '' : 's'} to the final ${heading} section (footnotes/endnotes)`,
      );
    }
  }

  if (emptyParagraphs > 0) {
    report.push(
      `dropped ${String(emptyParagraphs)} empty paragraph${emptyParagraphs === 1 ? '' : 's'} (spacing is translated style, not content)`,
    );
  }
  if (pageBreakBlocks.length > 0) {
    report.push(
      `recorded ${String(pageBreakBlocks.length)} authored page break${pageBreakBlocks.length === 1 ? '' : 's'} (extension pagination, docs/ext-pagination.md)`,
    );
  }

  // Asset resolution (T20.5): hash the referenced media parts, rewrite the
  // interim src (part name) to content/assets/<hash>.<ext> — identical
  // naming and dedup to the HTML importer's pipeline.
  const assets = new Map<string, LoadedAsset>();
  const partToPath = new Map<string, string>();
  for (const [part, media] of [...ctx.media.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const path = `content/assets/${(await sha256Hex(media.bytes)).slice(0, 16)}.${media.ext}`;
    partToPath.set(part, path);
    if (!assets.has(path)) {
      assets.set(path, { path, mediaType: media.mediaType, bytes: media.bytes });
    }
    report.push(`imported image "${part}" → ${path}`);
  }
  if (partToPath.size > 0) {
    const rewrite = (node: MEl): void => {
      if (node.tag === 'img') {
        const mapped = partToPath.get(node.attrs['src'] ?? '');
        if (mapped !== undefined) node.attrs['src'] = mapped;
      }
      for (const child of node.children) {
        if (isEl(child)) rewrite(child);
      }
    };
    for (const block of blocks) rewrite(block);
  }

  return {
    blocks,
    language: styles.language,
    stylesheet: hoistStyles(blocks),
    assets: [...assets.values()],
    pageBreakBlocks,
  };
}

interface BlockContainerResult {
  blocks: MEl[];
  empty: number;
  /** Blocks an authored page break lands BEFORE, document order (T20.6). */
  pageBreaks: MEl[];
}

/**
 * Position of the first authored page break of a paragraph relative to its
 * content, or undefined. A paragraph-level section break (w:pPr>w:sectPr,
 * type other than "continuous") breaks after the paragraph.
 */
function pageBreakPosition(p: XmlElement): 'before' | 'after' | undefined {
  let seenContent = false;
  let found: 'before' | 'after' | undefined;
  const walk = (node: XmlElement): boolean => {
    for (const child of node.children) {
      if (child.kind !== 'element') continue;
      if (child.ns === W_NS && child.local === 'pPr') continue; // properties, not content
      if (child.ns === W_NS && child.local === 'br' && xmlAttr(child, W_NS, 'type') === 'page') {
        found = seenContent ? 'after' : 'before';
        return true;
      }
      if (child.ns === W_NS && child.local === 't' && xmlText(child).trim() !== '') {
        seenContent = true;
      }
      if (child.ns === W_NS && (child.local === 'drawing' || child.local === 'pict')) {
        seenContent = true;
      }
      if (walk(child)) return true;
    }
    return false;
  };
  walk(p);
  if (found !== undefined) return found;
  const pPr = xmlChild(p, W_NS, 'pPr');
  const sect = pPr === undefined ? undefined : xmlChild(pPr, W_NS, 'sectPr');
  if (sect !== undefined && wVal(sect, 'type') !== 'continuous') return 'after';
  return undefined;
}

/**
 * Converts a block container (w:body, w:hdr, w:ftr) into importer blocks:
 * paragraphs/lists/tables plus, for the body, the authored page breaks
 * anchored to the block they land before (ext-pagination §5 — implicit
 * overflow breaks are never recorded, only explicit intent).
 */
function convertBlocks(parent: XmlElement, ctx: WmlContext, isBody: boolean): BlockContainerResult {
  const blocks: MEl[] = [];
  const pageBreaks: MEl[] = [];
  const lists = new ListAssembler();
  let empty = 0;
  let pendingBreak = false;

  // A paragraph in the built-in "caption" style adjacent to a table becomes
  // its <caption> (the paragraph before wins over the one after).
  let pendingCaption: MEl | undefined;

  const walkBody = (container: XmlElement): void => {
    const items = container.children.filter(
      (c): c is XmlElement => c.kind === 'element' && c.ns === W_NS,
    );
    for (let i = 0; i < items.length; i++) {
      const child = items[i];
      if (child === undefined) continue;
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
          const breakPos = isBody ? pageBreakPosition(child) : undefined;
          if (
            isBody &&
            xmlChild(child, W_NS, 'pPr') !== undefined &&
            xmlChild(xmlChild(child, W_NS, 'pPr') as XmlElement, W_NS, 'sectPr') !== undefined
          ) {
            reportOnce(
              ctx,
              "multiple sections: only the last section's page header/footer is used",
            );
          }
          const tag =
            level !== undefined ? `h${String(level)}` : listInfo !== undefined ? 'li' : 'p';
          const block = paragraphToBlock(child, direct, tag, ctx);
          if (block === undefined) {
            empty += 1;
            if (breakPos !== undefined) pendingBreak = true;
            break;
          }
          if (pendingBreak || breakPos === 'before') {
            pageBreaks.push(block);
            pendingBreak = false;
          }
          if (listInfo !== undefined) {
            pendingCaption = undefined;
            lists.add(listInfo, block, blocks, ctx);
          } else {
            lists.flush();
            blocks.push(block);
            pendingCaption = tag === 'p' && ctx.styles.isCaption(direct) ? block : undefined;
          }
          if (breakPos === 'after') pendingBreak = true;
          break;
        }
        case 'tbl': {
          lists.flush();
          let caption = '';
          let consumed: MEl | undefined;
          if (pendingCaption !== undefined && blocks[blocks.length - 1] === pendingCaption) {
            caption = textOf(pendingCaption).trim();
            consumed = pendingCaption;
            blocks.pop();
            ctx.report.push('used the adjacent caption-style paragraph as the table caption');
          } else {
            const next = items[i + 1];
            if (next !== undefined && next.local === 'p') {
              const nextDirect = parsePPr(xmlChild(next, W_NS, 'pPr'));
              if (ctx.styles.isCaption(nextDirect)) {
                const capBlock = paragraphToBlock(next, nextDirect, 'p', ctx);
                caption = capBlock === undefined ? '' : textOf(capBlock).trim();
                if (caption !== '') {
                  i += 1;
                  ctx.report.push('used the adjacent caption-style paragraph as the table caption');
                }
              }
            }
          }
          pendingCaption = undefined;
          const table = tableToBlock(child, caption, ctx);
          if (table !== undefined) {
            if (pendingBreak) {
              pageBreaks.push(table);
              pendingBreak = false;
            }
            // A consumed caption paragraph that carried the break mark hands
            // it to the table it captions.
            const at = consumed === undefined ? -1 : pageBreaks.indexOf(consumed);
            if (at !== -1) pageBreaks[at] = table;
            blocks.push(table);
          }
          break;
        }
        case 'sdt': {
          const sdtPr = xmlChild(child, W_NS, 'sdtPr');
          const docPartObj = sdtPr === undefined ? undefined : xmlChild(sdtPr, W_NS, 'docPartObj');
          const gallery = docPartObj === undefined ? undefined : wVal(docPartObj, 'docPartGallery');
          if (gallery !== undefined && /table of contents/i.test(gallery)) {
            reportOnce(
              ctx,
              'table of contents dropped (the outline is derived from headings, §7.3)',
            );
            break;
          }
          const content = xmlChild(child, W_NS, 'sdtContent');
          if (content !== undefined) walkBody(content);
          break;
        }
        case 'sectPr': // trailing section properties: consumed by convertDocx
        case 'bookmarkStart': // markers, not content
        case 'bookmarkEnd':
          break;
        default:
          reportOnce(ctx, `unsupported body element <w:${child.local}> skipped`);
      }
    }
  };
  walkBody(parent);

  // A break before the container's first rendered element is meaningless
  // (ext-pagination §4): every rendering starts a page there.
  const first = blocks[0];
  const firstContent =
    first !== undefined && (first.tag === 'ul' || first.tag === 'ol')
      ? first.children.find(isEl)
      : first;
  return {
    blocks,
    empty,
    pageBreaks: pageBreaks.filter((b) => b !== first && b !== firstContent),
  };
}
