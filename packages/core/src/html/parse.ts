import { parse } from 'parse5';

import type { WdfDocument, WdfElement, WdfNode } from './ast.js';

// Structural view of parse5's default tree; keeps us off its generic types.
interface P5Node {
  nodeName: string;
  value?: string;
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: P5Node[];
  name?: string;
  publicId?: string;
  systemId?: string;
}

function convert(node: P5Node): WdfNode | null {
  if (node.nodeName === '#text') {
    return { kind: 'text', text: node.value ?? '' };
  }
  if (node.tagName === undefined) return null; // comments, doctype, etc.
  return {
    kind: 'element',
    tag: node.tagName,
    attrs: (node.attrs ?? []).map((a) => ({ name: a.name, value: a.value })),
    // Template contents live outside childNodes and are deliberately ignored:
    // the template element itself is rejected by the whitelist (spec §6.2).
    children: (node.childNodes ?? []).map(convert).filter((n): n is WdfNode => n !== null),
  };
}

/** Parses HTML with parse5 (WHATWG parsing algorithm), spec §7.2 stage 1. */
export function parseHtml(html: string): WdfDocument {
  const doc = parse(html) as unknown as P5Node;
  let doctype: WdfDocument['doctype'] = null;
  let root: WdfElement | null = null;
  for (const child of doc.childNodes ?? []) {
    if (child.nodeName === '#documentType') {
      doctype = {
        name: child.name ?? '',
        publicId: child.publicId ?? '',
        systemId: child.systemId ?? '',
      };
    } else if (child.tagName === 'html') {
      const converted = convert(child);
      if (converted !== null && converted.kind === 'element') root = converted;
    }
  }
  return { doctype, html: root };
}
