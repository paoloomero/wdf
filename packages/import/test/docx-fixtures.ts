import { strToU8, zipSync } from 'fflate';

// Hand-built .docx fixtures for the WP20 tests: local, deterministic, no
// binary blobs in the repo — the same construction the T20.0 demo used.

export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Default Extension="png" ContentType="image/png"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>';

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>';

export const MINIMAL_DOCUMENT =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<w:document xmlns:w="${W_NS}"><w:body>` +
  '<w:p><w:r><w:t>Hello docx</w:t></w:r></w:p>' +
  '<w:sectPr/></w:body></w:document>';

export interface DocxFixtureOptions {
  /** word/document.xml content (default: MINIMAL_DOCUMENT). */
  document?: string;
  /** Replaces [Content_Types].xml entirely when set; null omits the part. */
  contentTypes?: string | null;
  /** Replaces _rels/.rels entirely when set. */
  rootRels?: string;
  /** Extra parts, verbatim (e.g. 'word/_rels/document.xml.rels', media). */
  extra?: Record<string, Uint8Array | string>;
}

/** Builds .docx bytes from the minimal valid skeleton plus overrides. */
export function makeDocx(options: DocxFixtureOptions = {}): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const contentTypes = options.contentTypes === undefined ? CONTENT_TYPES : options.contentTypes;
  if (contentTypes !== null) files['[Content_Types].xml'] = strToU8(contentTypes);
  files['_rels/.rels'] = strToU8(options.rootRels ?? ROOT_RELS);
  files['word/document.xml'] = strToU8(options.document ?? MINIMAL_DOCUMENT);
  for (const [name, data] of Object.entries(options.extra ?? {})) {
    files[name] = typeof data === 'string' ? strToU8(data) : data;
  }
  return zipSync(files);
}
