import {
  elementChildren,
  findChild,
  getAttr,
  normalizedText,
  type WdfElement,
} from './html/ast.js';
import { parseHtml } from './html/parse.js';
import type { WdfPackage } from './package.js';
import type { Violation } from './profile.js';
import type { WdfDataset, WdfDatasetColumn } from './types.js';

/** A dataset cell value as stored in JSON (spec §5.1.4). */
export type WdfCell = string | number | boolean | null;

/** The parsed shape of a data/*.json file (spec §5.1). */
export interface WdfDatasetFile {
  columns: WdfDatasetColumn[];
  rows: WdfCell[][];
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Valid proleptic Gregorian calendar date, checked without Date.parse
 * (which accepts non-conforming inputs and is locale-adjacent). */
function isValidDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (m === null) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (days[month - 1] ?? 0);
}

const MAX_SAFE = 2 ** 53 - 1;

/** Type check for one cell against its column type (spec §5.1.4, §5.2). */
export function cellMatchesType(value: WdfCell, type: WdfDatasetColumn['type']): boolean {
  if (value === null) return true;
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= MAX_SAFE;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      return typeof value === 'string' && isValidDate(value);
  }
}

/**
 * Canonical text rendering of a cell (spec §5.2): the exact text a bound
 * table must display. ECMAScript ToString for numbers — deterministic and
 * locale-independent.
 */
export function canonicalCellText(value: WdfCell): string {
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function error(spec: string, path: string, message: string): Violation {
  return { spec, path, message, severity: 'error' };
}

/**
 * Parses and validates a dataset file against its manifest declaration
 * (spec §5.1). Returns the parsed dataset only when it is fully valid.
 */
export function parseDatasetFile(
  bytes: Uint8Array,
  declared: WdfDataset,
): { dataset?: WdfDatasetFile; violations: Violation[] } {
  const path = declared.path;
  const violations: Violation[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (e) {
    return { violations: [error('§5.1', path, `not valid UTF-8 JSON (${String(e)})`)] };
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { columns?: unknown }).columns) ||
    !Array.isArray((parsed as { rows?: unknown }).rows)
  ) {
    return {
      violations: [error('§5.1', path, 'a dataset file is { "columns": […], "rows": […] }')],
    };
  }
  const file = parsed as { columns: unknown[]; rows: unknown[] };

  // §5.1.1 — columns identical to the manifest declaration.
  const declaredColumns = declared.schema.columns;
  const sameColumns =
    file.columns.length === declaredColumns.length &&
    declaredColumns.every((col, i) => {
      const c = file.columns[i] as { name?: unknown; type?: unknown } | undefined;
      return c !== undefined && c.name === col.name && c.type === col.type;
    });
  if (!sameColumns) {
    violations.push(
      error('§5.1.1', path, 'columns differ from the schema declared in the manifest'),
    );
  }

  // §5.1.2 — unique column names.
  const names = new Set(declaredColumns.map((c) => c.name));
  if (names.size !== declaredColumns.length) {
    violations.push(error('§5.1.2', path, 'column names must be unique'));
  }

  // §5.1.3 / §5.1.4 — row shapes and cell types.
  const rows: WdfCell[][] = [];
  file.rows.forEach((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== declaredColumns.length) {
      violations.push(
        error('§5.1.3', path, `row ${String(rowIndex + 1)} must have exactly one cell per column`),
      );
      return;
    }
    row.forEach((cell, colIndex) => {
      const column = declaredColumns[colIndex];
      if (column === undefined) return;
      const ok =
        (typeof cell === 'string' ||
          typeof cell === 'number' ||
          typeof cell === 'boolean' ||
          cell === null) &&
        cellMatchesType(cell as WdfCell, column.type);
      if (!ok) {
        violations.push(
          error(
            '§5.1.4',
            path,
            `row ${String(rowIndex + 1)}, column "${column.name}": ${JSON.stringify(cell)} is not a valid ${column.type}`,
          ),
        );
      }
    });
    rows.push(row as WdfCell[]);
  });

  if (violations.length > 0) return { violations };
  return { dataset: { columns: declaredColumns, rows }, violations };
}

/**
 * Checks that a bound table displays exactly its dataset (spec §6.5.3–§6.5.4)
 * — the machine-checkable guarantee that the visible table and the typed data
 * are the same information.
 */
export function checkTableCorrespondence(
  table: WdfElement,
  dataset: WdfDatasetFile,
  tablePath: string,
): Violation[] {
  const violations: Violation[] = [];

  const headRow = elementChildren(findChild(table, 'thead') ?? table).find((r) => r.tag === 'tr');
  const headers = headRow === undefined ? [] : elementChildren(headRow).map(normalizedText);
  if (headers.length !== dataset.columns.length) {
    violations.push(
      error(
        '§6.5.3',
        tablePath,
        `header has ${String(headers.length)} cells, dataset has ${String(dataset.columns.length)} columns`,
      ),
    );
  } else {
    dataset.columns.forEach((col, i) => {
      if (headers[i] !== col.name) {
        violations.push(
          error(
            '§6.5.3',
            tablePath,
            `header cell ${String(i + 1)} is "${headers[i] ?? ''}", expected column name "${col.name}"`,
          ),
        );
      }
    });
  }

  const tbody = findChild(table, 'tbody');
  const bodyRows = tbody === undefined ? [] : elementChildren(tbody).filter((r) => r.tag === 'tr');
  if (bodyRows.length !== dataset.rows.length) {
    violations.push(
      error(
        '§6.5.4',
        tablePath,
        `table body has ${String(bodyRows.length)} rows, dataset has ${String(dataset.rows.length)}`,
      ),
    );
    return violations;
  }
  dataset.rows.forEach((row, rowIndex) => {
    const tr = bodyRows[rowIndex];
    const cells = tr === undefined ? [] : elementChildren(tr).map(normalizedText);
    row.forEach((value, colIndex) => {
      const expected = canonicalCellText(value);
      if (cells[colIndex] !== expected) {
        violations.push(
          error(
            '§6.5.4',
            tablePath,
            `row ${String(rowIndex + 1)}, cell ${String(colIndex + 1)}: table shows "${cells[colIndex] ?? ''}", canonical rendering of ${JSON.stringify(value)} is "${expected}"`,
          ),
        );
      }
    });
  });

  return violations;
}

function findBoundTables(el: WdfElement, path: string, out: [WdfElement, string, string][]): void {
  elementChildren(el).forEach((child, i) => {
    const id = getAttr(child, 'id');
    const childPath = `${path}/${child.tag}${id === undefined ? `[${String(i + 1)}]` : `#${id}`}`;
    const bound = getAttr(child, 'data-wdf-dataset');
    if (child.tag === 'table' && bound !== undefined) out.push([child, childPath, bound]);
    findBoundTables(child, childPath, out);
  });
}

/**
 * Package-level dataset validation (spec §5, §6.5): every declared dataset
 * file is valid, and every bound table matches its dataset.
 */
export function validateDatasets(pkg: WdfPackage): Violation[] {
  const violations: Violation[] = [];
  const datasets = new Map<string, WdfDatasetFile>();

  for (const declared of pkg.manifest.datasets ?? []) {
    const bytes = pkg.files.get(declared.path);
    if (bytes === undefined) continue; // §4.1.1 already reported by readPackage
    const { dataset, violations: fileViolations } = parseDatasetFile(bytes, declared);
    violations.push(...fileViolations);
    if (dataset !== undefined) datasets.set(declared.path, dataset);
  }

  const entryBytes = pkg.files.get(pkg.manifest.entry);
  if (entryBytes !== undefined) {
    const doc = parseHtml(new TextDecoder().decode(entryBytes));
    const body = doc.html === null ? undefined : findChild(doc.html, 'body');
    if (body !== undefined) {
      const bound: [WdfElement, string, string][] = [];
      findBoundTables(body, 'html/body', bound);
      for (const [table, tablePath, datasetPath] of bound) {
        const declared = (pkg.manifest.datasets ?? []).some((d) => d.path === datasetPath);
        if (!declared) {
          violations.push(
            error(
              '§6.5.1',
              tablePath,
              `data-wdf-dataset "${datasetPath}" is not declared in the manifest datasets`,
            ),
          );
          continue;
        }
        const dataset = datasets.get(datasetPath);
        if (dataset !== undefined) {
          violations.push(...checkTableCorrespondence(table, dataset, tablePath));
        }
      }
    }
  }

  return violations;
}
