// Drives the real @wdf/mcp server over stdio and records the exchange as
// docs/mcp-demo.md — the "agent-ready" demo of plan T6.1, reproducible with:
//   pnpm build && node scripts/mcp-demo.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Build the example package the agent will read.
const work = mkdtempSync(join(tmpdir(), 'wdf-mcp-demo-'));
const wdfPath = join(work, 'delibera-pa.wdf');
const pack = spawnSync(process.execPath, [
  join(root, 'packages/cli/dist/index.js'),
  'pack',
  join(root, 'examples/delibera-pa'),
  '-o',
  wdfPath,
]);
if (pack.status !== 0) {
  console.error(String(pack.stderr));
  process.exit(1);
}

const server = spawn(process.execPath, [join(root, 'packages/mcp/dist/index.js')], {
  stdio: ['pipe', 'pipe', 'inherit'],
});
const lines = createInterface({ input: server.stdout });
const pending = new Map();
lines.on('line', (line) => {
  const message = JSON.parse(line);
  const resolve = pending.get(message.id);
  if (resolve) resolve(message);
});

let nextId = 1;
function call(method, params) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

const steps = [];
async function step(title, method, params) {
  const reply = await call(method, params);
  steps.push({ title, method, params, reply });
  return reply;
}

await step('Handshake', 'initialize', { protocolVersion: '2025-06-18', capabilities: {} });
server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
await step('Discover the tools', 'tools/list', {});
await step('Open and verify the document', 'tools/call', {
  name: 'wdf_open',
  arguments: { path: wdfPath },
});
await step('Navigate: the structure map', 'tools/call', { name: 'wdf_outline', arguments: {} });
await step('Read one section, precisely', 'tools/call', {
  name: 'wdf_read',
  arguments: { id: 'sec-dispositivo' },
});
await step('Cite a table, verifiably', 'tools/call', {
  name: 'wdf_cite',
  arguments: { id: 'tbl-impegni' },
});
server.stdin.end();

function renderResult(reply) {
  const result = reply.result ?? reply.error;
  if (result?.content?.[0]?.type === 'text') {
    return result.content.map((c) => c.text).join('\n');
  }
  return JSON.stringify(result, null, 2);
}

const out = [];
out.push('# MCP demo: an agent reading a WDF package (T6.1)');
out.push('');
out.push(
  'A recorded, reproducible session with the `@wdf/mcp` server (stdio, JSON-RPC/MCP) reading',
  'the example decree. Regenerate with `pnpm build && node scripts/mcp-demo.mjs`.',
  'Register the server in an MCP client, e.g. Claude Code:',
  '',
  '```sh',
  'claude mcp add wdf -- node <repo>/packages/mcp/dist/index.js',
  '```',
  '',
);
for (const s of steps) {
  out.push(`## ${s.title}`);
  out.push('');
  out.push('```json');
  out.push(JSON.stringify({ method: s.method, params: s.params }, null, 2));
  out.push('```');
  out.push('');
  const rendered = renderResult(s.reply);
  const truncated =
    s.method === 'tools/list'
      ? JSON.stringify(
          s.reply.result.tools.map((t) => t.name),
          null,
          2,
        )
      : rendered.length > 1800
        ? `${rendered.slice(0, 1800)}\n… (truncated; ${String(rendered.length)} chars)`
        : rendered;
  out.push('```');
  out.push(truncated);
  out.push('```');
  out.push('');
}
out.push(
  '**Why this matters:** the agent never parsed HTML or guessed at structure — it navigated by',
  'stable ids, read canonical Markdown whose fidelity to the rendered document is',
  'machine-verified, and produced citations any reviewer can resolve and check.',
  '',
);

mkdirSync(join(root, 'docs'), { recursive: true });
writeFileSync(join(root, 'docs/mcp-demo.md'), out.join('\n'));
console.log('docs/mcp-demo.md written');
