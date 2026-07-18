/**
 * Minimal read-only HTML AST shared by the parse5 (Node) and DOMParser
 * (browser) adapters. Comments, CDATA and processing instructions are dropped
 * at parse time: they carry no WDF semantics, and dropping them identically in
 * both adapters is a precondition of deterministic extraction (spec §7.1.3).
 */

export interface WdfText {
  readonly kind: 'text';
  readonly text: string;
}

export interface WdfAttr {
  readonly name: string;
  readonly value: string;
}

export interface WdfElement {
  readonly kind: 'element';
  /** Lowercase for HTML elements; verbatim local name for foreign content. */
  readonly tag: string;
  readonly attrs: readonly WdfAttr[];
  readonly children: readonly WdfNode[];
}

export type WdfNode = WdfElement | WdfText;

export interface WdfDoctype {
  readonly name: string;
  readonly publicId: string;
  readonly systemId: string;
}

export interface WdfDocument {
  readonly doctype: WdfDoctype | null;
  /** The `html` element; null only for pathological inputs. */
  readonly html: WdfElement | null;
}

export function isElement(node: WdfNode): node is WdfElement {
  return node.kind === 'element';
}

export function getAttr(el: WdfElement, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

export function hasAttr(el: WdfElement, name: string): boolean {
  return el.attrs.some((a) => a.name === name);
}

export function elementChildren(el: WdfElement): WdfElement[] {
  return el.children.filter(isElement);
}

export function findChild(el: WdfElement, tag: string): WdfElement | undefined {
  return elementChildren(el).find((c) => c.tag === tag);
}

const WS_ONLY = /^[\t\n\f\r ]*$/;

/** True for text nodes containing only whitespace characters (spec §2). */
export function isWhitespaceText(node: WdfNode): boolean {
  return node.kind === 'text' && WS_ONLY.test(node.text);
}

/** Element children plus non-whitespace text nodes, in order. */
export function meaningfulChildren(el: WdfElement): WdfNode[] {
  return el.children.filter((c) => isElement(c) || !isWhitespaceText(c));
}

/** Concatenated text content of a subtree (markup ignored, no normalization). */
export function textContent(node: WdfNode): string {
  if (node.kind === 'text') return node.text;
  return node.children.map(textContent).join('');
}

/**
 * Normalized text per spec §7.3.1–§7.3.2: each maximal run of whitespace
 * characters collapses to a single space, then leading/trailing spaces drop.
 */
export function normalizedText(node: WdfNode): string {
  return textContent(node)
    .replace(/[\t\n\f\r ]+/g, ' ')
    .replace(/^ | $/g, '');
}
