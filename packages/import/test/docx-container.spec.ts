import { strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';

import { DocxError, looksLikeDocx, openDocx, resolveTarget } from '@wdf-dev/import';

import { makeDocx } from './docx-fixtures.js';

// WP20 T20.1 (plan §10.47): the OPC container — parts, [Content_Types].xml,
// relationships — with deterministic iteration and hard errors for inputs
// that are not a .docx.

const DOC_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/x" TargetMode="External"/>' +
  '</Relationships>';

describe('openDocx / DocxContainer', () => {
  it('finds the main document part through the officeDocument relationship', () => {
    const docx = openDocx(makeDocx());
    expect(docx.mainDocumentPart()).toBe('word/document.xml');
    expect(docx.partText('word/document.xml')).toContain('Hello docx');
  });

  it('answers content types: Override first, Default by extension, case-insensitive', () => {
    const docx = openDocx(makeDocx({ extra: { 'word/media/IMAGE1.PNG': new Uint8Array(4) } }));
    expect(docx.contentTypeOf('word/document.xml')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    );
    expect(docx.contentTypeOf('_rels/.rels')).toBe(
      'application/vnd.openxmlformats-package.relationships+xml',
    );
    expect(docx.contentTypeOf('word/media/IMAGE1.PNG')).toBe('image/png');
    expect(docx.contentTypeOf('word/noextension')).toBeUndefined();
  });

  it('lists part names sorted — deterministic iteration', () => {
    const docx = openDocx(makeDocx({ extra: { 'word/z.xml': '<z/>', 'word/a.xml': '<a/>' } }));
    const names = docx.partNames();
    expect(names).toEqual([...names].sort());
    expect(names).toContain('word/a.xml');
  });

  it('reads part relationships sorted by id, keeping External mode', () => {
    const docx = openDocx(makeDocx({ extra: { 'word/_rels/document.xml.rels': DOC_RELS } }));
    const rels = docx.relationshipsOf('word/document.xml');
    expect(rels.map((r) => r.id)).toEqual(['rId1', 'rId2']);
    expect(rels[0]).toMatchObject({ targetMode: 'External', target: 'https://example.com/x' });
    expect(rels[1]).toMatchObject({ targetMode: 'Internal', target: 'media/image1.png' });
  });

  it('returns no relationships for a part without a .rels sibling', () => {
    expect(openDocx(makeDocx()).relationshipsOf('word/document.xml')).toEqual([]);
  });

  it('rejects a package without [Content_Types].xml', () => {
    expect(() => openDocx(makeDocx({ contentTypes: null }))).toThrow(DocxError);
  });

  it('rejects a package without the officeDocument relationship', () => {
    const rels =
      '<?xml version="1.0"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>';
    expect(() => openDocx(makeDocx({ rootRels: rels })).mainDocumentPart()).toThrow(
      /officeDocument/,
    );
  });

  it('rejects a dangling main document part', () => {
    const rels =
      '<?xml version="1.0"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/ghost.xml"/>' +
      '</Relationships>';
    expect(() => openDocx(makeDocx({ rootRels: rels })).mainDocumentPart()).toThrow(/ghost/);
  });

  it('rejects bytes that are not a ZIP', () => {
    expect(() => openDocx(strToU8('<!doctype html><p>no</p>'))).toThrow(DocxError);
  });
});

describe('resolveTarget', () => {
  it('resolves part-relative, parent-relative and absolute targets', () => {
    expect(resolveTarget('word/document.xml', 'media/image1.png')).toBe('word/media/image1.png');
    expect(resolveTarget('word/document.xml', '../customXml/item1.xml')).toBe(
      'customXml/item1.xml',
    );
    expect(resolveTarget('word/document.xml', '/word/styles.xml')).toBe('word/styles.xml');
    expect(resolveTarget('', 'word/document.xml')).toBe('word/document.xml');
  });

  it('rejects targets escaping the package', () => {
    expect(() => resolveTarget('word/document.xml', '../../../etc/passwd')).toThrow(DocxError);
  });
});

describe('looksLikeDocx (T20.8 routing sniff)', () => {
  it('accepts real .docx bytes and rejects HTML and foreign zips', () => {
    expect(looksLikeDocx(makeDocx())).toBe(true);
    expect(looksLikeDocx(strToU8('<!doctype html><p>x</p>'))).toBe(false);
    expect(looksLikeDocx(new Uint8Array([0x50, 0x4b, 3, 4]))).toBe(false);
  });
});
