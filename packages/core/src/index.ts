export const WDF_VERSION = '0.1';

export { WdfError } from './errors.js';
export {
  isElement,
  getAttr,
  hasAttr,
  elementChildren,
  findChild,
  isWhitespaceText,
  meaningfulChildren,
  textContent,
  normalizedText,
  type WdfNode,
  type WdfText,
  type WdfAttr,
  type WdfElement,
  type WdfDoctype,
  type WdfDocument,
} from './html/ast.js';
export { parseHtml } from './html/parse.js';
export { parseHtmlDom } from './html/domparser.js';
export { validateProfile, validateStylesheet, type Violation } from './profile.js';
export { readPackage, writePackage, checkPackageStructure, type WdfPackage } from './package.js';
export {
  createSchemaValidators,
  getSchemaValidators,
  wdfSchemas,
  type SchemaValidators,
  type SchemaSet,
} from './schemas.js';
export type {
  WdfManifest,
  WdfAuthor,
  WdfResource,
  WdfDataset,
  WdfDatasetColumn,
  WdfOutline,
  WdfOutlineNode,
  WdfHashes,
} from './types.js';
