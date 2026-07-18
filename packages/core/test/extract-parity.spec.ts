import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { extract, serializeOutline } from '../src/extract.js';
import { parseHtmlDom } from '../src/html/domparser.js';
import { parseHtml } from '../src/html/parse.js';

// Node/browser parity: technical risk #1 of the project (plan §8.1). The two
// parser adapters must yield byte-identical extraction output (spec §7.1.3).
// jsdom stands in for the browser here; the viewer adds real-browser checks.

const goldenDir = resolve(import.meta.dirname, '../../../fixtures/golden');
const profileValidDir = resolve(import.meta.dirname, '../../../fixtures/profile/valid');

const inputs: [string, string][] = [
  ...readdirSync(goldenDir)
    .sort()
    .map((name): [string, string] => [
      `golden/${name}`,
      readFileSync(join(goldenDir, name, 'input.html'), 'utf8'),
    ]),
  ...readdirSync(profileValidDir)
    .sort()
    .map((name): [string, string] => [
      `profile/${name}`,
      readFileSync(join(profileValidDir, name), 'utf8'),
    ]),
];

const globals = globalThis as { DOMParser?: unknown };
let saved: unknown;

beforeAll(() => {
  saved = globals.DOMParser;
  globals.DOMParser = new JSDOM('').window.DOMParser;
});

afterAll(() => {
  globals.DOMParser = saved;
});

describe('parse5 / DOMParser extraction parity', () => {
  it.each(inputs.map(([name]) => name))('%s', (name) => {
    const html = inputs.find(([n]) => n === name)?.[1] ?? '';
    const fromParse5 = extract(parseHtml(html));
    const fromDom = extract(parseHtmlDom(html));
    expect(fromDom.markdown).toBe(fromParse5.markdown);
    expect(serializeOutline(fromDom.outline)).toBe(serializeOutline(fromParse5.outline));
  });
});
