import { sha256Hex, type WdfCapture, type WdfManifest } from '@wdf/core';

import { ensureIds, fixDanglingFragments, serializeDocument, textOf, type MEl } from './ast.js';
import { DEFAULT_CAPS, type AssetCaps, type AssetLoader, type LoadedAsset } from './assets.js';
import { buildPackage } from './build.js';
import { type EmbedPlaceholderOptions } from './embeds.js';
import { embedFonts, type FontReader } from './fonts.js';
import { importHtml, type HtmlImportOptions } from './html.js';
import { importMarkdown } from './markdown.js';
import { collectSourceStylesheets, type CssFetcher } from './sourcecss.js';

const enc = new TextEncoder();

/**
 * Platform-neutral import orchestration (plan §10.8/§10.24, T7.5): everything
 * between decoding the input and writing the package to disk. The host —
 * CLI or browser — resolves the input to text and supplies the environment
 * as injected loaders; the pipeline itself is one shared code path, so the
 * same input yields a byte-identical package everywhere.
 */

export interface ImportInput {
  kind: 'html' | 'markdown';
  /** Input decoded to text (see decodeHtml for HTML sources). */
  text: string;
  /** Fallback title when the document declares none (no extension). */
  baseName: string;
  /** Original input bytes, embedded verbatim by `withSource` (WP13). */
  sourceBytes?: Uint8Array;
  /** Name recorded in source.json — the input file name or URL. */
  sourceName?: string;
  /** Encoding the original bytes are stored in (source.json). */
  sourceEncoding?: string;
  /**
   * How the original was obtained (source.json v0.3 `kind`): a file
   * obtained as bytes (default) or a serialization of the rendered DOM
   * captured from a live page (docs/ext-source.md, docs/ext-capture.md).
   */
  sourceKind?: 'fetched-html' | 'dom-snapshot';
}

export interface ImportDocumentOptions {
  title?: string;
  lang?: string;
  /** Manifest created/modified timestamp; defaults to the current time. */
  date?: string;
  withSource?: boolean;
  embedFonts?: boolean;
  fullPage?: boolean;
  /** Geometric pre-filter for dom-snapshot inputs (T18.3, prefilter.ts). */
  captureExclusions?: ReadonlySet<number>;
  /** Embed placeholders for dom-snapshot inputs (T18.4, embeds.ts). */
  captureEmbeds?: EmbedPlaceholderOptions;
  /**
   * Capture provenance to record in the package (extension `capture` 0.1,
   * docs/ext-capture.md §4): emitted as ext/capture/capture.json and
   * declared in the manifest, hashed like every other file.
   */
  capture?: WdfCapture;
  /** Resolves an image src to bytes; absent → external images are dropped. */
  loadAsset?: AssetLoader;
  /** Word support-folder access for page headers/footers (T14.1). */
  loadSibling?: (relPath: string) => Promise<Uint8Array | undefined>;
  /** Resolves an external stylesheet href for the source extension (WP15). */
  fetchCss?: CssFetcher;
  /** Supplies woff2 bytes for the fonts extension; required with embedFonts. */
  readFont?: FontReader;
  caps?: AssetCaps;
}

export interface ImportedDocument {
  wdfBytes: Uint8Array;
  /** The canonical content/index.html, for profile validation by the host. */
  html: string;
  title: string;
  report: string[];
}

/** Returns undefined when the input has no representable content. */
export async function importDocument(
  input: ImportInput,
  opts: ImportDocumentOptions = {},
  report: string[] = [],
): Promise<ImportedDocument | undefined> {
  const isMarkdown = input.kind === 'markdown';
  const caps = opts.caps ?? DEFAULT_CAPS;

  let blocks: MEl[];
  let sourceTitle: string | undefined;
  let sourceLang: string | undefined;
  let stylesheet: string | undefined;
  let assets: LoadedAsset[] = [];
  let sourceMap: Record<string, string> = {};
  if (isMarkdown) {
    const result = importMarkdown(input.text);
    blocks = result.blocks;
    report.push(...result.report);
  } else {
    const options: HtmlImportOptions =
      opts.loadAsset === undefined ? {} : { loadAsset: opts.loadAsset };
    if (opts.withSource === true) options.keepAllAssets = true;
    if (opts.loadSibling !== undefined) options.loadSibling = opts.loadSibling;
    if (opts.fullPage === true) options.fullPage = true;
    if (opts.captureExclusions !== undefined) options.captureExclusions = opts.captureExclusions;
    if (opts.captureEmbeds !== undefined) options.captureEmbeds = opts.captureEmbeds;
    const result = await importHtml(input.text, options);
    blocks = result.blocks;
    sourceTitle = result.title;
    sourceLang = result.language;
    stylesheet = result.stylesheet;
    assets = result.assets;
    sourceMap = result.sourceMap;
    report.push(...result.report);
  }

  if (blocks.length === 0) return undefined;
  ensureIds(blocks, report);
  fixDanglingFragments(blocks, report);

  const firstHeading = blocks.find((b) => /^h[1-6]$/.test(b.tag));
  const title =
    opts.title ??
    sourceTitle ??
    (firstHeading === undefined ? input.baseName : textOf(firstHeading).trim());
  const lang = opts.lang ?? sourceLang ?? 'en';
  const html = serializeDocument(lang, title, blocks, stylesheet !== undefined);
  const htmlBytes = enc.encode(html);

  const date = opts.date ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const manifest: WdfManifest = {
    wdf: '0.1',
    id: deterministicUuid(await sha256Hex(htmlBytes)),
    title,
    language: lang,
    created: date,
    modified: date,
    entry: 'content/index.html',
  };
  if (assets.length > 0) {
    manifest.resources = assets.map((a) => ({ path: a.path, mediaType: a.mediaType }));
  }

  // WP13 (plan §10.18): embed the original input byte-for-byte under
  // ext/source/; images are not duplicated — source.json maps the original
  // src values onto the content/assets/ copies.
  const extFiles = new Map<string, Uint8Array>();
  const extensions: { name: string; version: string }[] = [];

  // WP9 (plan §10.19): embed metric-compatible open clones for well-known
  // families and prepend them to the generated stacks.
  if (opts.embedFonts === true && stylesheet !== undefined) {
    if (opts.readFont === undefined) {
      throw new Error('embedFonts requires a readFont loader');
    }
    const fonts = embedFonts(stylesheet, opts.readFont);
    if (fonts === undefined) {
      report.push('no substitutable font family in the stylesheet — fonts extension not added');
    } else {
      stylesheet = fonts.stylesheet;
      for (const [path, bytes] of fonts.files) extFiles.set(path, bytes);
      extensions.push({ name: 'fonts', version: '0.1' });
      report.push(...fonts.report);
    }
  }

  if (opts.withSource === true && input.sourceBytes !== undefined) {
    const mainPath = `ext/source/${(await sha256Hex(input.sourceBytes)).slice(0, 16)}.${isMarkdown ? 'md' : 'html'}`;
    // WP15: a web page's look lives in its external stylesheets — embed
    // them so the Original view is not an unstyled skeleton.
    let stylesheets: Record<string, string> = {};
    if (!isMarkdown && opts.fetchCss !== undefined) {
      const collected = await collectSourceStylesheets(input.text, opts.fetchCss, caps, report);
      for (const [path, bytes] of collected.files) extFiles.set(path, bytes);
      stylesheets = collected.stylesheets;
    }
    const sourceJson: Record<string, unknown> = {
      source: '0.3',
      kind: input.sourceKind ?? 'fetched-html',
      main: mainPath,
      mainName: input.sourceName ?? '',
      encoding: input.sourceEncoding ?? 'utf-8',
      resources: sourceMap,
    };
    if (Object.keys(stylesheets).length > 0) sourceJson['stylesheets'] = stylesheets;
    extensions.push({ name: 'source', version: '0.3' });
    extFiles.set(mainPath, input.sourceBytes);
    extFiles.set('ext/source/source.json', enc.encode(`${JSON.stringify(sourceJson, null, 2)}\n`));
    report.push(
      `embedded the original source as ${mainPath} (extension "source", docs/ext-source.md)`,
    );
  }
  // T18.4 (docs/ext-capture.md §4): capture provenance travels in the
  // package, hashed like every other file.
  if (opts.capture !== undefined) {
    extFiles.set(
      'ext/capture/capture.json',
      enc.encode(`${JSON.stringify(opts.capture, null, 2)}\n`),
    );
    extensions.push({ name: 'capture', version: '0.1' });
    report.push('recorded capture provenance (extension "capture", docs/ext-capture.md)');
  }
  if (extensions.length > 0) {
    manifest.extensions = extensions.sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  const source = new Map<string, Uint8Array>([
    ['manifest.json', enc.encode(`${JSON.stringify(manifest, null, 2)}\n`)],
    ['content/index.html', htmlBytes],
  ]);
  if (stylesheet !== undefined) {
    source.set('content/styles.css', enc.encode(stylesheet));
  }
  for (const asset of assets) {
    source.set(asset.path, asset.bytes);
  }
  for (const [path, bytes] of extFiles) {
    source.set(path, bytes);
  }

  return { wdfBytes: await buildPackage(source), html, title, report };
}

function deterministicUuid(hex: string): string {
  const variant = ((parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
