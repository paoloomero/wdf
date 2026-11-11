import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { readPackage, sha256Hex } from '@wdf-dev/core';
import { describe, expect, it } from 'vitest';

import { callTool, type McpState } from '../../mcp/src/tools.js';
import { cmdCite, cmdPack, type Ctx } from '../src/commands.js';

// Plan §10.93: `wdf cite` — the citation with the content hash that pins
// the revision, from the CLI on npm and not only from the MCP server. Both
// must give the same answer.

const examplesDir = resolve(import.meta.dirname, '../../../examples');

interface Capture extends Ctx {
  outText: string;
  errors: string[];
}
function capture(): Capture {
  const c: Capture = {
    outText: '',
    errors: [],
    log: () => undefined,
    err: (s) => c.errors.push(s),
    out: (s) => {
      c.outText += s;
    },
  };
  return c;
}
const silent: Ctx = { log: () => undefined, err: () => undefined, out: () => undefined };

const work = mkdtempSync(join(tmpdir(), 'wdf-cite-'));
const wdf = join(work, 'decree.wdf');
const standalone = join(work, 'decree.html');

async function build(): Promise<void> {
  expect(await cmdPack(join(examplesDir, 'municipal-decree'), { output: wdf }, silent)).toBe(0);
  expect(
    await cmdPack(
      join(examplesDir, 'municipal-decree'),
      { output: standalone, standalone: true },
      silent,
    ),
  ).toBe(0);
}

describe('wdf cite', () => {
  it('prints the wdf: URI, the content hash, the verdict and the quoted content', async () => {
    await build();
    const pkg = readPackage(readFileSync(wdf));
    const hash = await sha256Hex(pkg.files.get('ai/content.md') ?? new Uint8Array());
    const run = capture();
    expect(await cmdCite(wdf, 'p-signature', {}, run)).toBe(0);
    const lines = run.outText.split('\n');
    expect(lines[0]).toBe(`Citation: wdf:${pkg.manifest.id}#p-signature`);
    expect(lines[1]).toBe(
      `Content hash: sha256:${hash} of ai/content.md (spec §8.1) — pins the revision the quote comes from`,
    );
    expect(lines[2]).toMatch(/^Verified: yes — /);
    expect(lines[3]).toBe('Resolves to:');
    expect(lines[4]).toContain('{#p-signature}');
  });

  it('gives the same answer as the MCP tool wdf_cite', async () => {
    await build();
    const state: McpState = {};
    await callTool(state, 'wdf_open', { path: wdf });
    const mcp = await callTool(state, 'wdf_cite', { id: 'p-signature' });
    const run = capture();
    await cmdCite(wdf, 'p-signature', {}, run);
    expect(run.outText.trimEnd()).toBe(mcp.content[0]?.text);
  });

  it('reads a standalone .wdf.html too, with the same citation and hash', async () => {
    await build();
    const a = capture();
    const b = capture();
    expect(await cmdCite(wdf, 'p-signature', {}, a)).toBe(0);
    expect(await cmdCite(standalone, 'p-signature', {}, b)).toBe(0);
    expect(b.outText).toBe(a.outText);
  });

  it('--json is machine-readable', async () => {
    await build();
    const run = capture();
    expect(await cmdCite(wdf, 'p-signature', { json: true }, run)).toBe(0);
    const json = JSON.parse(run.outText) as Record<string, unknown>;
    expect(json['citation']).toMatch(/^wdf:urn:uuid:[0-9a-f-]+#p-signature$/);
    expect(json['contentHash']).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(json['verified']).toBe(true);
    expect(String(json['text'])).toContain('{#p-signature}');
  });

  it('refuses an id the document does not have', async () => {
    await build();
    const run = capture();
    expect(await cmdCite(wdf, 'p-nope', {}, run)).toBe(1);
    expect(run.errors.join('\n')).toContain('no citable element "p-nope"');
    expect(run.outText).toBe('');
  });

  it('a tampered package is never cited as verified (exit code 1)', async () => {
    await build();
    // Flip one byte in the middle of the archive, as the validate test does.
    const bytes = new Uint8Array(readFileSync(wdf));
    const mid = Math.floor(bytes.length / 2);
    bytes[mid] = (bytes[mid] ?? 0) ^ 0xff;
    const bad = join(work, 'tampered.wdf');
    writeFileSync(bad, bytes);
    const run = capture();
    expect(await cmdCite(bad, 'p-signature', {}, run)).toBe(1);
    expect(run.outText).not.toContain('Verified: yes');
  });
});
