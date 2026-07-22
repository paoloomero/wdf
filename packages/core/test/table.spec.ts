import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { extract } from '../src/extract.js';
import { computeTableGrid, parseSpan, type SpanCell } from '../src/table.js';

// T11.2 (plan §10.16): the canonical table grid of spec §6.2.8 and the GFM
// expansion of merged cells (§7.5.9).

const cell = (colspan = 1, rowspan = 1): SpanCell => ({ colspan, rowspan });

describe('parseSpan', () => {
  it('defaults to 1 and caps at 1000', () => {
    expect(parseSpan(undefined)).toBe(1);
    expect(parseSpan('x')).toBe(1);
    expect(parseSpan('0')).toBe(1);
    expect(parseSpan('3')).toBe(3);
    expect(parseSpan('4000')).toBe(1000);
  });
});

describe('computeTableGrid (§6.2.8)', () => {
  it('lays out a plain full grid', () => {
    const grid = computeTableGrid([[[cell(), cell()]], [[cell(), cell()]]]);
    expect(grid.columns).toBe(2);
    expect(grid.problems).toEqual([]);
    expect(grid.rows).toEqual([
      [{ cell: 0 }, { cell: 1 }],
      [{ cell: 0 }, { cell: 1 }],
    ]);
  });

  it('covers slots below a rowspan and right of a colspan', () => {
    const grid = computeTableGrid([
      [[cell(), cell(2), cell()]],
      [
        [cell(1, 2), cell(), cell(), cell()],
        [cell(), cell(), cell()],
        [cell(3), cell()],
      ],
    ]);
    expect(grid.columns).toBe(4);
    expect(grid.problems).toEqual([]);
    expect(grid.rows).toEqual([
      [{ cell: 0 }, { cell: 1 }, null, { cell: 2 }],
      [{ cell: 0 }, { cell: 1 }, { cell: 2 }, { cell: 3 }],
      [null, { cell: 0 }, { cell: 1 }, { cell: 2 }],
      [{ cell: 0 }, null, null, { cell: 1 }],
    ]);
  });

  it('rejects a row that overflows the column count', () => {
    const extraCell = computeTableGrid([[[cell(), cell()]], [[cell(2), cell()]]]);
    expect(extraCell.problems.some((p) => p.includes('does not fit'))).toBe(true);
    const wideSpan = computeTableGrid([[[cell(), cell()]], [[cell(), cell(2)]]]);
    expect(wideSpan.problems.some((p) => p.includes('spans past column'))).toBe(true);
  });

  it('rejects holes', () => {
    const grid = computeTableGrid([[[cell(), cell()]], [[cell()]]]);
    expect(grid.problems.some((p) => p.includes('covers 1 of 2'))).toBe(true);
  });

  it('rejects a rowspan crossing its row group', () => {
    const grid = computeTableGrid([[[cell(1, 2), cell()]], [[cell(), cell()]]]);
    expect(grid.problems.some((p) => p.includes('extends past its row group'))).toBe(true);
  });
});

describe('extraction of an image in a cell (§6.2.9, §7.4.2)', () => {
  it('serializes the inline image inside the GFM cell', () => {
    const html = readFileSync(
      join(
        resolve(import.meta.dirname, '../../../fixtures/profile/valid'),
        'valid-07-img-in-cell.html',
      ),
      'utf8',
    );
    const { markdown } = extract(html);
    expect(markdown).toContain('| Done | ![done](<content/assets/done.svg>) |');
  });
});

describe('extraction of merged cells (§7.5.9)', () => {
  it('expands spans to empty slots in the canonical GFM grid', () => {
    const html = readFileSync(
      join(
        resolve(import.meta.dirname, '../../../fixtures/profile/valid'),
        'valid-06-merged-cells.html',
      ),
      'utf8',
    );
    const { markdown } = extract(html);
    expect(markdown).toContain(
      [
        '| Area | Semester |  | Total |',
        '| --- | --- | --- | --- |',
        '| North | 10 | 20 | 30 |',
        '|  | 5 | 15 | 20 |',
        '| All areas |  |  | 50 |',
      ].join('\n'),
    );
  });
});
