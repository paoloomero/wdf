import { existsSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';

import { getAttr, isElement, parseHtml, type WdfElement } from '@wdf-dev/core';
import { describe, expect, it } from 'vitest';

// Plan §10.83: wdf.dev in English and Italian, as static page pairs. The two
// versions of a page must not drift apart silently.

const siteDir = resolve(import.meta.dirname, '../../../site');
const PAIRS = ['index.html', 'manifesto.html', 'extension-privacy.html'];
// Files the demo build writes next to the static site (scripts/build-demo.mjs).
const BUILT = [
  'viewer.html',
  'plex.css',
  'spec.html',
  'mcp-demo.md',
  'llm-extraction-comparison.md',
  'examples/',
];

function elements(root: WdfElement): WdfElement[] {
  const out = [root];
  for (const child of root.children) if (isElement(child)) out.push(...elements(child));
  return out;
}

function load(path: string): WdfElement[] {
  const html = parseHtml(readFileSync(join(siteDir, path), 'utf8')).html;
  if (html === null) throw new Error(`${path} did not parse`);
  return elements(html);
}

const attrs = (els: WdfElement[], tag: string, name: string): string[] =>
  els
    .filter((el) => el.tag === tag)
    .map((el) => getAttr(el, name))
    .filter((v): v is string => v !== undefined);

const pageUrl = (page: string): string => `https://wdf.dev/${page === 'index.html' ? '' : page}`;

describe('wdf.dev in English and Italian (plan §10.83)', () => {
  for (const page of PAIRS) {
    describe(page, () => {
      const en = load(page);
      const it_ = load(`it/${page}`);

      it('declares its language and points to the other version', () => {
        expect(getAttr(en[0] as WdfElement, 'lang')).toBe('en');
        expect(getAttr(it_[0] as WdfElement, 'lang')).toBe('it');
        const alternates = (els: WdfElement[]): Record<string, string> =>
          Object.fromEntries(
            els
              .filter((el) => el.tag === 'link' && getAttr(el, 'rel') === 'alternate')
              .map((el) => [getAttr(el, 'hreflang') ?? '', getAttr(el, 'href') ?? '']),
          );
        const pair = {
          en: pageUrl(page),
          it: pageUrl(`it/${page}`).replace(/index\.html$/, ''),
          'x-default': pageUrl(page),
        };
        expect(alternates(en)).toEqual(pair);
        expect(alternates(it_)).toEqual(pair);
      });

      it('has the same sections, images and outside links', () => {
        const ids = (els: WdfElement[]): string[] =>
          els.map((el) => getAttr(el, 'id')).filter((v): v is string => v !== undefined);
        expect(ids(it_)).toEqual(ids(en));
        const images = (els: WdfElement[]): string[] =>
          attrs(els, 'img', 'src').map((src) => posix.basename(src));
        expect(images(it_)).toEqual(images(en));
        const outside = (els: WdfElement[]): string[] =>
          attrs(els, 'a', 'href')
            .filter((href) => /^https?:/.test(href))
            .sort();
        expect(outside(it_)).toEqual(outside(en));
      });

      it('resolves every relative link of the Italian page', () => {
        const refs = [
          ...attrs(it_, 'a', 'href'),
          ...attrs(it_, 'link', 'href'),
          ...attrs(it_, 'img', 'src'),
          ...attrs(it_, 'iframe', 'src'),
        ].filter((ref) => !/^(https?:|mailto:|#)/.test(ref));
        const missing = refs.filter((ref) => {
          const path = posix.normalize(posix.join('it', ref.replace(/[?#].*$/, '')));
          const file = path.endsWith('/') || path === '.' ? posix.join(path, 'index.html') : path;
          if (file.startsWith('..')) return true;
          return !existsSync(join(siteDir, file)) && !BUILT.some((b) => file.startsWith(b));
        });
        expect(missing).toEqual([]);
      });

      it('opens the Reader in Italian from the Italian page', () => {
        const reader = attrs(it_, 'a', 'href')
          .concat(attrs(it_, 'iframe', 'src'))
          .filter((href) => href.includes('viewer.html'));
        for (const href of reader) expect(href).toContain('lang=it');
      });
    });
  }
});
