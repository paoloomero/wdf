import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { buildPackage } from '@wdf-dev/import';
import { beforeAll, describe, expect, it } from 'vitest';

import { cmdValidate, type Ctx } from '../src/commands.js';
import { readDirFiles } from '../src/lib/fsutil.js';

// `wdf validate` reports the single verdict of validatePackage() (spec §8.2
// errata 2026-09-15, plan §10.70): the review's T05 vector and a structural
// failure, on the CLI surface (the foreign-version case is covered in core).

const examplesDir = resolve(import.meta.dirname, '../../../examples');

interface Capture extends Ctx {
  logs: string[];
  errs: string[];
  stdout: string[];
}

function capture(): Capture {
  const c: Capture = {
    logs: [],
    errs: [],
    stdout: [],
    log: (s) => c.logs.push(s),
    err: (s) => c.errs.push(s),
    out: (s) => c.stdout.push(s),
  };
  return c;
}

let work: string;
let mismatchPath: string;
let garbagePath: string;

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'wdf-cli-validate-'));
  const files = readDirFiles(join(examplesDir, 'municipal-decree'));
  const dataPath = 'data/commitments.json';
  const data = JSON.parse(new TextDecoder().decode(files.get(dataPath))) as { rows: number[][] };
  (data.rows[0] as number[])[2] = 99999; // table still shows 14640
  files.set(dataPath, new TextEncoder().encode(JSON.stringify(data)));
  mismatchPath = join(work, 'mismatch.wdf');
  writeFileSync(mismatchPath, await buildPackage(files));

  garbagePath = join(work, 'garbage.wdf');
  writeFileSync(garbagePath, new TextEncoder().encode('this is not a zip archive'));
});

describe('wdf validate — one verdict (plan §10.70)', () => {
  it('T05: dataset/table mismatch is INVALID, status not-conforming, exit 1', async () => {
    const c = capture();
    expect(await cmdValidate(mismatchPath, {}, c)).toBe(1);
    const last = c.logs.at(-1) ?? '';
    expect(last).toContain('INVALID');
    expect(last).toContain('status not-conforming');
    expect(last).toContain('integrity ok, determinism ok');
    expect(c.logs.some((l) => l.includes('§6.5.4'))).toBe(true);
  });

  it('--json carries the status vocabulary', async () => {
    const c = capture();
    expect(await cmdValidate(mismatchPath, { json: true }, c)).toBe(1);
    const parsed = JSON.parse(c.logs.join('')) as {
      valid: boolean;
      status: string;
      conformance: boolean;
      integrity: boolean;
      determinism: boolean;
    };
    expect(parsed).toMatchObject({
      valid: false,
      status: 'not-conforming',
      conformance: false,
      integrity: true,
      determinism: true,
    });
  });

  it('an unreadable file is not-conforming with the §3.1 violation, never tampering', async () => {
    const c = capture();
    expect(await cmdValidate(garbagePath, {}, c)).toBe(1);
    expect(c.logs.at(-1)).toContain('status not-conforming');
    expect(c.logs.some((l) => l.includes('§3.1'))).toBe(true);
    expect(c.logs.join('\n')).not.toMatch(/tamper/i);
  });
});
