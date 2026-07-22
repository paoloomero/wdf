import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { readPackage } from '@wdf/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { cmdExtract, cmdImport, cmdValidate, type Ctx } from '../src/commands.js';

// T11.3 acceptance (plan §10.16): imported tables keep colspan/rowspan when
// the grid is rectangular; irreconcilable grids fall back to the padded
// full grid, reported honestly.

const fixturesDir = resolve(import.meta.dirname, '../../../fixtures/import');

interface Capture extends Ctx {
  logs: string[];
  stdout: string[];
}
function capture(): Capture {
  const c: Capture = {
    logs: [],
    stdout: [],
    log: (s) => c.logs.push(s),
    err: (s) => c.logs.push(s),
    out: (s) => c.stdout.push(s),
  };
  return c;
}

let run: Capture;
let indexHtml: string;
let md: string;

beforeAll(async () => {
  const work = mkdtempSync(join(tmpdir(), 'wdf-merged-'));
  const wdf = join(work, 'merged.wdf');
  run = capture();
  const code = await cmdImport(
    join(fixturesDir, 'gdocs-merged-table-en.html'),
    { output: wdf, date: '2026-07-22T12:00:00Z' },
    run,
  );
  expect(code, run.logs.join('\n')).toBe(0);
  expect(await cmdValidate(wdf, {}, capture())).toBe(0);
  indexHtml = new TextDecoder().decode(
    readPackage(readFileSync(wdf)).files.get('content/index.html'),
  );
  const extraction = capture();
  cmdExtract(wdf, {}, extraction);
  md = extraction.stdout.join('');
});

describe('merged-cell import (T11.3)', () => {
  it('keeps colspan/rowspan when the grid is rectangular', () => {
    expect(indexHtml).toMatch(/<th[^>]*colspan="2"[^>]*><span[^>]*>Semester<\/span><\/th>/);
    expect(indexHtml).toMatch(/<td[^>]*rowspan="2"[^>]*><span[^>]*>North<\/span><\/td>/);
    expect(run.logs.some((l) => l.includes('kept merged cells'))).toBe(true);
  });

  it('strips spans from an irreconcilable grid and pads instead', () => {
    expect(run.logs.some((l) => l.includes('table grid could not be reconciled'))).toBe(true);
    // The second table survives as a padded full grid without span
    // attributes: the only spans left in the document are the first table's.
    expect(indexHtml).toMatch(/<td[^>]*><span[^>]*>wide<\/span><\/td>/);
    expect(indexHtml.match(/colspan/g)).toHaveLength(1);
    expect(indexHtml.match(/rowspan/g)).toHaveLength(1);
  });

  it('extracts the canonical expanded grid (§7.5.9)', () => {
    expect(md).toContain(['| North | 10 | 20 |', '|  | 5 | 15 |'].join('\n'));
  });
});
