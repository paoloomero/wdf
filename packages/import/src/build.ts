import {
  computeHashes,
  extract,
  serializeHashes,
  serializeOutline,
  writePackage,
  WdfError,
  type WdfManifest,
} from '@wdf-dev/core';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

/**
 * Builds a canonical package from source files (spec §3.4, plan T3.2):
 * content/ is the source of truth — ai/ and integrity/ are always
 * regenerated, never taken from the source directory.
 */
export async function buildPackage(source: ReadonlyMap<string, Uint8Array>): Promise<Uint8Array> {
  const files = new Map<string, Uint8Array>();
  for (const [path, data] of source) {
    // ai/ and integrity/ are regenerated; anything else outside the package
    // locations (§3.2.3) — READMEs, comparison PDFs — is simply not packed.
    const top = path.split('/', 1)[0] ?? '';
    if (path !== 'manifest.json' && top !== 'content' && top !== 'data' && top !== 'ext') continue;
    files.set(path, data);
  }

  const manifestBytes = files.get('manifest.json');
  if (manifestBytes === undefined) throw new WdfError('missing manifest.json', '§3.3.1');
  const manifest = JSON.parse(dec.decode(manifestBytes)) as WdfManifest;

  const entryBytes = files.get('content/index.html');
  if (entryBytes === undefined) throw new WdfError('missing content/index.html', '§3.3.1');

  const { markdown, outline } = extract(dec.decode(entryBytes));
  files.set('ai/content.md', enc.encode(markdown));
  files.set('ai/outline.json', enc.encode(serializeOutline(outline)));
  files.set('integrity/hashes.json', enc.encode(serializeHashes(await computeHashes(files))));

  return writePackage({ manifest, files });
}
