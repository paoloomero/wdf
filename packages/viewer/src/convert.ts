import {
  decodeHtml,
  DEFAULT_CAPS,
  importDocument,
  looksLikeDocx,
  type AssetLoader,
  type CssFetcher,
  type ImportedDocument,
  type ImportInput,
} from '@wdf-dev/import';

/**
 * In-browser converter (T7.6, plan §10.24): the dropped files become an
 * in-memory map and the isomorphic pipeline runs on it — the same code path
 * as the CLI, so the same input yields a byte-identical package. No network,
 * ever: remote references are dropped and reported.
 */

/** A dropped file set: package-style relative paths (posix) → bytes. */
export type FileMap = ReadonlyMap<string, Uint8Array>;

const SUPPORT_DIR = /\.(fld|files)\//i;

/**
 * Picks the document to convert from a dropped set: the shallowest HTML (or
 * Markdown) file outside Word/browser support folders; ties break
 * alphabetically, so the choice is deterministic.
 */
export function pickMainFile(files: FileMap): string | undefined {
  const shallowestFirst = (a: string, b: string): number =>
    a.split('/').length - b.split('/').length || (a < b ? -1 : a > b ? 1 : 0);
  const candidates = [...files.keys()]
    .filter((p) => /\.(html?|md|markdown)$/i.test(p) && !SUPPORT_DIR.test(p))
    .sort(shallowestFirst);
  if (candidates.length > 0) return candidates[0];
  // WP20 T20.8: no web document dropped — a .docx converts natively (the
  // check is by content, so a mis-named file still routes correctly).
  const docx = [...files.keys()]
    .filter((p) => {
      const bytes = files.get(p);
      return bytes !== undefined && looksLikeDocx(bytes);
    })
    .sort(shallowestFirst);
  return docx[0];
}

/** Resolves `rel` against the directory of `from`, staying inside the set. */
function resolvePath(from: string, rel: string): string | undefined {
  const dir = from.split('/').slice(0, -1);
  const parts = rel.split('/');
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (dir.length === 0) return undefined;
      dir.pop();
      continue;
    }
    dir.push(part);
  }
  return dir.join('/');
}

/** Strips query/hash and URL-encoding from a reference in the source HTML. */
function cleanRef(src: string): string {
  const clean = (src.split(/[?#]/, 1)[0] ?? '').replace(/\\/g, '/');
  try {
    return decodeURIComponent(clean);
  } catch {
    return clean;
  }
}

/** Loads images from the dropped set; anything remote is refused (no network). */
export function mapAssetLoader(files: FileMap, mainPath: string, perFile: number): AssetLoader {
  return (src) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')) {
      return Promise.resolve({
        reason: 'remote reference (the browser converter makes no network requests)',
      });
    }
    const path = resolvePath(mainPath, cleanRef(src));
    const bytes = path === undefined ? undefined : files.get(path);
    if (bytes === undefined) return Promise.resolve({ reason: 'not among the dropped files' });
    if (bytes.length > perFile) return Promise.resolve({ reason: 'exceeds per-file size limit' });
    return Promise.resolve({ bytes });
  };
}

function mapSiblingLoader(
  files: FileMap,
  mainPath: string,
): (relPath: string) => Promise<Uint8Array | undefined> {
  return (relPath) => {
    const path = resolvePath(mainPath, cleanRef(relPath));
    return Promise.resolve(path === undefined ? undefined : files.get(path));
  };
}

function mapCssFetcher(files: FileMap, mainPath: string): CssFetcher {
  return (href) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) {
      return Promise.resolve(undefined); // remote stylesheet: reported as skipped
    }
    const path = resolvePath(mainPath, cleanRef(href));
    return Promise.resolve(path === undefined ? undefined : files.get(path));
  };
}

export interface ConvertOptions {
  withSource?: boolean;
  /** Manifest timestamp; tests pin it for byte-identity with the CLI. */
  date?: string;
}

export interface Converted extends ImportedDocument {
  /** Suggested output file name, `<input base name>.wdf`. */
  fileName: string;
}

/**
 * Converts a dropped file set fully client-side. Returns undefined when the
 * set has no representable content; throws when it has no document at all.
 */
export async function convertFiles(
  files: FileMap,
  opts: ConvertOptions = {},
): Promise<Converted | undefined> {
  const mainPath = pickMainFile(files);
  if (mainPath === undefined) {
    throw new Error('no HTML or Markdown document among the dropped files');
  }
  const bytes = files.get(mainPath);
  if (bytes === undefined) throw new Error(`unreadable dropped file ${mainPath}`);

  const report: string[] = [];
  const baseName = (mainPath.split('/').pop() ?? mainPath).replace(/\.[^.]+$/, '');
  const isMarkdown = /\.(md|markdown)$/i.test(mainPath);
  const isDocx = looksLikeDocx(bytes);

  let text = '';
  let sourceEncoding = 'utf-8';
  if (isDocx) {
    // WP20 T20.8: the native importer takes the bytes as they are.
  } else if (isMarkdown) {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } else {
    const decoded = decodeHtml(bytes);
    text = decoded.text;
    sourceEncoding = decoded.encoding;
    if (decoded.encoding !== 'utf-8') {
      report.push(`decoded source as ${decoded.encoding} (declared or detected)`);
    }
  }

  const input: ImportInput = {
    kind: isDocx ? 'docx' : isMarkdown ? 'markdown' : 'html',
    text,
    baseName,
    sourceBytes: bytes,
    sourceName: mainPath.split('/').pop() ?? mainPath,
    sourceEncoding,
  };
  if (isDocx) input.bytes = bytes;
  const result = await importDocument(
    input,
    {
      ...(opts.withSource === true && { withSource: true }),
      ...(opts.date !== undefined && { date: opts.date }),
      loadAsset: mapAssetLoader(files, mainPath, DEFAULT_CAPS.perFile),
      loadSibling: mapSiblingLoader(files, mainPath),
      fetchCss: mapCssFetcher(files, mainPath),
    },
    report,
  );
  return result === undefined ? undefined : { ...result, fileName: `${baseName}.wdf` };
}
