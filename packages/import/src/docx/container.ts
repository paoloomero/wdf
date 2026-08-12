import { unzipSync } from 'fflate';

import { parseXml, xmlAttr, xmlChildren, type XmlElement } from './xml.js';

// OPC container model for .docx files (WP20 T20.1, plan §10.47): the ZIP
// package, [Content_Types].xml and the relationship parts — ECMA-376 Part 2.
// Deliberately minimal: exactly what the WordprocessingML importer needs,
// nothing speculative. Isomorphic (fflate + saxes only).

/** OPC namespaces (Part 2); WordprocessingML namespaces arrive with T20.2. */
export const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
export const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** Relationship type of the main document part (ECMA-376 Part 1 §11.3). */
export const OFFICE_DOCUMENT_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/** Content type of the WordprocessingML main document part. */
export const MAIN_DOCUMENT_CT =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';

export class DocxError extends Error {}

export interface Relationship {
  readonly id: string;
  readonly type: string;
  /** Verbatim Target value; resolve part targets with resolveTarget(). */
  readonly target: string;
  /** 'Internal' (default) or 'External' (e.g. hyperlinks). */
  readonly targetMode: 'Internal' | 'External';
}

const dec = new TextDecoder('utf-8', { fatal: true });

/**
 * Cheap sniff for T20.8's format detection: a ZIP local-file header AND the
 * OPC content-types part somewhere in the bytes. Not a validation — opening
 * decides; this only routes inputs.
 */
export function looksLikeDocx(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
  const probe = new TextDecoder('latin1').decode(bytes);
  return probe.includes('[Content_Types].xml') && probe.includes('word/');
}

/**
 * Resolves a relationship Target against the part that declares it (OPC
 * part names are '/'-separated; targets may be part-relative, use `..`, or
 * be package-absolute with a leading '/'). Returns a normalized part name
 * WITHOUT the leading slash — the form used as zip entry names.
 */
export function resolveTarget(basePart: string, target: string): string {
  const base = target.startsWith('/')
    ? []
    : basePart
        .split('/')
        .slice(0, -1)
        .filter((s) => s !== '');
  for (const seg of target.replace(/^\//, '').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (base.length === 0)
        throw new DocxError(`relationship target escapes the package: ${target}`);
      base.pop();
    } else {
      base.push(seg);
    }
  }
  return base.join('/');
}

/**
 * A parsed .docx container: parts by name, content types, relationships.
 * Iteration is deterministic by construction — partNames is sorted.
 */
export class DocxContainer {
  private readonly parts: Map<string, Uint8Array>;
  private readonly defaults: Map<string, string>;
  private readonly overrides: Map<string, string>;

  constructor(parts: Map<string, Uint8Array>) {
    this.parts = parts;
    this.defaults = new Map();
    this.overrides = new Map();
    const ct = parts.get('[Content_Types].xml');
    if (ct === undefined) throw new DocxError('not a .docx: [Content_Types].xml is missing');
    let root: XmlElement;
    try {
      root = parseXml(dec.decode(ct));
    } catch (e) {
      throw new DocxError(`[Content_Types].xml does not parse: ${String(e)}`);
    }
    for (const d of xmlChildren(root, CT_NS, 'Default')) {
      const ext = xmlAttr(d, '', 'Extension');
      const type = xmlAttr(d, '', 'ContentType');
      if (ext !== undefined && type !== undefined) this.defaults.set(ext.toLowerCase(), type);
    }
    for (const o of xmlChildren(root, CT_NS, 'Override')) {
      const name = xmlAttr(o, '', 'PartName');
      const type = xmlAttr(o, '', 'ContentType');
      if (name !== undefined && type !== undefined) this.overrides.set(name, type);
    }
  }

  /** Part bytes by normalized name (no leading slash), if present. */
  part(name: string): Uint8Array | undefined {
    return this.parts.get(name);
  }

  /** A part decoded as UTF-8 text (OOXML parts are UTF-8 XML). */
  partText(name: string): string | undefined {
    const bytes = this.parts.get(name);
    return bytes === undefined ? undefined : dec.decode(bytes);
  }

  /** All part names, sorted — deterministic iteration is the contract. */
  partNames(): string[] {
    return [...this.parts.keys()].sort();
  }

  /** Declared content type of a part: Override first, then Default by extension. */
  contentTypeOf(partName: string): string | undefined {
    const override = this.overrides.get(`/${partName}`);
    if (override !== undefined) return override;
    const dot = partName.lastIndexOf('.');
    if (dot === -1) return undefined;
    return this.defaults.get(partName.slice(dot + 1).toLowerCase());
  }

  /**
   * Relationships declared BY a part (its `_rels/<name>.rels` sibling), or
   * by the package itself when partName is '' — sorted by id for
   * deterministic iteration.
   */
  relationshipsOf(partName: string): Relationship[] {
    const dir = partName === '' ? '' : partName.split('/').slice(0, -1).join('/');
    const file = partName === '' ? '' : (partName.split('/').pop() ?? '');
    const relsName = `${dir === '' ? '' : `${dir}/`}_rels/${file}.rels`;
    const bytes = this.parts.get(relsName);
    if (bytes === undefined) return [];
    let root: XmlElement;
    try {
      root = parseXml(dec.decode(bytes));
    } catch (e) {
      throw new DocxError(`${relsName} does not parse: ${String(e)}`);
    }
    const out: Relationship[] = [];
    for (const rel of xmlChildren(root, REL_NS, 'Relationship')) {
      const id = xmlAttr(rel, '', 'Id');
      const type = xmlAttr(rel, '', 'Type');
      const target = xmlAttr(rel, '', 'Target');
      if (id === undefined || type === undefined || target === undefined) continue;
      out.push({
        id,
        type,
        target,
        targetMode: xmlAttr(rel, '', 'TargetMode') === 'External' ? 'External' : 'Internal',
      });
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** The main document part name (via the officeDocument relationship). */
  mainDocumentPart(): string {
    const rel = this.relationshipsOf('').find((r) => r.type === OFFICE_DOCUMENT_REL);
    if (rel === undefined || rel.targetMode === 'External') {
      throw new DocxError('not a .docx: no officeDocument relationship in _rels/.rels');
    }
    const name = resolveTarget('', rel.target);
    if (!this.parts.has(name)) {
      throw new DocxError(`main document part ${name} is missing from the package`);
    }
    return name;
  }
}

/** Opens .docx bytes into a container; throws DocxError when it is not one. */
export function openDocx(bytes: Uint8Array): DocxContainer {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (e) {
    throw new DocxError(`not a .docx: the ZIP container does not open (${String(e)})`);
  }
  const parts = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/')) continue; // directory entries carry no bytes
    parts.set(name.replace(/^\//, ''), data);
  }
  return new DocxContainer(parts);
}
