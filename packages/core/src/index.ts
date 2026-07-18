export const WDF_VERSION = '0.1';

export { WdfError } from './errors.js';
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
