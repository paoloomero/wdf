import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { readPackage } from '@wdf-dev/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { cmdImport, cmdValidate, type Ctx } from '../src/commands.js';
import { el, promoteHeadings, importHtml, STYLE_TMP_ATTR } from '@wdf-dev/import';

// T7.7 acceptance (plan §10.15): styled title paragraphs from Word-like and
// Google-Docs-like exports are promoted to h1..h6, fixing the flat outline;
// deterministic, reported, and inert on documents that already have headings.

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

interface Imported {
  run: Capture;
  bytes: Buffer;
  indexHtml: string;
  outline: { type: string; title?: string; level?: number }[];
}

async function importFixture(name: string, dir: string): Promise<Imported> {
  const wdf = join(dir, `${name}.wdf`);
  const run = capture();
  const code = await cmdImport(
    join(fixturesDir, `${name}.html`),
    { output: wdf, date: '2026-07-22T12:00:00Z' },
    run,
  );
  expect(code, run.logs.join('\n')).toBe(0);
  expect(await cmdValidate(wdf, {}, capture())).toBe(0);
  const bytes = readFileSync(wdf);
  const pkg = readPackage(bytes);
  const indexHtml = new TextDecoder().decode(pkg.files.get('content/index.html'));
  const outline = JSON.parse(new TextDecoder().decode(pkg.files.get('ai/outline.json'))) as {
    type: string;
    title?: string;
    level?: number;
  }[];
  return { run, bytes, indexHtml, outline };
}

let work: string;
let word: Imported;
let gdocs: Imported;

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'wdf-headings-'));
  word = await importFixture('word-headings-it', work);
  gdocs = await importFixture('gdocs-headings-en', work);
});

describe('heading promotion on a Word-like export (T7.7)', () => {
  it('promotes the title paragraph to the single h1', () => {
    expect(word.indexHtml).toMatch(/<h1 [^>]*>Relazione attività 2026<\/h1>/);
    expect(word.indexHtml.match(/<h1 /g)).toHaveLength(1);
  });

  it('promotes section titles (14pt vs 12pt body) to h2', () => {
    expect(word.indexHtml).toMatch(/<h2 [^>]*>Premessa<\/h2>/);
    expect(word.indexHtml).toMatch(/<h2 [^>]*>Risultati<\/h2>/);
  });

  it('does not promote a large span inside a body paragraph', () => {
    expect(word.indexHtml).toMatch(/<p [^>]*>Un inciso con /);
  });

  it('produces a non-flat outline with heading slug ids', () => {
    const headings = word.outline.filter((n) => n.type === 'heading');
    expect(headings.map((n) => n.title)).toEqual([
      'Relazione attività 2026',
      'Premessa',
      'Risultati',
    ]);
    expect(word.indexHtml).toContain('id="h-premessa"');
  });

  it('reports every promotion', () => {
    const promoted = word.run.logs.filter((l) => l.includes('promoted styled paragraph'));
    expect(promoted).toHaveLength(3);
    expect(promoted[0]).toContain('(26pt) to <h1>: "Relazione attività 2026"');
  });
});

describe('heading promotion on a Google-Docs-like export (T7.7)', () => {
  it('maps the size ladder to descending heading levels', () => {
    // Google Docs wraps text in styled spans; match through them.
    expect(gdocs.indexHtml).toMatch(/<h1 [^>]*><span[^>]*>Annual report 2026<\/span><\/h1>/);
    expect(gdocs.indexHtml).toMatch(/<h2 [^>]*><span[^>]*>Overview<\/span><\/h2>/);
    expect(gdocs.indexHtml).toMatch(/<h3 [^>]*><span[^>]*>Budget<\/span><\/h3>/);
    // The 15pt subtitle lands between body and headings: best-effort h4.
    expect(gdocs.indexHtml).toMatch(/<h4 [^>]*><span[^>]*>A subtitle in italic gray<\/span><\/h4>/);
  });

  it('keeps body paragraphs (11pt) untouched', () => {
    expect(gdocs.indexHtml).toMatch(/<p [^>]*><span[^>]*>This document summarizes/);
  });

  it('is byte-deterministic: same fixture → identical package', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wdf-headings-again-'));
    const again = await importFixture('gdocs-headings-en', dir);
    expect(again.bytes.equals(gdocs.bytes)).toBe(true);
  });
});

describe('promoteHeadings guardrails', () => {
  const styled = (text: string, size: string): ReturnType<typeof el> =>
    el('p', { [STYLE_TMP_ATTR]: `font-size:${size}` }, [text]);

  it('does nothing when the document already has a heading', () => {
    const report: string[] = [];
    const blocks = [el('h1', {}, ['Real title']), styled('Big styled paragraph', '24.0pt')];
    promoteHeadings(blocks, report);
    expect(blocks[1]?.tag).toBe('p');
    expect(report).toHaveLength(0);
  });

  it('normalizes px sizes to pt (16px body, 32px title)', () => {
    const report: string[] = [];
    const blocks = [
      styled('Title', '32px'),
      styled('Body text long enough to dominate the statistics.', '16px'),
    ];
    promoteHeadings(blocks, report);
    expect(blocks[0]?.tag).toBe('h1');
    expect(report[0]).toContain('(24pt) to <h1>');
  });

  it('ignores sizes below the 1.15× threshold', () => {
    const report: string[] = [];
    const blocks = [
      styled('Almost a title', '12.5pt'),
      styled('Body text long enough to dominate the statistics.', '12.0pt'),
    ];
    promoteHeadings(blocks, report);
    expect(blocks[0]?.tag).toBe('p');
    expect(report).toHaveLength(0);
  });

  it('never promotes inside a blockquote', () => {
    const report: string[] = [];
    const blocks = [
      el('blockquote', {}, [styled('Quoted big text', '24.0pt')]),
      styled('Body text long enough to dominate the statistics.', '12.0pt'),
    ];
    promoteHeadings(blocks, report);
    const quoted = blocks[0]?.children[0];
    expect(typeof quoted !== 'string' && quoted?.tag).toBe('p');
  });

  it('promotes one title to h1 when headings exist but no h1 (T7.8)', async () => {
    const html = `<html><body>
      <p style="font-size:20.0pt">Small caps kicker</p>
      <p style="font-size:26.0pt">The Actual Title</p>
      <h2>First section</h2>
      <p style="font-size:12.0pt">Body text long enough to dominate the statistics of the document.</p>
      <p style="font-size:26.0pt">Large paragraph after a heading</p>
    </body></html>`;
    const { blocks, report } = await importHtml(html);
    expect(blocks.map((b) => b.tag)).toEqual(['p', 'h1', 'h2', 'p', 'p']);
    expect(report.filter((l) => l.includes('promoted styled paragraph'))).toHaveLength(1);
  });

  it('T7.8 requires the title to outrank existing measurable headings', async () => {
    const html = `<html><head><style>h2 { font-size: 16.0pt }</style></head><body>
      <p style="font-size:14.0pt">Not big enough to be the title</p>
      <h2>First section</h2>
      <p style="font-size:12.0pt">Body text long enough to dominate the statistics of the document.</p>
    </body></html>`;
    const { blocks } = await importHtml(html);
    expect(blocks.map((b) => b.tag)).toEqual(['p', 'h2', 'p']);
  });

  it('never touches a document that already has an h1', async () => {
    const html = `<html><body>
      <h1>Real title</h1>
      <p style="font-size:26.0pt">Big styled paragraph</p>
      <p style="font-size:12.0pt">Body text long enough to dominate the statistics of the document.</p>
    </body></html>`;
    const { blocks } = await importHtml(html);
    expect(blocks.map((b) => b.tag)).toEqual(['h1', 'p', 'p']);
  });

  it('keeps paragraphs beyond six distinct heading sizes', async () => {
    const sizes = ['40', '36', '32', '28', '24', '20', '16'];
    const html = `<html><body>${sizes
      .map((s, i) => `<p style="font-size:${s}.0pt">Title ${String(i)}</p>`)
      .join(
        '',
      )}<p style="font-size:12.0pt">Body text long enough to dominate the statistics of the document body.</p></body></html>`;
    const { blocks, report } = await importHtml(html);
    expect(blocks.map((b) => b.tag)).toEqual(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'p']);
    expect(report.some((l) => l.includes('more than 6 heading sizes'))).toBe(true);
  });
});
