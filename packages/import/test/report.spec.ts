import { describe, expect, it } from 'vitest';

import { aggregateReport } from '../src/report.js';

// T15.2 (plan §10.28): identical notes aggregate at display time only,
// preserving first-occurrence order.

describe('aggregateReport', () => {
  it('collapses exact duplicates with a count, keeping order', () => {
    expect(
      aggregateReport([
        'dropped <button> (not representable in WDF-HTML)',
        'imported image "a.png" → content/assets/x.png',
        'dropped <button> (not representable in WDF-HTML)',
        'dropped <button> (not representable in WDF-HTML)',
      ]),
    ).toEqual([
      'dropped <button> (not representable in WDF-HTML) (×3)',
      'imported image "a.png" → content/assets/x.png',
    ]);
  });

  it('leaves unique lines untouched', () => {
    const lines = ['one', 'two', 'three'];
    expect(aggregateReport(lines)).toEqual(lines);
  });

  it('handles the empty report', () => {
    expect(aggregateReport([])).toEqual([]);
  });
});
