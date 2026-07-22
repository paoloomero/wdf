/**
 * Canonical table grid (spec §6.2.8): the single layout implementation
 * shared by the profile validator and the extractor, so that "is this grid
 * rectangular?" and "which slot does this cell occupy?" can never diverge.
 */

/** A cell's declared spans (default 1 when the attribute is absent). */
export interface SpanCell {
  colspan: number;
  rowspan: number;
}

/** Origin slot of the i-th cell of the row, or null (covered slot / hole). */
export type GridSlot = { cell: number } | null;

export interface TableGrid {
  /** Sum of the header row's colspans (§6.2.8). */
  columns: number;
  /** One entry per input row (groups flattened), each `columns` slots long. */
  rows: GridSlot[][];
  /** Empty when the grid is exactly rectangular. */
  problems: string[];
}

/** Parses a colspan/rowspan attribute for layout: default 1, capped at 1000. */
export function parseSpan(value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value)) return 1;
  const n = Number(value);
  return n < 1 ? 1 : n > 1000 ? 1000 : n;
}

/**
 * Lays out the rows of the given row groups (`thead`, `tbody`, `tfoot`)
 * with the algorithm of §6.2.8: each cell takes the leftmost free slot of
 * its row and covers `colspan` × `rowspan` slots. Total and deterministic
 * on any input; violations of the rectangularity rule are collected in
 * `problems` (overlapping spans are clipped, oversized cells truncated,
 * rowspans never cross their row group).
 */
export function computeTableGrid(rowGroups: readonly (readonly SpanCell[][])[]): TableGrid {
  const headerRow = rowGroups.find((g) => g.length > 0)?.[0] ?? [];
  const columns = headerRow.reduce((sum, cell) => sum + cell.colspan, 0);
  const rows: GridSlot[][] = [];
  const problems: string[] = [];

  // pending[c] = how many upcoming rows are still covered by a rowspan.
  const pending: number[] = Array.from({ length: columns }, () => 0);
  let rowIndex = 0;

  for (const group of rowGroups) {
    for (const [rowInGroup, cells] of group.entries()) {
      rowIndex += 1;
      const occupied = pending.map((n) => n > 0);
      for (let c = 0; c < columns; c += 1) {
        const covered = pending[c];
        if (covered !== undefined && covered > 0) pending[c] = covered - 1;
      }
      const slots: GridSlot[] = Array.from({ length: columns }, () => null);

      let col = 0;
      for (const [i, cell] of cells.entries()) {
        while (col < columns && occupied[col] === true) col += 1;
        if (col >= columns) {
          problems.push(
            `row ${String(rowIndex)}: cell ${String(i + 1)} does not fit (the header defines ${String(columns)} column(s))`,
          );
          break;
        }
        slots[col] = { cell: i };

        const rowsLeftInGroup = group.length - rowInGroup;
        if (cell.rowspan > rowsLeftInGroup) {
          problems.push(
            `row ${String(rowIndex)}: rowspan ${String(cell.rowspan)} extends past its row group`,
          );
        }
        const rowspan = Math.min(cell.rowspan, rowsLeftInGroup);

        const end = col + cell.colspan;
        if (end > columns) {
          problems.push(
            `row ${String(rowIndex)}: cell ${String(i + 1)} spans past column ${String(columns)}`,
          );
        }
        for (; col < Math.min(end, columns); col += 1) {
          if (occupied[col] === true) {
            problems.push(`row ${String(rowIndex)}: cells overlap at column ${String(col + 1)}`);
            continue;
          }
          occupied[col] = true;
          if (rowspan > 1) pending[col] = rowspan - 1;
        }
      }

      const holes = occupied.filter((c) => !c).length;
      if (holes > 0) {
        problems.push(
          `row ${String(rowIndex)} covers ${String(columns - holes)} of ${String(columns)} column(s)`,
        );
      }
      rows.push(slots);
    }
  }
  return { columns, rows, problems };
}
