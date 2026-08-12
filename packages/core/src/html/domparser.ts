import type { WdfDocument, WdfElement, WdfNode } from './ast.js';

// Minimal structural DOM types: @wdf-dev/core compiles without lib.dom (it must
// stay isomorphic), so we describe just what we read from a real DOM.
interface DomNode {
  nodeType: number;
  nodeValue: string | null;
}
interface DomElement extends DomNode {
  localName: string;
  attributes: ArrayLike<{ name: string; value: string }>;
  childNodes: ArrayLike<DomNode>;
}
interface DomDocument {
  doctype: { name: string; publicId: string; systemId: string } | null;
  documentElement: DomElement | null;
}
type DomParserCtor = new () => { parseFromString(html: string, type: string): DomDocument };

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

function convert(node: DomNode): WdfNode | null {
  if (node.nodeType === TEXT_NODE) {
    return { kind: 'text', text: node.nodeValue ?? '' };
  }
  if (node.nodeType !== ELEMENT_NODE) return null;
  const el = node as DomElement;
  return {
    kind: 'element',
    tag: el.localName,
    attrs: Array.from(el.attributes, (a) => ({ name: a.name, value: a.value })),
    children: Array.from(el.childNodes, convert).filter((n): n is WdfNode => n !== null),
  };
}

/**
 * Parses HTML with the environment's DOMParser (browsers; jsdom in tests).
 * Same WHATWG parsing algorithm as parse5 — the T2.3 parity suite holds the
 * two adapters to identical extraction output (spec §7.1.3).
 */
export function parseHtmlDom(html: string): WdfDocument {
  const Parser = (globalThis as { DOMParser?: DomParserCtor }).DOMParser;
  if (Parser === undefined) {
    throw new Error('DOMParser is not available in this environment; use parseHtml instead');
  }
  const doc = new Parser().parseFromString(html, 'text/html');
  const root = doc.documentElement === null ? null : convert(doc.documentElement);
  return {
    doctype:
      doc.doctype === null
        ? null
        : {
            name: doc.doctype.name,
            publicId: doc.doctype.publicId,
            systemId: doc.doctype.systemId,
          },
    html: root !== null && root.kind === 'element' ? (root as WdfElement) : null,
  };
}
