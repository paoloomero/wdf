import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readPackage } from '@wdf-dev/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { cmdImport, cmdValidate, type Ctx } from '../src/commands.js';

// Review F07 (plan §10.70): `wdf import --id` and `--previous` make a
// re-import a revision of the same document (spec §4.1, §6.4.4).

interface Capture extends Ctx {
  logs: string[];
  errs: string[];
}
function capture(): Capture {
  const c: Capture = {
    logs: [],
    errs: [],
    log: (s) => c.logs.push(s),
    err: (s) => c.errs.push(s),
    out: () => undefined,
  };
  return c;
}

const page = (body: string): string =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Policy</title></head><body>${body}</body></html>`;

let work: string;
let v1Path: string;
let v1Html: string;
let v2Html: string;

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'wdf-identity-'));
  v1Html = join(work, 'v1.html');
  v2Html = join(work, 'v2.html');
  writeFileSync(v1Html, page('<h1>Policy</h1><p>First rule.</p><p>Second rule.</p>'));
  writeFileSync(
    v2Html,
    page('<h1>Policy</h1><p>Preamble.</p><p>First rule.</p><p>Second rule.</p>'),
  );
  v1Path = join(work, 'v1.wdf');
  const run = capture();
  expect(await cmdImport(v1Html, { output: v1Path, date: '2026-09-01T00:00:00Z' }, run)).toBe(0);
});

describe('wdf import --previous / --id', () => {
  it('--previous inherits the id and created, keeps the ids of unchanged paragraphs', async () => {
    const out = join(work, 'v2.wdf');
    const run = capture();
    expect(
      await cmdImport(
        v2Html,
        { output: out, date: '2026-09-16T00:00:00Z', previous: v1Path, withSource: true },
        run,
      ),
    ).toBe(0);
    expect(await cmdValidate(out, {}, capture())).toBe(0);
    const v1 = readPackage(readFileSync(v1Path));
    const v2 = readPackage(readFileSync(out));
    expect(v2.manifest.id).toBe(v1.manifest.id);
    expect(v2.manifest.created).toBe('2026-09-01T00:00:00Z');
    expect(v2.manifest.modified).toBe('2026-09-16T00:00:00Z');
    const html = new TextDecoder().decode(v2.files.get('content/index.html'));
    expect(html).toContain('<p id="p-0001">First rule.</p>');
    expect(html).toContain('<p id="p-0002">Second rule.</p>');
    expect(html).toContain('<p id="p-0003">Preamble.</p>');
    expect(run.logs.some((l) => l.includes('3 element id(s) inherited, 1 new'))).toBe(true);
    // The note is also in the packaged conversion report (ext-source 0.6).
    const report = new TextDecoder().decode(v2.files.get('ext/source/report.json'));
    expect(report).toContain('element id(s) inherited');
  });

  it('--id records the given document id', async () => {
    const out = join(work, 'explicit.wdf');
    const id = 'urn:uuid:6f1f6b2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
    expect(
      await cmdImport(v2Html, { output: out, date: '2026-09-16T00:00:00Z', id }, capture()),
    ).toBe(0);
    expect(readPackage(readFileSync(out)).manifest.id).toBe(id);
  });

  it('an unreadable --previous is an operational error', async () => {
    const run = capture();
    expect(
      await cmdImport(
        v2Html,
        { output: join(work, 'x.wdf'), previous: join(work, 'missing.wdf') },
        run,
      ),
    ).toBe(2);
    expect(run.errs.join('\n')).toContain('previous revision');
  });
});
