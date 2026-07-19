import { describe, expect, it } from 'vitest';

import {
  canonicalCellText,
  cellMatchesType,
  checkTableCorrespondence,
  parseDatasetFile,
  validateDatasets,
  type WdfDatasetFile,
} from '../src/dataset.js';
import { parseHtml } from '../src/html/parse.js';
import { findChild, type WdfElement } from '../src/html/ast.js';
import type { WdfPackage } from '../src/package.js';
import type { WdfDataset, WdfManifest } from '../src/types.js';

const enc = new TextEncoder();

const declared: WdfDataset = {
  path: 'data/spesa-2025.json',
  title: 'Spesa 2025',
  schema: {
    columns: [
      { name: 'capitolo', type: 'string' },
      { name: 'anno', type: 'integer' },
      { name: 'importo', type: 'number' },
      { name: 'approvato', type: 'boolean' },
      { name: 'scadenza', type: 'date' },
    ],
  },
};

const goodRows = [
  ['1010', 2025, 1250000.5, true, '2026-12-31'],
  ['2020', 2025, 900, false, null],
];

function datasetBytes(overrides: Partial<{ columns: unknown; rows: unknown }> = {}): Uint8Array {
  return enc.encode(
    JSON.stringify({
      columns: overrides.columns ?? declared.schema.columns,
      rows: overrides.rows ?? goodRows,
    }),
  );
}

describe('canonicalCellText (§5.2)', () => {
  it('renders every type deterministically', () => {
    expect(canonicalCellText('1010')).toBe('1010');
    expect(canonicalCellText(2025)).toBe('2025');
    expect(canonicalCellText(1250000.5)).toBe('1250000.5');
    expect(canonicalCellText(1310000.0)).toBe('1310000');
    expect(canonicalCellText(0.1)).toBe('0.1');
    expect(canonicalCellText(1e21)).toBe('1e+21');
    expect(canonicalCellText(true)).toBe('true');
    expect(canonicalCellText(false)).toBe('false');
    expect(canonicalCellText('2026-12-31')).toBe('2026-12-31');
    expect(canonicalCellText(null)).toBe('');
  });
});

describe('cellMatchesType (§5.1.4)', () => {
  it('accepts matching values and null everywhere', () => {
    expect(cellMatchesType('x', 'string')).toBe(true);
    expect(cellMatchesType(42, 'integer')).toBe(true);
    expect(cellMatchesType(4.2, 'number')).toBe(true);
    expect(cellMatchesType(true, 'boolean')).toBe(true);
    expect(cellMatchesType('2024-02-29', 'date')).toBe(true); // leap year
    for (const type of ['string', 'integer', 'number', 'boolean', 'date'] as const) {
      expect(cellMatchesType(null, type)).toBe(true);
    }
  });

  it('rejects mismatches', () => {
    expect(cellMatchesType(4.2, 'integer')).toBe(false);
    expect(cellMatchesType(2 ** 53, 'integer')).toBe(false);
    expect(cellMatchesType('42', 'integer')).toBe(false);
    expect(cellMatchesType(Infinity, 'number')).toBe(false);
    expect(cellMatchesType(1, 'boolean')).toBe(false);
    expect(cellMatchesType('2026-02-30', 'date')).toBe(false);
    expect(cellMatchesType('2026-13-01', 'date')).toBe(false);
    expect(cellMatchesType('2025-02-29', 'date')).toBe(false); // not a leap year
    expect(cellMatchesType('31/12/2026', 'date')).toBe(false);
  });
});

describe('parseDatasetFile (§5.1)', () => {
  it('accepts a fully valid dataset', () => {
    const { dataset, violations } = parseDatasetFile(datasetBytes(), declared);
    expect(violations).toEqual([]);
    expect(dataset?.rows).toEqual(goodRows);
  });

  it('rejects columns differing from the manifest (§5.1.1)', () => {
    const columns = [...declared.schema.columns.slice(0, 4), { name: 'scadenza', type: 'string' }];
    const { violations } = parseDatasetFile(datasetBytes({ columns }), declared);
    expect(violations.some((v) => v.spec === '§5.1.1')).toBe(true);
  });

  it('rejects a ragged row (§5.1.3)', () => {
    const rows = [...goodRows, ['3030', 2025]];
    const { violations } = parseDatasetFile(datasetBytes({ rows }), declared);
    expect(violations.some((v) => v.spec === '§5.1.3' && v.message.includes('row 3'))).toBe(true);
  });

  it('rejects wrong cell types with a precise message (§5.1.4)', () => {
    const rows = [['1010', 2025.5, 'not-a-number', 'yes', '2026-02-30']];
    const { violations } = parseDatasetFile(datasetBytes({ rows }), declared);
    const specs = violations.map((v) => v.spec);
    expect(specs.filter((s) => s === '§5.1.4')).toHaveLength(4);
    expect(violations.some((v) => v.message.includes('"anno"'))).toBe(true);
  });

  it('rejects duplicate column names (§5.1.2)', () => {
    const dup: WdfDataset = {
      path: 'data/x.json',
      schema: {
        columns: [
          { name: 'a', type: 'string' },
          { name: 'a', type: 'integer' },
        ],
      },
    };
    const bytes = enc.encode(JSON.stringify({ columns: dup.schema.columns, rows: [] }));
    const { violations } = parseDatasetFile(bytes, dup);
    expect(violations.some((v) => v.spec === '§5.1.2')).toBe(true);
  });

  it('rejects non-dataset JSON shapes (§5.1)', () => {
    const { violations } = parseDatasetFile(enc.encode('[1,2,3]'), declared);
    expect(violations.some((v) => v.spec === '§5.1')).toBe(true);
  });
});

const coherentTable = `
<table id="tbl-spesa" data-wdf-dataset="data/spesa-2025.json">
  <caption>Spesa 2025</caption>
  <thead><tr><th>capitolo</th><th>anno</th><th>importo</th><th>approvato</th><th>scadenza</th></tr></thead>
  <tbody>
    <tr><td>1010</td><td>2025</td><td>1250000.5</td><td>true</td><td>2026-12-31</td></tr>
    <tr><td>2020</td><td>2025</td><td>900</td><td>false</td><td></td></tr>
  </tbody>
</table>`;

function tableFrom(html: string): WdfElement {
  const doc = parseHtml(`<!DOCTYPE html><html><body><article>${html}</article></body></html>`);
  const article = findChild(findChild(doc.html as WdfElement, 'body') as WdfElement, 'article');
  return findChild(article as WdfElement, 'table') as WdfElement;
}

function datasetOf(): WdfDatasetFile {
  return { columns: declared.schema.columns, rows: goodRows as WdfDatasetFile['rows'] };
}

describe('checkTableCorrespondence (§6.5, T2.5 acceptance)', () => {
  it('accepts a coherent table', () => {
    expect(checkTableCorrespondence(tableFrom(coherentTable), datasetOf(), 't')).toEqual([]);
  });

  it('rejects a wrong header name (§6.5.3)', () => {
    const html = coherentTable.replace('<th>anno</th>', '<th>year</th>');
    const violations = checkTableCorrespondence(tableFrom(html), datasetOf(), 't');
    expect(violations.some((v) => v.spec === '§6.5.3' && v.message.includes('"anno"'))).toBe(true);
  });

  it('rejects a locale-formatted amount that diverges from canonical rendering (§6.5.4)', () => {
    const html = coherentTable.replace('<td>1250000.5</td>', '<td>1.250.000,50</td>');
    const violations = checkTableCorrespondence(tableFrom(html), datasetOf(), 't');
    expect(violations.some((v) => v.spec === '§6.5.4' && v.message.includes('1250000.5'))).toBe(
      true,
    );
  });

  it('rejects a row count mismatch (§6.5.4)', () => {
    const html = coherentTable.replace(
      '</tbody>',
      '<tr><td>3030</td><td>2025</td><td>1</td><td>true</td><td></td></tr></tbody>',
    );
    const violations = checkTableCorrespondence(tableFrom(html), datasetOf(), 't');
    expect(violations.some((v) => v.spec === '§6.5.4' && v.message.includes('rows'))).toBe(true);
  });
});

describe('validateDatasets — package level', () => {
  function packageWith(tableHtml: string, manifestDatasets: WdfDataset[]): WdfPackage {
    const manifest: WdfManifest = {
      wdf: '0.1',
      id: 'urn:uuid:6f1f6b2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b',
      title: 'T',
      language: 'it',
      created: '2026-08-01T10:00:00Z',
      modified: '2026-08-01T10:00:00Z',
      entry: 'content/index.html',
      datasets: manifestDatasets,
    };
    const html = `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>T</title></head><body><article><h1 id="h-t">T</h1>${tableHtml}</article></body></html>`;
    const files = new Map<string, Uint8Array>([
      ['manifest.json', enc.encode(JSON.stringify(manifest))],
      ['content/index.html', enc.encode(html)],
      ['ai/content.md', enc.encode('')],
      ['ai/outline.json', enc.encode('[]')],
      ['integrity/hashes.json', enc.encode('{"algorithm":"sha256","files":{}}')],
      ['data/spesa-2025.json', datasetBytes()],
    ]);
    return { manifest, files };
  }

  it('passes a coherent package', () => {
    expect(validateDatasets(packageWith(coherentTable, [declared]))).toEqual([]);
  });

  it('rejects a bound table whose dataset is not declared (§6.5.1)', () => {
    const violations = validateDatasets(packageWith(coherentTable, []));
    expect(violations.some((v) => v.spec === '§6.5.1' && v.path.includes('tbl-spesa'))).toBe(true);
  });

  it('reports dataset file violations through the package check', () => {
    const pkg = packageWith(coherentTable, [declared]);
    (pkg.files as Map<string, Uint8Array>).set(
      'data/spesa-2025.json',
      datasetBytes({ rows: [['x', 1.5, 1, true, null]] }),
    );
    const violations = validateDatasets(pkg);
    expect(violations.some((v) => v.spec === '§5.1.4')).toBe(true);
  });
});
