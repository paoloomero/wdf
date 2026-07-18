import { unzipSync, zipSync, type UnzipFileInfo, type Zippable } from 'fflate';

import { WdfError } from './errors.js';
import { getSchemaValidators } from './schemas.js';
import type { WdfManifest } from './types.js';

/**
 * An in-memory WDF package. `files` holds every archive entry, including
 * `manifest.json`, as raw bytes: the bytes are the source of truth (they are
 * what the integrity hashes cover), `manifest` is the parsed convenience copy.
 */
export interface WdfPackage {
  readonly manifest: WdfManifest;
  readonly files: ReadonlyMap<string, Uint8Array>;
}

const PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const TOP_LEVEL_DIRS = new Set(['content', 'data', 'ai', 'ext', 'integrity']);
const EXT_NAME = /^[a-z][a-z0-9-]*$/;
const REQUIRED_FILES = [
  'manifest.json',
  'content/index.html',
  'ai/content.md',
  'ai/outline.json',
  'integrity/hashes.json',
];
const UNLISTED_CONTENT_FILES = new Set(['content/index.html', 'content/styles.css']);

/** Spec §3.4.2: all entry timestamps are fixed to the DOS epoch (local time fields). */
const DOS_EPOCH = new Date(1980, 0, 1, 0, 0, 0);
/** Spec §3.4.3: fixed compression settings for stable output. */
const DEFLATE_LEVEL = 6;

function isValidPackagePath(path: string): boolean {
  const segments = path.split('/');
  return segments.length > 0 && segments.every((s) => PATH_SEGMENT.test(s));
}

function parseManifest(bytes: Uint8Array): WdfManifest {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new WdfError('manifest.json must not begin with a byte order mark', '§2');
  }
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (e) {
    throw new WdfError(`manifest.json is not valid UTF-8 JSON (${String(e)})`, '§4');
  }
  const validate = getSchemaValidators().manifest;
  if (!validate(data)) {
    const detail = (validate.errors ?? [])
      .map((e) => `${e.instancePath === '' ? '/' : e.instancePath} ${e.message ?? ''}`)
      .join('; ');
    throw new WdfError(`manifest.json does not conform to the manifest schema (${detail})`, '§4');
  }
  return data;
}

/**
 * Checks the container-level structure of a file set (spec §3.2–§3.3, §4.1.1,
 * §10.2) and returns the parsed manifest. Shared by read and write paths.
 */
export function checkPackageStructure(files: ReadonlyMap<string, Uint8Array>): WdfManifest {
  for (const path of files.keys()) {
    if (!isValidPackagePath(path)) {
      throw new WdfError('invalid package path', '§3.2.1', path);
    }
    const first = path.split('/', 1)[0] ?? '';
    if (path !== 'manifest.json' && (!TOP_LEVEL_DIRS.has(first) || !path.includes('/'))) {
      throw new WdfError('file outside the permitted package locations', '§3.2.3', path);
    }
    if (first === 'integrity' && path !== 'integrity/hashes.json') {
      throw new WdfError('integrity/ may contain only hashes.json', '§3.3.3', path);
    }
  }

  for (const required of REQUIRED_FILES) {
    if (!files.has(required)) {
      throw new WdfError('missing required package file', '§3.3.1', required);
    }
  }

  const manifestBytes = files.get('manifest.json');
  if (manifestBytes === undefined) throw new WdfError('missing manifest', '§3.3.1');
  const manifest = parseManifest(manifestBytes);

  // §3.3.4 / §4.1.1 — resources and datasets list exactly the optional files.
  const listedResources = (manifest.resources ?? []).map((r) => r.path);
  const listedDatasets = (manifest.datasets ?? []).map((d) => d.path);
  for (const [label, listed, section] of [
    ['resource', listedResources, '§4.1.1'],
    ['dataset', listedDatasets, '§4.1.1'],
  ] as const) {
    const seen = new Set<string>();
    for (const path of listed) {
      if (seen.has(path)) throw new WdfError(`duplicate ${label} listing`, section, path);
      seen.add(path);
      if (!files.has(path)) {
        throw new WdfError(`${label} listing references a file not in the package`, section, path);
      }
    }
  }
  const resourceSet = new Set(listedResources);
  const datasetSet = new Set(listedDatasets);
  for (const path of files.keys()) {
    if (
      path.startsWith('content/') &&
      !UNLISTED_CONTENT_FILES.has(path) &&
      !resourceSet.has(path)
    ) {
      throw new WdfError('content file not listed in manifest resources', '§3.3.4', path);
    }
    if (path.startsWith('data/') && !datasetSet.has(path)) {
      throw new WdfError('data file not listed in manifest datasets', '§3.3.4', path);
    }
  }
  for (const path of resourceSet) {
    if (!path.startsWith('content/') || UNLISTED_CONTENT_FILES.has(path)) {
      throw new WdfError('resources may list only additional files under content/', '§4.1', path);
    }
  }

  // §10.1–§10.2 — extension files and manifest declarations are in bijection.
  const declaredExtensions = new Set((manifest.extensions ?? []).map((e) => e.name));
  const extDirs = new Set<string>();
  for (const path of files.keys()) {
    if (!path.startsWith('ext/')) continue;
    const name = path.split('/')[1] ?? '';
    if (!EXT_NAME.test(name) || path.split('/').length < 3) {
      throw new WdfError('extension files must live under ext/<name>/', '§10.2', path);
    }
    extDirs.add(name);
    if (!declaredExtensions.has(name)) {
      throw new WdfError('extension files present but not declared in the manifest', '§10.2', path);
    }
  }
  for (const name of declaredExtensions) {
    if (!EXT_NAME.test(name)) {
      throw new WdfError('invalid extension name', '§10.1', name);
    }
    if (!extDirs.has(name)) {
      throw new WdfError('extension declared in the manifest but has no files', '§10.2', name);
    }
  }

  return manifest;
}

/** Reads and structurally validates a `.wdf` package (spec §3, §4). */
export function readPackage(bytes: Uint8Array): WdfPackage {
  const entries: UnzipFileInfo[] = [];
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes, {
      filter: (info) => {
        entries.push(info);
        // Defer violations to the checks below; skip what fflate cannot inflate.
        return !info.name.endsWith('/') && (info.compression === 0 || info.compression === 8);
      },
    });
  } catch (e) {
    throw new WdfError(`not a readable ZIP archive (${String(e)})`, '§3.1');
  }

  const seen = new Set<string>();
  for (const info of entries) {
    if (info.name.endsWith('/')) {
      throw new WdfError('archive must not contain directory entries', '§3.1.4', info.name);
    }
    if (info.compression !== 0 && info.compression !== 8) {
      throw new WdfError(
        `unsupported compression method ${String(info.compression)}`,
        '§3.1.1',
        info.name,
      );
    }
    if (seen.has(info.name)) {
      throw new WdfError('duplicate entry name in archive', '§3.1.3', info.name);
    }
    seen.add(info.name);
  }

  const files = new Map<string, Uint8Array>(Object.entries(unzipped));
  const manifest = checkPackageStructure(files);
  return { manifest, files };
}

/**
 * Writes a package as a canonical ZIP archive (spec §3.4): `manifest.json`
 * first, remaining entries in ascending code point order, DOS-epoch
 * timestamps, fixed compression settings. Output depends only on `pkg.files`
 * contents, never on map insertion order — pack → unpack → pack is the
 * identity.
 */
export function writePackage(pkg: WdfPackage): Uint8Array {
  checkPackageStructure(pkg.files);

  const order = [...pkg.files.keys()]
    .filter((p) => p !== 'manifest.json')
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const zippable: Zippable = {};
  const manifestBytes = pkg.files.get('manifest.json');
  if (manifestBytes === undefined) throw new WdfError('missing manifest', '§3.3.1');
  zippable['manifest.json'] = manifestBytes;
  for (const path of order) {
    const data = pkg.files.get(path);
    if (data !== undefined) zippable[path] = data;
  }

  return zipSync(zippable, { level: DEFLATE_LEVEL, mtime: DOS_EPOCH, os: 0 });
}
