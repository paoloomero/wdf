import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { extract, serializeOutline } from '../src/extract.js';
import { getSchemaValidators } from '../src/schemas.js';

const goldenDir = resolve(import.meta.dirname, '../../../fixtures/golden');
const goldenCases = readdirSync(goldenDir)
  .filter((name) => !name.startsWith('.'))
  .sort();

// The most important tests in the repo: golden files are contracts (CLAUDE.md).
// If a change alters them, regenerate explicitly with `pnpm golden:update`
// and justify the diff.
describe('canonical extraction — golden files (T2.3 acceptance)', () => {
  it.each(goldenCases)('%s: content.md is byte-identical', (name) => {
    const html = readFileSync(join(goldenDir, name, 'input.html'), 'utf8');
    const expected = readFileSync(join(goldenDir, name, 'content.md'), 'utf8');
    expect(extract(html).markdown).toBe(expected);
  });

  it.each(goldenCases)('%s: outline.json is byte-identical', (name) => {
    const html = readFileSync(join(goldenDir, name, 'input.html'), 'utf8');
    const expected = readFileSync(join(goldenDir, name, 'outline.json'), 'utf8');
    expect(serializeOutline(extract(html).outline)).toBe(expected);
  });

  it.each(goldenCases)('%s: outline validates against the outline schema', (name) => {
    const html = readFileSync(join(goldenDir, name, 'input.html'), 'utf8');
    const validate = getSchemaValidators().outline;
    const outline = extract(html).outline;
    expect(validate(outline), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it('appendix-a reproduces the worked example of spec Appendix A', () => {
    const md = readFileSync(join(goldenDir, 'appendix-a', 'content.md'), 'utf8');
    expect(md).toBe(
      '# Hello, WDF {#h-hello} {#sec-hello}\n' +
        '\n' +
        'A document whose *human* and *agent* views are the same thing. {#p-0001}\n',
    );
  });
});

describe('canonical extraction — determinism properties', () => {
  it.each(goldenCases)('%s: extraction is idempotent across runs', (name) => {
    const html = readFileSync(join(goldenDir, name, 'input.html'), 'utf8');
    const a = extract(html);
    const b = extract(html);
    expect(b.markdown).toBe(a.markdown);
    expect(serializeOutline(b.outline)).toBe(serializeOutline(a.outline));
  });

  it('output ends with exactly one LF and has no trailing whitespace', () => {
    for (const name of goldenCases) {
      const html = readFileSync(join(goldenDir, name, 'input.html'), 'utf8');
      const { markdown } = extract(html);
      expect(markdown.endsWith('\n')).toBe(true);
      expect(markdown.endsWith('\n\n')).toBe(false);
      for (const line of markdown.split('\n')) {
        expect(line).not.toMatch(/[ \t]$/);
      }
    }
  });
});
