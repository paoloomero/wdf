import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { buildPackage } from '@wdf-dev/import';
import { readDirFiles } from '../../cli/src/lib/fsutil.js';
import { handleMessage } from '../src/rpc.js';
import { callTool, type McpState } from '../src/tools.js';

const examplesDir = resolve(import.meta.dirname, '../../../examples');

let wdfPath: string;
let tamperedPath: string;

beforeAll(async () => {
  const work = mkdtempSync(join(tmpdir(), 'wdf-mcp-'));
  const bytes = await buildPackage(readDirFiles(join(examplesDir, 'municipal-decree')));
  wdfPath = join(work, 'decree.wdf');
  writeFileSync(wdfPath, bytes);

  // Flip one byte mid-archive: depending on where it lands the package is
  // either structurally unreadable or fails verification — never VERIFIED.
  tamperedPath = join(work, 'tampered.wdf');
  const tampered = Uint8Array.from(bytes);
  const mid = Math.floor(tampered.length / 2);
  tampered[mid] = (tampered[mid] ?? 0) ^ 0xff;
  writeFileSync(tamperedPath, tampered);
});

function text(result: { content: { type: 'text'; text: string }[] }): string {
  return result.content.map((c) => c.text).join('\n');
}

describe('WDF tools (T6.1)', () => {
  it('wdf_open verifies and summarizes the document', async () => {
    const state: McpState = {};
    const result = await callTool(state, 'wdf_open', { path: wdfPath });
    expect(result.isError).toBeUndefined();
    const out = text(result);
    expect(out).toContain('Decree no. 87/2026');
    expect(out).toContain('Verification: VERIFIED');
    expect(out).toContain('sec-recitals');
    expect(state.doc?.outline.length).toBeGreaterThan(10);
  });

  it('wdf_outline returns the ordered structure map', async () => {
    const state: McpState = {};
    await callTool(state, 'wdf_open', { path: wdfPath });
    const result = await callTool(state, 'wdf_outline', {});
    const outline = JSON.parse(text(result)) as { id: string; type: string }[];
    expect(outline.some((n) => n.id === 'tbl-commitments' && n.type === 'table')).toBe(true);
  });

  it('wdf_read with a section id returns the whole subtree', async () => {
    const state: McpState = {};
    await callTool(state, 'wdf_open', { path: wdfPath });
    const result = await callTool(state, 'wdf_read', { id: 'sec-operative' });
    const out = text(result);
    expect(out).toContain('## Operative part {#h-operative} {#sec-operative}');
    expect(out).toContain('{#li-0001}');
    expect(out).toContain('| chapter | year | amount | due |');
    expect(out).not.toContain('{#sec-recitals}');
  });

  it('wdf_read without id returns the full canonical markdown', async () => {
    const state: McpState = {};
    await callTool(state, 'wdf_open', { path: wdfPath });
    const result = await callTool(state, 'wdf_read', {});
    expect(text(result)).toContain('# Decree no. 87/2026');
  });

  it('wdf_cite returns a resolvable, verified citation', async () => {
    const state: McpState = {};
    await callTool(state, 'wdf_open', { path: wdfPath });
    const result = await callTool(state, 'wdf_cite', { id: 'tbl-commitments' });
    const out = text(result);
    expect(out).toContain(
      'Citation: wdf:urn:uuid:7d444840-9dc0-5d1c-b745-1a56c4e5f6a7#tbl-commitments',
    );
    expect(out).toContain('Verified: yes');
    expect(out).toContain('Spending commitments by chapter and year {#tbl-commitments}');
  });

  it('tools fail cleanly without an open document or with unknown ids', async () => {
    const state: McpState = {};
    expect((await callTool(state, 'wdf_outline', {})).isError).toBe(true);
    await callTool(state, 'wdf_open', { path: wdfPath });
    const missing = await callTool(state, 'wdf_cite', { id: 'sec-nope' });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toContain('wdf_outline');
  });

  it('a tampered package is reported, not silently served', async () => {
    const state: McpState = {};
    const result = await callTool(state, 'wdf_open', { path: tamperedPath });
    // Depending on where the flip lands, the package is either unreadable
    // (structural error) or opens with a failed verification — never VERIFIED.
    expect(text(result)).not.toContain('Verification: VERIFIED');
  });
});

describe('one verdict on every surface (plan §10.70, T05)', () => {
  let mismatchPath: string;

  beforeAll(async () => {
    // The review's T05: the first commitment becomes 99999 in the dataset
    // while the table still shows 14640; hashes are regenerated, so the
    // old verdict (hashes + derivation only) said VERIFIED.
    const files = readDirFiles(join(examplesDir, 'municipal-decree'));
    const dataPath = 'data/commitments.json';
    const data = JSON.parse(new TextDecoder().decode(files.get(dataPath))) as {
      rows: number[][];
    };
    (data.rows[0] as number[])[2] = 99999;
    files.set(dataPath, new TextEncoder().encode(JSON.stringify(data)));
    mismatchPath = join(mkdtempSync(join(tmpdir(), 'wdf-mcp-t05-')), 'mismatch.wdf');
    writeFileSync(mismatchPath, await buildPackage(files));
  });

  it('wdf_open reports the dataset mismatch as NOT VERIFIED / Not conforming', async () => {
    const state: McpState = {};
    const result = await callTool(state, 'wdf_open', { path: mismatchPath });
    expect(result.isError).toBeUndefined();
    const out = text(result);
    expect(out).not.toContain('Verification: VERIFIED');
    expect(out).toContain('NOT VERIFIED');
    expect(out).toContain('Not conforming');
    expect(out).toContain('§6.5.4');
    expect(state.doc?.validation.status).toBe('not-conforming');
  });

  it('wdf_read still serves the content, but every answer is marked unverified', async () => {
    const state: McpState = {};
    await callTool(state, 'wdf_open', { path: mismatchPath });
    const whole = text(await callTool(state, 'wdf_read', {}));
    expect(whole.startsWith('NOT VERIFIED')).toBe(true);
    expect(whole).toContain('14640');
    const part = text(await callTool(state, 'wdf_read', { id: 'tbl-commitments' }));
    expect(part.startsWith('NOT VERIFIED')).toBe(true);
  });

  it('wdf_cite says NO with the status, never "provably"', async () => {
    const state: McpState = {};
    await callTool(state, 'wdf_open', { path: mismatchPath });
    const out = text(await callTool(state, 'wdf_cite', { id: 'tbl-commitments' }));
    expect(out).toContain('Verified: NO');
    expect(out).toContain('Not conforming');
  });

  it('a verified package carries no banner', async () => {
    const state: McpState = {};
    await callTool(state, 'wdf_open', { path: wdfPath });
    expect(text(await callTool(state, 'wdf_read', {})).startsWith('NOT VERIFIED')).toBe(false);
  });
});

describe('JSON-RPC layer', () => {
  it('speaks the MCP handshake and lists tools', async () => {
    const state: McpState = {};
    const init = await handleMessage(state, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18' },
    });
    expect(init?.result).toMatchObject({
      protocolVersion: '2025-06-18',
      serverInfo: { name: 'wdf-mcp' },
    });
    expect(
      await handleMessage(state, { jsonrpc: '2.0', method: 'notifications/initialized' }),
    ).toBeNull();

    const list = await handleMessage(state, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = (list?.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(tools).toEqual(['wdf_open', 'wdf_outline', 'wdf_read', 'wdf_cite']);
  });

  it('routes tools/call end-to-end', async () => {
    const state: McpState = {};
    const reply = await handleMessage(state, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'wdf_open', arguments: { path: wdfPath } },
    });
    const result = reply?.result as { content: { text: string }[] };
    expect(result.content[0]?.text).toContain('Verification: VERIFIED');
  });

  it('rejects unknown methods with -32601', async () => {
    const reply = await handleMessage({}, { jsonrpc: '2.0', id: 4, method: 'resources/list' });
    expect(reply?.error?.code).toBe(-32601);
  });
});
