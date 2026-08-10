export {
  el,
  ensureIds,
  fixDanglingFragments,
  isEl,
  serializeDocument,
  textOf,
  type MEl,
  type MNode,
} from './ast.js';
export {
  DEFAULT_CAPS,
  fetchPage,
  identifyImage,
  resolveDocumentAssets,
  urlAssetLoader,
  type AssetCaps,
  type AssetLoad,
  type AssetLoader,
  type LoadedAsset,
} from './assets.js';
export { buildPackage } from './build.js';
export {
  importDocument,
  type ImportDocumentOptions,
  type ImportedDocument,
  type ImportInput,
} from './document.js';
export { decodeHtml } from './encoding.js';
export { embedFonts, type EmbeddedFonts, type FontReader } from './fonts.js';
export { promoteHeadings } from './headings.js';
export { importHtml, type HtmlImportOptions } from './html.js';
export { importMarkdown } from './markdown.js';
export { isPageResidue, preprocessHeaderHtml } from './pageheader.js';
export { replaceEmbeds, type EmbedPlaceholderOptions } from './embeds.js';
export {
  CAPTURE_MARK,
  geometryExclusions,
  pruneCaptureMarks,
  stripCaptureMarks,
  type CaptureRect,
  type CaptureElementGeometry,
  type CapturePageGeometry,
  type CaptureExclusion,
  type ExclusionReason,
} from './prefilter.js';
export { aggregateReport } from './report.js';
export { collectSourceStylesheets, type CssFetcher } from './sourcecss.js';
export {
  parseDeclarations,
  parseStylesheet,
  sanitizeDeclarations,
  STYLE_TMP_ATTR,
} from './styles.js';
