import { readFileSync } from 'node:fs';

import {
  readPackage,
  verifyPackage,
  WdfError,
  type VerifyResult,
  type WdfOutline,
  type WdfPackage,
} from '@wdf/core';

/**
 * The WDF tool surface for AI agents (plan T6.1). Everything an agent reads
 * comes from the package's AI layer — whose fidelity to the rendered document
 * is machine-verified (spec §7.1, §8.2) — never from parsing heuristics.
 */

export interface OpenDocument {
  path: string;
  pkg: WdfPackage;
  markdown: string;
  outline: WdfOutline;
  blocks: { text: string; ids: string[] }[];
  verify: VerifyResult;
}

export interface McpState {
  doc?: OpenDocument;
}

const dec = new TextDecoder('utf-8', { fatal: true });

function splitBlocks(markdown: string): { text: string; ids: string[] }[] {
  const body = markdown.endsWith('\n') ? markdown.slice(0, -1) : markdown;
  if (body === '') return [];
  const blocks = body.split('\n\n').map((text) => ({
    text,
    ids: [...text.matchAll(/\{#([a-z]+-[a-z0-9-]*)\}/g)].map((m) => m[1] ?? ''),
  }));
  // Anchor-less blocks (table rows after their caption, thematic breaks)
  // belong to the element of the preceding block: inherit its ids.
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const previous = blocks[i - 1];
    if (block !== undefined && previous !== undefined && block.ids.length === 0) {
      block.ids = previous.ids;
    }
  }
  return blocks;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: object;
}

export const TOOLS: ToolDefinition[] = [
  {
    name: 'wdf_open',
    description:
      'Open a .wdf package from a filesystem path, verify it (hashes + determinism of the AI layer), and return its summary. Must be called before the other tools.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path to a .wdf file' } },
      required: ['path'],
    },
  },
  {
    name: 'wdf_outline',
    description:
      'Structure map of the open document: ordered nodes {id, type, level?, title?, parent} for every citable element. Navigate with these ids — no HTML parsing needed.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'wdf_read',
    description:
      'Read the canonical Markdown of the open document. With no arguments returns the whole ai/content.md; with an element id returns that element (for sections and blockquotes: the element and all its descendants). Every block carries its {#id} anchors.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Optional citable element id, e.g. "tbl-commitments"' },
      },
    },
  },
  {
    name: 'wdf_cite',
    description:
      'Build a verifiable citation (wdf:<document-id>#<element-id>) for a citable element of the open document, with the exact quoted content it resolves to.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Citable element id' } },
      required: ['id'],
    },
  },
];

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

function ok(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

function fail(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function requireDoc(state: McpState): OpenDocument | undefined {
  return state.doc;
}

/** ids of `id` plus every outline descendant, in document order. */
function subtreeIds(outline: WdfOutline, id: string): Set<string> {
  const wanted = new Set<string>([id]);
  // The outline is in document order; parents precede descendants.
  for (const node of outline) {
    if (node.parent !== null && wanted.has(node.parent)) wanted.add(node.id);
  }
  return wanted;
}

async function toolOpen(state: McpState, path: string): Promise<ToolResult> {
  let pkg: WdfPackage;
  try {
    pkg = readPackage(readFileSync(path));
  } catch (e) {
    return fail(
      e instanceof WdfError
        ? `Not a valid WDF package: ${e.message}`
        : `Cannot open ${path}: ${String(e)}`,
    );
  }
  const markdown = dec.decode(pkg.files.get('ai/content.md') ?? new Uint8Array());
  const outline = JSON.parse(
    dec.decode(pkg.files.get('ai/outline.json') ?? new Uint8Array()),
  ) as WdfOutline;
  const verify = await verifyPackage(pkg);
  state.doc = { path, pkg, markdown, outline, blocks: splitBlocks(markdown), verify };

  const sections = outline
    .filter((n) => n.type === 'section' && n.parent === null)
    .map((n) => `${n.id}${n.title === undefined ? '' : ` — ${n.title}`}`);
  const status = verify.verified
    ? 'VERIFIED (hashes ok, AI layer is the canonical extraction of the content)'
    : `NOT VERIFIED: ${verify.problems.map((p) => `[${p.spec}] ${p.message}`).join('; ')}`;
  return ok(
    [
      `Opened: ${pkg.manifest.title}`,
      `Document id: ${pkg.manifest.id}`,
      `Language: ${pkg.manifest.language} · ${String(outline.length)} citable elements · ${String(state.doc.blocks.length)} blocks`,
      `Verification: ${status}`,
      sections.length > 0 ? `Top-level sections: ${sections.join(', ')}` : 'No top-level sections.',
      'Use wdf_outline to navigate, wdf_read to read, wdf_cite for verifiable citations.',
    ].join('\n'),
  );
}

function toolOutline(state: McpState): ToolResult {
  const doc = requireDoc(state);
  if (doc === undefined) return fail('No document open. Call wdf_open first.');
  return ok(JSON.stringify(doc.outline, null, 2));
}

function toolRead(state: McpState, id: string | undefined): ToolResult {
  const doc = requireDoc(state);
  if (doc === undefined) return fail('No document open. Call wdf_open first.');
  if (id === undefined || id === '') return ok(doc.markdown);
  if (!doc.outline.some((n) => n.id === id)) {
    return fail(`No citable element "${id}" in this document. Use wdf_outline to list elements.`);
  }
  const wanted = subtreeIds(doc.outline, id);
  const blocks = doc.blocks.filter((b) => b.ids.some((x) => wanted.has(x)));
  return ok(blocks.map((b) => b.text).join('\n\n'));
}

function toolCite(state: McpState, id: string): ToolResult {
  const doc = requireDoc(state);
  if (doc === undefined) return fail('No document open. Call wdf_open first.');
  if (!doc.outline.some((n) => n.id === id)) {
    return fail(`No citable element "${id}" in this document. Use wdf_outline to list elements.`);
  }
  const block = doc.blocks.find((b) => b.ids.includes(id));
  return ok(
    [
      `Citation: wdf:${doc.pkg.manifest.id}#${id}`,
      `Verified: ${doc.verify.verified ? 'yes — the cited content is provably what the human-view document shows' : 'NO — this package failed verification'}`,
      'Resolves to:',
      block === undefined ? '(container element; use wdf_read for its content)' : block.text,
    ].join('\n'),
  );
}

export async function callTool(
  state: McpState,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const str = (key: string): string | undefined => {
    const value = args[key];
    return typeof value === 'string' ? value : undefined;
  };
  switch (name) {
    case 'wdf_open': {
      const path = str('path');
      return path === undefined ? fail('wdf_open requires a "path" string') : toolOpen(state, path);
    }
    case 'wdf_outline':
      return toolOutline(state);
    case 'wdf_read':
      return toolRead(state, str('id'));
    case 'wdf_cite': {
      const id = str('id');
      return id === undefined ? fail('wdf_cite requires an "id" string') : toolCite(state, id);
    }
    default:
      return fail(`Unknown tool: ${name}`);
  }
}
