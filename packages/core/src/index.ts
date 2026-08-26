export const WDF_VERSION = '0.1';

export { WdfError } from './errors.js';
export { validateCaptureExt, parseCaptureExt, CAPTURE_PATH } from './capture.js';
export { validatePaginationExt, parsePaginationExt, PAGINATION_PATH } from './pagination.js';
export {
  parseDatasetFile,
  canonicalCellText,
  cellMatchesType,
  checkTableCorrespondence,
  validateDatasets,
  type WdfCell,
  type WdfDatasetFile,
} from './dataset.js';
export { extract, serializeOutline, type ExtractResult } from './extract.js';
export {
  sha256Hex,
  computeHashes,
  serializeHashes,
  verifyPackage,
  type VerifyResult,
} from './integrity.js';
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
export {
  DATE_OR_DATETIME,
  validateProfile,
  validateStylesheet,
  type Violation,
} from './profile.js';
export {
  computeTableGrid,
  parseSpan,
  type SpanCell,
  type GridSlot,
  type TableGrid,
} from './table.js';
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
  WdfCapture,
  WdfCaptureViewport,
} from './types.js';
