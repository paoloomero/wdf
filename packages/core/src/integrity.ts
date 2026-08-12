import { extract, serializeOutline } from './extract.js';
import type { WdfPackage } from './package.js';
import type { Violation } from './profile.js';
import { getSchemaValidators } from './schemas.js';
import type { WdfHashes } from './types.js';

/** The one file never covered by the hash manifest: itself (spec §8.1). */
const HASHES_PATH = 'integrity/hashes.json';

// WebCrypto is the one crypto API present in both browsers and Node ≥ 20
// (spec table: no dependency needed). Typed structurally so @wdf-dev/core keeps
// compiling without lib.dom or Node type definitions.
interface SubtleLike {
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
}

function subtle(): SubtleLike {
  const api = (globalThis as { crypto?: { subtle?: SubtleLike } }).crypto?.subtle;
  if (api === undefined) {
    throw new Error('WebCrypto (globalThis.crypto.subtle) is not available in this environment');
  }
  return api;
}

/** Lowercase hex SHA-256 of raw bytes (spec §8.1). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await subtle().digest('SHA-256', bytes));
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/**
 * Computes the hash manifest for a file set: every file except
 * integrity/hashes.json itself, keys in ascending code point order (§8.1).
 */
export async function computeHashes(files: ReadonlyMap<string, Uint8Array>): Promise<WdfHashes> {
  const paths = [...files.keys()]
    .filter((p) => p !== HASHES_PATH)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const entries: Record<string, string> = {};
  for (const path of paths) {
    const data = files.get(path);
    if (data !== undefined) entries[path] = await sha256Hex(data);
  }
  return { algorithm: 'sha256', files: entries };
}

/** Canonical JSON serialization of a hash manifest (§7.9, §8.1). */
export function serializeHashes(hashes: WdfHashes): string {
  return `${JSON.stringify({ algorithm: hashes.algorithm, files: hashes.files }, null, 2)}\n`;
}

export interface VerifyResult {
  /** Every file's digest matches integrity/hashes.json (§8.2 step 2). */
  integrity: boolean;
  /** extract(entry) reproduces ai/content.md and ai/outline.json (§8.2 step 3). */
  determinism: boolean;
  /** integrity && determinism. Structure (§8.2 step 1) was already enforced by readPackage. */
  verified: boolean;
  problems: Violation[];
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/**
 * Verifies a structurally valid package per spec §8.2: recomputes every hash
 * and re-runs the canonical extraction. A package is `verified` only when
 * both pass; problems carry the spec section they enforce.
 */
export async function verifyPackage(pkg: WdfPackage): Promise<VerifyResult> {
  const problems: Violation[] = [];
  const report = (spec: string, path: string, message: string) => {
    problems.push({ spec, path, message, severity: 'error' });
  };

  // §8.2 step 2 — hashes.
  let declared: WdfHashes | undefined;
  const hashesBytes = pkg.files.get(HASHES_PATH);
  if (hashesBytes === undefined) {
    report('§3.3.1', HASHES_PATH, 'missing hash manifest');
  } else {
    try {
      const parsed: unknown = JSON.parse(decodeUtf8(hashesBytes));
      const validate = getSchemaValidators().hashes;
      if (validate(parsed)) {
        declared = parsed;
      } else {
        const detail = (validate.errors ?? [])
          .map((e) => `${e.instancePath === '' ? '/' : e.instancePath} ${e.message ?? ''}`)
          .join('; ');
        report('§8.1', HASHES_PATH, `does not conform to the hashes schema (${detail})`);
      }
    } catch (e) {
      report('§8.1', HASHES_PATH, `not valid UTF-8 JSON (${String(e)})`);
    }
  }

  if (declared !== undefined) {
    const computed = await computeHashes(pkg.files);
    for (const [path, digest] of Object.entries(computed.files)) {
      const claimed = declared.files[path];
      if (claimed === undefined) {
        report('§8.1', path, 'file present in the package but missing from integrity/hashes.json');
      } else if (claimed !== digest) {
        report(
          '§8.2',
          path,
          `digest mismatch: hashes.json declares ${claimed}, actual is ${digest}`,
        );
      }
    }
    for (const path of Object.keys(declared.files)) {
      if (!(path in computed.files)) {
        report('§8.1', path, 'listed in integrity/hashes.json but not present in the package');
      }
    }
  }
  const integrity = declared !== undefined && problems.length === 0;

  // §8.2 step 3 — determinism.
  let determinism = false;
  const entryBytes = pkg.files.get(pkg.manifest.entry);
  const contentBytes = pkg.files.get('ai/content.md');
  const outlineBytes = pkg.files.get('ai/outline.json');
  if (entryBytes !== undefined && contentBytes !== undefined && outlineBytes !== undefined) {
    determinism = true;
    try {
      const result = extract(decodeUtf8(entryBytes));
      if (result.markdown !== decodeUtf8(contentBytes)) {
        determinism = false;
        report(
          '§7.1.1',
          'ai/content.md',
          'not byte-identical to the canonical extraction of the entry document',
        );
      }
      if (serializeOutline(result.outline) !== decodeUtf8(outlineBytes)) {
        determinism = false;
        report(
          '§7.1.2',
          'ai/outline.json',
          'not byte-identical to the canonical outline of the entry document',
        );
      }
    } catch (e) {
      determinism = false;
      report('§7.1', pkg.manifest.entry, `extraction failed (${String(e)})`);
    }
  } else {
    report('§3.3.1', pkg.manifest.entry, 'missing files required for the determinism check');
  }

  return { integrity, determinism, verified: integrity && determinism, problems };
}
