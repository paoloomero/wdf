import { SaxesParser } from 'saxes';

// Namespace-aware XML mini-DOM for OOXML parts (WP20 T20.1, plan §10.47).
// Built on saxes with xmlns processing so element and attribute names are
// resolved to (namespace URI, local name) pairs — OOXML prefixes (w:, r:)
// are conventional but rebindable; whitelist thinking means resolving them
// for real, never trusting the prefix. Isomorphic: saxes is pure JS and
// runs in Node, browsers and service workers alike.

export interface XmlText {
  readonly kind: 'text';
  readonly text: string;
}

export interface XmlAttr {
  /** Resolved namespace URI; '' for unprefixed (per-element) attributes. */
  readonly ns: string;
  readonly local: string;
  readonly value: string;
}

export interface XmlElement {
  readonly kind: 'element';
  /** Resolved namespace URI; '' for elements in no namespace. */
  readonly ns: string;
  readonly local: string;
  readonly attrs: readonly XmlAttr[];
  readonly children: readonly XmlNode[];
}

export type XmlNode = XmlElement | XmlText;

/** Thrown for malformed XML — the message carries saxes' diagnostic. */
export class XmlError extends Error {}

interface MutableElement {
  kind: 'element';
  ns: string;
  local: string;
  attrs: XmlAttr[];
  children: XmlNode[];
}

/**
 * Parses an XML document into its root element. Comments, processing
 * instructions and the doctype are dropped; CDATA joins text. Malformed
 * input throws XmlError — an OOXML part that does not parse is a hard
 * error, not something to guess about.
 */
export function parseXml(text: string): XmlElement {
  const parser = new SaxesParser({ xmlns: true });
  const stack: MutableElement[] = [];
  let root: MutableElement | undefined;
  let error: Error | undefined;

  parser.on('error', (e) => {
    error ??= e;
  });
  parser.on('opentag', (tag) => {
    const el: MutableElement = {
      kind: 'element',
      ns: tag.uri,
      local: tag.local,
      attrs: Object.values(tag.attributes)
        // xmlns declarations are resolution machinery, not data.
        .filter((a) => a.prefix !== 'xmlns' && a.name !== 'xmlns')
        .map((a) => ({ ns: a.uri, local: a.local, value: a.value })),
      children: [],
    };
    const parent = stack[stack.length - 1];
    if (parent !== undefined) {
      parent.children.push(el);
    } else {
      root ??= el;
    }
    stack.push(el);
  });
  parser.on('closetag', () => {
    stack.pop();
  });
  const appendText = (t: string): void => {
    const parent = stack[stack.length - 1];
    if (parent === undefined) return; // whitespace outside the root
    const last = parent.children[parent.children.length - 1];
    if (last !== undefined && last.kind === 'text') {
      parent.children[parent.children.length - 1] = { kind: 'text', text: last.text + t };
    } else {
      parent.children.push({ kind: 'text', text: t });
    }
  };
  parser.on('text', appendText);
  parser.on('cdata', appendText);

  parser.write(text).close();
  if (error !== undefined) throw new XmlError(error.message);
  if (root === undefined) throw new XmlError('no root element');
  return root;
}

/** Child elements matching (namespace, local name), in document order. */
export function xmlChildren(el: XmlElement, ns: string, local: string): XmlElement[] {
  return el.children.filter(
    (c): c is XmlElement => c.kind === 'element' && c.ns === ns && c.local === local,
  );
}

/** First child element matching (namespace, local name), if any. */
export function xmlChild(el: XmlElement, ns: string, local: string): XmlElement | undefined {
  return xmlChildren(el, ns, local)[0];
}

/**
 * Attribute value by (namespace, local name). OOXML attributes are usually
 * prefixed (w:val → the wordprocessingml URI); attributes without a prefix
 * live in NO namespace — pass '' for those, never the element's namespace.
 */
export function xmlAttr(el: XmlElement, ns: string, local: string): string | undefined {
  return el.attrs.find((a) => a.ns === ns && a.local === local)?.value;
}

/** Concatenated text content of the subtree, document order. */
export function xmlText(el: XmlElement): string {
  let out = '';
  for (const child of el.children) {
    out += child.kind === 'text' ? child.text : xmlText(child);
  }
  return out;
}
