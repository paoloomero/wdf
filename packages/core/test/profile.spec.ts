import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateProfile, validateStylesheet } from '../src/profile.js';

const fixturesDir = resolve(import.meta.dirname, '../../../fixtures/profile');

function fixtures(kind: 'valid' | 'invalid'): string[] {
  return readdirSync(join(fixturesDir, kind))
    .filter((f) => f.endsWith('.html'))
    .sort();
}

describe('validateProfile — valid fixtures produce no errors', () => {
  it.each(fixtures('valid'))('%s', (file) => {
    const html = readFileSync(join(fixturesDir, 'valid', file), 'utf8');
    const errors = validateProfile(html).filter((v) => v.severity === 'error');
    expect(errors, JSON.stringify(errors, null, 2)).toEqual([]);
  });
});

describe('validateProfile — invalid fixtures are rejected with the expected section', () => {
  it('has enough cases (≥ 25 overall)', () => {
    expect(fixtures('valid').length + fixtures('invalid').length).toBeGreaterThanOrEqual(25);
  });

  it.each(fixtures('invalid'))('%s', (file) => {
    const html = readFileSync(join(fixturesDir, 'invalid', file), 'utf8');
    const match = /<!-- expect:([^>]*)-->/.exec(html);
    expect(match, 'invalid fixture must declare <!-- expect: §… -->').not.toBeNull();
    const expected = (match?.[1] ?? '').trim().split(/\s+/);

    const violations = validateProfile(html);
    const errors = violations.filter((v) => v.severity === 'error');
    expect(errors.length, 'expected at least one error').toBeGreaterThan(0);
    const sections = new Set(violations.map((v) => v.spec));
    for (const section of expected) {
      expect(
        sections,
        `expected a violation citing ${section}; got ${JSON.stringify(violations, null, 2)}`,
      ).toContain(section);
    }
  });

  it('violations carry a precise element path', () => {
    const html = readFileSync(join(fixturesDir, 'invalid', 'invalid-23-duplicate-id.html'), 'utf8');
    const [violation] = validateProfile(html);
    expect(violation?.path).toBe('html/body/article[1]/p#p-0001');
    expect(violation?.message).toContain('duplicate id');
  });
});

describe('validateStylesheet (§6.7.2)', () => {
  it('accepts ordinary responsive CSS', () => {
    const css = `
      article { max-width: 42rem; margin: 0 auto; font: 1rem/1.6 system-ui; }
      @media (max-width: 40rem) { article { padding: 0 1rem; } }
      table { border-collapse: collapse; position: relative; }
    `;
    expect(validateStylesheet(css)).toEqual([]);
  });

  it.each([
    ['@import "other.css";', '@import'],
    ['@font-face { font-family: X; }', '@font-face'],
    ['h1 { background: url(https://example.org/x.png); }', 'url('],
    ['nav { position: fixed; }', 'position: fixed'],
    ['th { position: sticky; }', 'position: sticky'],
  ])('rejects %s', (css, needle) => {
    const violations = validateStylesheet(css);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.spec).toBe('§6.7.2');
    expect(violations[0]?.message).toContain(needle);
  });

  it('ignores forbidden constructs inside comments', () => {
    expect(validateStylesheet('/* url(x) @import position: fixed */ p { color: red }')).toEqual([]);
  });
});

describe('validateStylesheet — errata 2026-09-15 (§6.7.2, review F01, plan §10.70)', () => {
  const forbidden: [string, string][] = [
    ['#p-hidden { display: none; }', 'display: none'],
    ['.x{display:none}', 'display: none'],
    ['p { visibility: hidden }', 'visibility'],
    ['p { visibility: collapse; }', 'visibility'],
    ['p { opacity: 0; }', 'opacity: 0'],
    ['p { opacity: 0.0 !important; }', 'opacity: 0'],
    ['p{opacity:0}', 'opacity: 0'],
    ['p { font-size: 0; }', 'font-size: 0'],
    ['p { font-size: 0px }', 'font-size: 0'],
    ['p { clip: rect(0 0 0 0); }', 'clip is not permitted'],
    ['p { clip-path: inset(50%); }', 'clip-path'],
    ['p::before { content: "Hidden: 999"; }', 'content:'],
    ["p::after { content: 'x' }", 'content:'],
    ['p::after { content: counter(n); }', 'content:'],
    ['p::after { content: attr(title); }', 'content:'],
  ];
  it.each(forbidden)('rejects %s', (css, expected) => {
    const violations = validateStylesheet(css);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.every((v) => v.spec === '§6.7.2')).toBe(true);
    expect(violations.some((v) => v.message.includes(expected))).toBe(true);
  });

  const allowed = [
    'p { opacity: 0.5; }',
    'p { opacity: 1 }',
    'p { font-size: 0.9em; }',
    'p { font-size: 10px }',
    'p { text-indent: 2em; }',
    'p { margin-left: 24pt; text-indent: -17pt; }', // a Word hanging indent, not a hiding trick
    'p { clip: auto; }',
    'p { clip-path: none; }',
    '.clearfix::after { content: ""; display: table; }',
    "q::before { content: '' }",
    'p::before { content: none; }',
    'p::before { content: normal !important; }',
    '.content:hover { color: red; }',
    '.display:hover { color: red; }',
    'p { display: block; visibility: visible; }',
    '/* display: none; content: "x" */ p { color: red }',
    '@media (max-width: 40em) { table { display: block; overflow-x: auto; } }',
  ];
  it.each(allowed)('accepts %s', (css) => {
    expect(validateStylesheet(css)).toEqual([]);
  });
});
