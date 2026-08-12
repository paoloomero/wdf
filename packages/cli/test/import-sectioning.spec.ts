import { describe, expect, it } from 'vitest';

import { importHtml } from '@wdf-dev/import';

// Robustness-matrix finding (plan §10.22): real-world pages nest sectioning
// inside transparent containers (Wikipedia: nav in header; MDN: nav in
// nav), which §6.2.2 forbids — the importer unwraps them to their blocks.

describe('sectioning inside transparent containers', () => {
  it('unwraps nav nested in header and nav in nav', async () => {
    const html =
      '<html><body>' +
      '<header><nav><p>menu</p></nav></header>' +
      '<nav><nav><p>breadcrumbs</p></nav></nav>' +
      '<section><header><p>kept</p></header><p>body</p></section>' +
      '</body></html>';
    const { blocks, report } = await importHtml(html);
    const tags = blocks.map((b) => b.tag);
    expect(tags).toEqual(['header', 'nav', 'section']);
    // The transparent containers now hold blocks only.
    expect(blocks[0]?.children.every((c) => typeof c === 'string' || c.tag === 'p')).toBe(true);
    expect(blocks[1]?.children.every((c) => typeof c === 'string' || c.tag === 'p')).toBe(true);
    // section may keep its header (§6.2.1).
    expect(blocks[2]?.children.some((c) => typeof c !== 'string' && c.tag === 'header')).toBe(true);
    expect(report.filter((l) => l.includes('unwrapped <nav>'))).toHaveLength(2);
  });
});
