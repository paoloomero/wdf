import { readFileSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';

import type { AssetCaps, AssetLoader, FontReader } from '@wdf-dev/import';

/**
 * The Node side of the injected import loaders (T7.5): filesystem access for
 * local inputs. The isomorphic pipeline in @wdf-dev/import never touches the
 * filesystem itself.
 */

/** Loads images referenced by relative paths from the input file's directory. */
export function localAssetLoader(baseDir: string, caps: AssetCaps): AssetLoader {
  return (src) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(src)) {
      return Promise.resolve({
        reason: 'remote or non-file reference (skipped for a local import)',
      });
    }
    const clean = (src.split(/[?#]/, 1)[0] ?? '').replace(/\\/g, '/');
    // Word URL-encodes the companion-folder path (spaces → %20), but the
    // folder on disk has literal spaces; decode before resolving.
    let decoded: string;
    try {
      decoded = decodeURIComponent(clean);
    } catch {
      decoded = clean;
    }
    const rel = normalize(decoded);
    if (isAbsolute(rel) || rel.split('/').includes('..')) {
      return Promise.resolve({ reason: 'path escapes the document directory' });
    }
    try {
      const bytes = new Uint8Array(readFileSync(join(baseDir, rel)));
      if (bytes.length > caps.perFile)
        return Promise.resolve({ reason: 'exceeds per-file size limit' });
      return Promise.resolve({ bytes });
    } catch {
      return Promise.resolve({ reason: 'file not found' });
    }
  };
}

/** The woff2 files ship with the CLI package (packages/cli/fonts/). */
const FONTS_DIR = join(import.meta.dirname, '../../fonts');

/** Reads a clone font face from the files shipped with the CLI. */
export const fsFontReader: FontReader = (fileName) =>
  new Uint8Array(readFileSync(join(FONTS_DIR, fileName)));
