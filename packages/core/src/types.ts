/** Types mirroring the JSON Schemas in spec/schemas/ (WDF Core 0.1, §manifest, §ai-layer, §integrity). */

export interface WdfAuthor {
  name: string;
  role?: string;
}

export interface WdfResource {
  path: string;
  mediaType: string;
}

export type WdfColumnType = 'string' | 'integer' | 'number' | 'boolean' | 'date';

export interface WdfDatasetColumn {
  name: string;
  type: WdfColumnType;
}

export interface WdfDataset {
  path: string;
  title?: string;
  schema: {
    columns: WdfDatasetColumn[];
  };
}

export interface WdfExtension {
  name: string;
  version?: string;
}

export interface WdfManifest {
  wdf: '0.1';
  id: string;
  title: string;
  language: string;
  authors?: WdfAuthor[];
  created: string;
  modified: string;
  entry: 'content/index.html';
  resources?: WdfResource[];
  datasets?: WdfDataset[];
  extensions?: WdfExtension[];
}

export type WdfOutlineNodeType =
  'section' | 'heading' | 'paragraph' | 'table' | 'figure' | 'blockquote' | 'list-item';

export interface WdfOutlineNode {
  id: string;
  type: WdfOutlineNodeType;
  /** Heading level 1-6; present only when type is "heading". */
  level?: number;
  title?: string;
  /** id of the parent node, or null for top-level nodes. */
  parent: string | null;
}

export type WdfOutline = WdfOutlineNode[];

export interface WdfHashes {
  algorithm: 'sha256';
  /** package path → lowercase hex SHA-256; every file except integrity/hashes.json itself. */
  files: Record<string, string>;
}

/** Layout viewport at capture time (extension `capture`, docs/ext-capture.md §4). */
export interface WdfCaptureViewport {
  width: number;
  height: number;
  devicePixelRatio?: number;
}

/** ext/capture/capture.json — provenance of a live-page capture (docs/ext-capture.md §4). */
export interface WdfCapture {
  capture: '0.1';
  url: string;
  capturedAt: string;
  userAgent: string;
  viewport: WdfCaptureViewport;
  mode: 'article' | 'full-page';
}
