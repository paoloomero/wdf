import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { readPackage } from '@wdf/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { cmdImport, cmdValidate, type Ctx } from '../src/commands.js';
import { DEFAULT_CAPS, importHtml, collectSourceStylesheets } from '@wdf/import';

// WP15 + WP16 acceptance (plan §10.23): a browser-saved page imports with
// its main content extracted (site chrome dropped, reported) and its
// stylesheets embedded in the source extension for the Original view.

const fixturesDir = resolve(import.meta.dirname, '../../../fixtures/import');

interface Capture extends Ctx {
  logs: string[];
}
function capture(): Capture {
  const c: Capture = {
    logs: [],
    log: (s) => c.logs.push(s),
    err: (s) => c.logs.push(s),
    out: () => undefined,
  };
  return c;
}

interface SourceJson {
  source: string;
  stylesheets?: Record<string, string>;
}

let run: Capture;
let pkg: ReturnType<typeof readPackage>;
let indexHtml: string;
let sourceJson: SourceJson;

beforeAll(async () => {
  const work = mkdtempSync(join(tmpdir(), 'wdf-webpage-'));
  const wdf = join(work, 'saved-page-css.wdf');
  run = capture();
  const code = await cmdImport(
    join(fixturesDir, 'saved-page-css.html'),
    { output: wdf, date: '2026-07-24T12:00:00Z', withSource: true },
    run,
  );
  expect(code, run.logs.join('\n')).toBe(0);
  expect(await cmdValidate(wdf, {}, capture())).toBe(0);
  pkg = readPackage(readFileSync(wdf));
  indexHtml = new TextDecoder().decode(pkg.files.get('content/index.html'));
  sourceJson = JSON.parse(
    new TextDecoder().decode(pkg.files.get('ext/source/source.json')),
  ) as SourceJson;
});

describe('main-content extraction (WP16)', () => {
  it('imports only the <main> content and drops the site chrome', () => {
    expect(indexHtml).toContain('Articolo di prova');
    expect(indexHtml).not.toContain('menu del sito');
    expect(indexHtml).not.toContain('footer del sito');
    expect(run.logs.some((l) => l.includes('extracted the main content from <main>'))).toBe(true);
  });

  it('keeps the whole body with fullPage', async () => {
    const html = readFileSync(join(fixturesDir, 'saved-page-css.html'), 'utf8');
    const full = await importHtml(html, { fullPage: true });
    const text = JSON.stringify(full.blocks);
    expect(text).toContain('menu del sito');
  });

  it('supports role="main" and stays silent without landmarks', async () => {
    const roleMain = await importHtml(
      '<html><body><nav><p>chrome</p></nav><div role="main"><p>content</p></div></body></html>',
    );
    expect(JSON.stringify(roleMain.blocks)).not.toContain('chrome');
    const plain = await importHtml('<html><body><p>just a paragraph</p></body></html>');
    expect(plain.report.some((l) => l.includes('extracted the main content'))).toBe(false);
  });
});

describe('source stylesheets (WP15)', () => {
  it('embeds the local stylesheet and maps it in source.json', () => {
    expect(sourceJson.source).toBe('0.3');
    const mapped = sourceJson.stylesheets?.['saved-page-css_files/site.css'];
    expect(mapped).toMatch(/^ext\/source\/[0-9a-f]{16}\.css$/);
    const css = new TextDecoder().decode(pkg.files.get(mapped ?? ''));
    expect(css).toContain('Georgia');
    expect(run.logs.some((l) => l.includes('embedded 1 source stylesheet'))).toBe(true);
  });

  it('collectSourceStylesheets enforces caps and reports misses', async () => {
    const html =
      '<html><head>' +
      '<link rel="stylesheet" href="a.css">' +
      '<link rel="stylesheet" href="missing.css">' +
      '<link rel="stylesheet" href="big.css">' +
      '</head><body></body></html>';
    const enc = new TextEncoder();
    const report: string[] = [];
    const { files, stylesheets } = await collectSourceStylesheets(
      html,
      (href) => {
        if (href === 'a.css') return Promise.resolve(enc.encode('body{}'));
        if (href === 'big.css') return Promise.resolve(new Uint8Array(DEFAULT_CAPS.perFile + 1));
        return Promise.resolve(undefined);
      },
      DEFAULT_CAPS,
      report,
    );
    expect(Object.keys(stylesheets)).toEqual(['a.css']);
    expect(files.size).toBe(1);
    expect(report.some((l) => l.includes('not embedded'))).toBe(true);
    expect(report.some((l) => l.includes('size limit'))).toBe(true);
  });
});

describe('img dimension sanitization (§6.3.3, field test 7 Aug)', () => {
  it('drops non-integer width/height and keeps valid ones', async () => {
    const result = await importHtml(
      '<html><body><main>' +
        '<p><img src="x.png" width="auto" height="200" alt=""></p>' +
        '<p><img src="y.png" width="0" alt=""></p>' +
        '</main></body></html>',
      {
        loadAsset: () =>
          Promise.resolve({ bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) }),
      },
    );
    const html = result.blocks.map((b) => JSON.stringify(b)).join('');
    expect(html).not.toContain('"width":"auto"');
    expect(html).not.toContain('"width":"0"');
    expect(html).toContain('"height":"200"');
    expect(result.report.some((r) => r.includes('dropped img width="auto"'))).toBe(true);
    expect(result.report.some((r) => r.includes('dropped img width="0"'))).toBe(true);
  });
});

describe('import --standalone (T15.1, plan §10.28)', () => {
  it('writes the standalone HTML next to the package', async () => {
    const work = mkdtempSync(join(tmpdir(), 'wdf-standalone-'));
    const wdf = join(work, 'page.wdf');
    const run = capture();
    const code = await cmdImport(
      join(fixturesDir, 'saved-page-css.html'),
      { output: wdf, date: '2026-08-07T12:00:00Z', standalone: true },
      run,
    );
    expect(code, run.logs.join('\n')).toBe(0);
    const html = readFileSync(join(work, 'page.html'), 'utf8');
    expect(html).toContain('application/wdf+zip');
    expect(run.logs.some((l) => l.includes('standalone'))).toBe(true);
    // Without the flag, no HTML appears (unchanged behavior).
    const wdf2 = join(work, 'plain.wdf');
    await cmdImport(join(fixturesDir, 'saved-page-css.html'), { output: wdf2 }, capture());
    expect(() => readFileSync(join(work, 'plain.html'))).toThrow();
  });
});
