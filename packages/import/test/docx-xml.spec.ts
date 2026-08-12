import { describe, expect, it } from 'vitest';

import { parseXml, XmlError, xmlAttr, xmlChild, xmlChildren, xmlText } from '@wdf-dev/import';

// WP20 T20.1 (plan §10.47): namespace-aware XML mini-DOM. Names resolve to
// (namespace URI, local name) — prefixes are conventional but rebindable,
// so lookups never trust them.

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

describe('parseXml', () => {
  it('resolves prefixed and default namespaces', () => {
    const root = parseXml(
      `<w:document xmlns:w="${W}" xmlns="urn:other"><w:body/><stray/></w:document>`,
    );
    expect(root.ns).toBe(W);
    expect(root.local).toBe('document');
    expect(xmlChild(root, W, 'body')).toBeDefined();
    expect(xmlChild(root, 'urn:other', 'stray')).toBeDefined();
    expect(xmlChild(root, W, 'stray')).toBeUndefined();
  });

  it('finds elements by URI even under a rebound prefix', () => {
    // Same WordprocessingML document, hostile prefix: x: instead of w:.
    const root = parseXml(
      `<x:document xmlns:x="${W}"><x:body><x:p><x:r><x:t>ciao</x:t></x:r></x:p></x:body></x:document>`,
    );
    const body = xmlChild(root, W, 'body');
    expect(body).toBeDefined();
    expect(xmlText(body ?? root)).toBe('ciao');
  });

  it('resolves attribute namespaces; unprefixed attributes live in NO namespace', () => {
    const root = parseXml(`<w:p xmlns:w="${W}" w:val="x" plain="y"/>`);
    expect(xmlAttr(root, W, 'val')).toBe('x');
    expect(xmlAttr(root, '', 'plain')).toBe('y');
    // Never resolvable through the element's namespace:
    expect(xmlAttr(root, W, 'plain')).toBeUndefined();
  });

  it('excludes xmlns declarations from attributes', () => {
    const root = parseXml(`<a xmlns="urn:x" xmlns:b="urn:y" b:c="1"/>`);
    expect(root.attrs).toHaveLength(1);
    expect(root.attrs[0]?.local).toBe('c');
  });

  it('decodes entities and merges CDATA into text', () => {
    const root = parseXml('<t>a &amp; b &#232;<![CDATA[ <raw>]]> end</t>');
    expect(xmlText(root)).toBe('a & b è <raw> end');
    expect(root.children).toHaveLength(1); // one merged text node
  });

  it('drops comments and processing instructions', () => {
    const root = parseXml('<t><?pi data?><!-- c -->x</t>');
    expect(root.children).toHaveLength(1);
    expect(xmlText(root)).toBe('x');
  });

  it('collects repeated children in document order', () => {
    const root = parseXml(`<w:b xmlns:w="${W}"><w:p>1</w:p><q/><w:p>2</w:p></w:b>`);
    expect(xmlChildren(root, W, 'p').map(xmlText)).toEqual(['1', '2']);
  });

  it('throws XmlError on malformed input', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(XmlError);
    expect(() => parseXml('plain text')).toThrow(XmlError);
    expect(() => parseXml('')).toThrow(XmlError);
  });
});
