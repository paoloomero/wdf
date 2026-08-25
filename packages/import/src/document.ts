import { sha256Hex, type WdfCapture, type WdfManifest } from '@wdf-dev/core';

import { ensureIds, fixDanglingFragments, serializeDocument, textOf, type MEl } from './ast.js';
import { DEFAULT_CAPS, type AssetCaps, type AssetLoader, type LoadedAsset } from './assets.js';
import { buildPackage } from './build.js';
import { type EmbedPlaceholderOptions } from './embeds.js';
import { embedFonts, type FontReader } from './fonts.js';
import { DOCX_MEDIA_TYPE } from './docx/container.js';
import { convertDocx } from './docx/wml.js';
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
  kind: 'html' | 'markdown' | 'docx';
  /** Input decoded to text (see decodeHtml for HTML sources; '' for docx). */
  text: string;
  /** Raw input bytes — required for kind 'docx' (WP20 T20.8). */
  bytes?: Uint8Array;
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
  /**
   * Author-supplied visual rendition (ext-source 0.5 `visual`, WP21): a
   * PDF the author saved from the original application, embedded verbatim.
   * Never generated or parsed by the pipeline. Requires `withSource`.
   */
  visualBytes?: Uint8Array;
  /** Original file name of the visual rendition (display only). */
  visualName?: string;
}

/** PDF magic-number sniff (`%PDF-`), mirroring looksLikeDocx (T20.8). */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
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
  const isDocx = input.kind === 'docx';
  const caps = opts.caps ?? DEFAULT_CAPS;

  let blocks: MEl[];
  let sourceTitle: string | undefined;
  let sourceLang: string | undefined;
  let stylesheet: string | undefined;
  let assets: LoadedAsset[] = [];
  let sourceMap: Record<string, string> = {};
  // WP20 T20.8: authored page breaks and the document's own timestamp.
  let pageBreakBlocks: MEl[] = [];
  let docxDate: string | undefined;
  if (isDocx) {
    if (input.bytes === undefined) throw new Error('docx input requires bytes');
    const result = await convertDocx(input.bytes, report, caps);
    blocks = result.blocks;
    sourceTitle = result.title;
    sourceLang = result.language;
    stylesheet = result.stylesheet;
    assets = result.assets;
    pageBreakBlocks = result.pageBreakBlocks;
    docxDate = result.date;
  } else if (isMarkdown) {
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

  const date = opts.date ?? docxDate ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
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

  // WP20 T20.6/T20.8: authored page breaks travel as the `pagination`
  // extension (docs/ext-pagination.md §4): unique ids in document order.
  if (pageBreakBlocks.length > 0) {
    const breakBefore = [
      ...new Set(
        pageBreakBlocks.map((b) => b.attrs['id']).filter((id): id is string => id !== undefined),
      ),
    ];
    if (breakBefore.length > 0) {
      extFiles.set(
        'ext/pagination/pagination.json',
        enc.encode(`${JSON.stringify({ pagination: '0.1', breakBefore }, null, 2)}\n`),
      );
      extensions.push({ name: 'pagination', version: '0.1' });
    }
  }

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
    const ext = isDocx ? 'docx' : isMarkdown ? 'md' : 'html';
    const mainPath = `ext/source/${(await sha256Hex(input.sourceBytes)).slice(0, 16)}.${ext}`;
    // WP15: a web page's look lives in its external stylesheets — embed
    // them so the Original view is not an unstyled skeleton.
    let stylesheets: Record<string, string> = {};
    if (!isMarkdown && !isDocx && opts.fetchCss !== undefined) {
      const collected = await collectSourceStylesheets(input.text, opts.fetchCss, caps, report);
      for (const [path, bytes] of collected.files) extFiles.set(path, bytes);
      stylesheets = collected.stylesheets;
    }
    // ext-source 0.4: a binary original (docx) declares kind "binary" with
    // its media type and no encoding — the Original view offers a download.
    const sourceJson: Record<string, unknown> = isDocx
      ? {
          source: '0.4',
          kind: 'binary',
          main: mainPath,
          mainName: input.sourceName ?? '',
          mediaType: DOCX_MEDIA_TYPE,
          resources: {},
        }
      : {
          source: '0.3',
          kind: input.sourceKind ?? 'fetched-html',
          main: mainPath,
          mainName: input.sourceName ?? '',
          encoding: input.sourceEncoding ?? 'utf-8',
          resources: sourceMap,
        };
    // ext-source 0.5 (WP21): the author's visual rendition (a PDF saved
    // from the original application) travels next to the source. The
    // pipeline embeds it verbatim — it never generates or parses a PDF.
    let version = isDocx ? '0.4' : '0.3';
    if (input.visualBytes !== undefined) {
      if (!looksLikePdf(input.visualBytes)) {
        throw new Error('visual rendition is not a PDF (missing %PDF- signature)');
      }
      const visualPath = `ext/source/${(await sha256Hex(input.visualBytes)).slice(0, 16)}.pdf`;
      extFiles.set(visualPath, input.visualBytes);
      sourceJson['visual'] = {
        path: visualPath,
        mediaType: 'application/pdf',
        name: input.visualName ?? '',
      };
      version = '0.5';
      sourceJson['source'] = version;
      report.push(
        `embedded the author's PDF rendition as ${visualPath} (extension "source" 0.5, docs/ext-source.md)`,
      );
    }
    if (Object.keys(stylesheets).length > 0) sourceJson['stylesheets'] = stylesheets;
    extensions.push({ name: 'source', version });
    extFiles.set(mainPath, input.sourceBytes);
    extFiles.set('ext/source/source.json', enc.encode(`${JSON.stringify(sourceJson, null, 2)}\n`));
    report.push(
      `embedded the original source as ${mainPath} (extension "source", docs/ext-source.md)`,
    );
  } else if (input.visualBytes !== undefined) {
    // The rendition lives inside ext/source/ — it cannot travel alone.
    throw new Error('a visual rendition requires withSource (ext-source 0.5)');
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
