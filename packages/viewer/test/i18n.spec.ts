import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getAttr, isElement, parseHtml, type WdfElement } from '@wdf-dev/core';
import { describe, expect, it } from 'vitest';

import { initialLang, MESSAGES, SHELL_IT } from '../src/i18n.js';

// Plan §10.81: the Reader interface in English and Italian.

const shell = readFileSync(join(import.meta.dirname, '../src/shell.html'), 'utf8');
const html = parseHtml(shell).html;
if (html === null) throw new Error('shell.html did not parse');

const ATTRS = ['title', 'aria-label', 'placeholder'];

function elements(root: WdfElement): WdfElement[] {
  const out = [root];
  for (const child of root.children) if (isElement(child)) out.push(...elements(child));
  return out;
}

const all = elements(html);
const usedKeys = new Set(
  all.flatMap((el) =>
    ['data-i18n', ...ATTRS.map((a) => `data-i18n-${a}`)]
      .map((name) => getAttr(el, name))
      .filter((k): k is string => k !== undefined),
  ),
);

// Texts that read the same in both languages, or that the code overwrites
// on every render (badge label, verification heading).
const SAME_IN_BOTH = new Set([
  'WDF Reader & Converter',
  'Chrome',
  'Firefox',
  'EN',
  'IT',
  'PDF',
  '.wdf',
  '.wdf.html',
  '→',
  '+',
  '1',
  '2',
  '3',
  '4',
  '…',
  '✓',
  'Verification',
  'checking…',
]);

describe('Reader interface in two languages (plan §10.81)', () => {
  it('has an Italian text for every key in the shell, and no unused one', () => {
    const missing = [...usedKeys].filter((k) => SHELL_IT[k] === undefined);
    const unused = Object.keys(SHELL_IT).filter((k) => !usedKeys.has(k));
    expect(missing).toEqual([]);
    expect(unused).toEqual([]);
  });

  it('leaves no visible shell text without a key', () => {
    const untranslated: string[] = [];
    const walk = (el: WdfElement, keyed: boolean): void => {
      if (['script', 'style', 'svg', 'code', 'title'].includes(el.tag)) return;
      const here = keyed || getAttr(el, 'data-i18n') !== undefined;
      for (const child of el.children) {
        if (isElement(child)) walk(child, here);
        else {
          const text = child.text.replace(/\s+/g, ' ').trim();
          if (!here && /\p{L}/u.test(text) && !SAME_IN_BOTH.has(text)) untranslated.push(text);
        }
      }
    };
    walk(html, false);
    expect(untranslated).toEqual([]);
  });

  it('gives every translatable attribute a key', () => {
    const bare = all.flatMap((el) =>
      ATTRS.filter((a) => {
        const value = getAttr(el, a);
        return (
          value !== undefined &&
          /\p{L}/u.test(value) &&
          getAttr(el, `data-i18n-${a}`) === undefined &&
          // Overwritten by the code in the current language (main.ts).
          getAttr(el, 'id') !== 'pdf-export'
        );
      }).map((a) => `${getAttr(el, 'id') ?? el.tag}[${a}]`),
    );
    expect(bare).toEqual([]);
  });

  it('puts only inline formatting in the Italian HTML', () => {
    for (const [key, value] of Object.entries(SHELL_IT)) {
      const tags = [...value.matchAll(/<\/?([a-z]+)/g)].map((m) => m[1]);
      for (const tag of tags) expect(['strong', 'b', 'br', 'code', 'span'], key).toContain(tag);
    }
  });

  it('has the same message keys in both languages', () => {
    const shape = (o: object): string[] =>
      Object.entries(o)
        .flatMap(([k, v]) =>
          typeof v === 'object' && v !== null ? shape(v as object).map((s) => `${k}.${s}`) : [k],
        )
        .sort();
    expect(shape(MESSAGES.it)).toEqual(shape(MESSAGES.en));
  });

  it('starts from the saved choice, else the browser language, else English', () => {
    expect(initialLang('it', ['en-US'])).toBe('it');
    expect(initialLang('en', ['it-IT'])).toBe('en');
    expect(initialLang(null, ['it-IT', 'en'])).toBe('it');
    expect(initialLang(null, ['IT'])).toBe('it');
    expect(initialLang(null, ['en-GB', 'it'])).toBe('en');
    expect(initialLang('fr', [])).toBe('en');
  });

  it('pluralises counts in Italian', () => {
    expect(MESSAGES.it.anchors(1)).toBe('1 ancora');
    expect(MESSAGES.it.anchors(12)).toBe('12 ancore');
    expect(MESSAGES.it.pages(1)).toBe('1 pagina');
    expect(MESSAGES.it.nNotes(3)).toBe('3 note');
  });
});
