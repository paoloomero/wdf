import { getAttr, isElement, type WdfElement } from './html/ast.js';
import { parseHtml } from './html/parse.js';
import type { WdfPackage } from './package.js';
import type { Violation } from './profile.js';
import { getSchemaValidators } from './schemas.js';
import type { WdfPagination } from './types.js';

// The `pagination` extension (docs/ext-pagination.md): authored page breaks
// anchored to stable element ids. Like `capture`, its payload is
// machine-validated — a declared extension that does not conform is an
// error. Beyond the schema, ids must exist in the entry document and be
// listed in document order (one canonical encoding, ext-pagination §4).

export const PAGINATION_PATH = 'ext/pagination/pagination.json';

const dec = new TextDecoder('utf-8', { fatal: true });

/** All id attribute values of the entry document, in document order. */
function documentIds(entryHtml: string): string[] {
  const ids: string[] = [];
  const walk = (el: WdfElement): void => {
    const id = getAttr(el, 'id');
    if (id !== undefined) ids.push(id);
    for (const child of el.children) {
      if (isElement(child)) walk(child);
    }
  };
  const root = parseHtml(entryHtml).html;
  if (root !== null) walk(root);
  return ids;
}

/**
 * Validates the `pagination` extension of a package, when declared.
 * Returns no violations for a package that does not use the extension;
 * the dir/manifest bijection itself is enforced structurally (§10.2).
 */
export function validatePaginationExt(pkg: WdfPackage): Violation[] {
  const declared = pkg.manifest.extensions?.some((e) => e.name === 'pagination') ?? false;
  const raw = pkg.files.get(PAGINATION_PATH);
  if (raw === undefined) {
    if (!declared) return [];
    return [
      {
        spec: 'ext-pagination §3',
        path: PAGINATION_PATH,
        message: 'the pagination extension requires ext/pagination/pagination.json',
        severity: 'error',
      },
    ];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(dec.decode(raw));
  } catch (e) {
    return [
      {
        spec: 'ext-pagination §4',
        path: PAGINATION_PATH,
        message: `pagination.json is not valid JSON (${String(e)})`,
        severity: 'error',
      },
    ];
  }
  const validate = getSchemaValidators().pagination;
  if (!validate(parsed)) {
    const detail = (validate.errors ?? [])
      .map((e) => `${e.instancePath === '' ? '/' : e.instancePath} ${e.message ?? ''}`)
      .join('; ');
    return [
      {
        spec: 'ext-pagination §4',
        path: PAGINATION_PATH,
        message: `does not conform to the pagination schema (${detail})`,
        severity: 'error',
      },
    ];
  }
  // §4: every id must reference an element of the entry document, and the
  // list must follow document order — one canonical encoding per break set.
  const violations: Violation[] = [];
  const entry = pkg.files.get(pkg.manifest.entry);
  const ids = entry === undefined ? [] : documentIds(dec.decode(entry));
  const positions = new Map(ids.map((id, i) => [id, i] as const));
  let last = -1;
  let ordered = true;
  for (const id of parsed.breakBefore) {
    const pos = positions.get(id);
    if (pos === undefined) {
      violations.push({
        spec: 'ext-pagination §4',
        path: PAGINATION_PATH,
        message: `breakBefore id "${id}" does not exist in the entry document`,
        severity: 'error',
      });
      continue;
    }
    if (pos < last) ordered = false;
    last = pos;
  }
  if (violations.length === 0 && !ordered) {
    violations.push({
      spec: 'ext-pagination §4',
      path: PAGINATION_PATH,
      message: 'breakBefore ids are not in document order',
      severity: 'error',
    });
  }
  return violations;
}

/**
 * Reads the pagination data of a package, tolerantly: undefined when the
 * extension is absent or its payload does not conform to the schema
 * (consumers MAY ignore extensions entirely, §10.3). Existence/order of
 * ids is a validator concern; a consumer simply skips unknown ids.
 */
export function parsePaginationExt(
  files: ReadonlyMap<string, Uint8Array>,
): WdfPagination | undefined {
  const raw = files.get(PAGINATION_PATH);
  if (raw === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(dec.decode(raw));
    return getSchemaValidators().pagination(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
