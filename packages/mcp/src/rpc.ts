import { callTool, TOOLS, type McpState } from './tools.js';

/**
 * Minimal MCP server core: JSON-RPC 2.0, newline-delimited, stdio transport.
 * Hand-rolled on purpose — the tools surface of MCP is small, and this keeps
 * the runtime dependency budget at zero (CLAUDE.md). Pure request→responses
 * function, so the whole protocol is unit-testable in-process.
 */

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export const SERVER_INFO = { name: 'wdf-mcp', version: '0.1.0' };
const FALLBACK_PROTOCOL = '2024-11-05';

function response(id: number | string | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function errorResponse(id: number | string | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * Handles one incoming message; returns the response to emit, or null for
 * notifications (which get no response).
 */
export async function handleMessage(
  state: McpState,
  message: JsonRpcRequest,
): Promise<JsonRpcResponse | null> {
  const id = message.id ?? null;
  const isNotification = message.id === undefined;

  switch (message.method) {
    case 'initialize': {
      const requested = message.params?.['protocolVersion'];
      return response(id, {
        protocolVersion: typeof requested === 'string' ? requested : FALLBACK_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions:
          'Tools for reading WDF (Web Document Format) packages. Start with wdf_open(path); ' +
          'then wdf_outline to navigate, wdf_read to read canonical content, wdf_cite for ' +
          'verifiable citations of the form wdf:<document-id>#<element-id>.',
      });
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return response(id, {});
    case 'tools/list':
      return response(id, { tools: TOOLS });
    case 'tools/call': {
      const name = message.params?.['name'];
      const args = message.params?.['arguments'];
      if (typeof name !== 'string') {
        return errorResponse(id, -32602, 'tools/call requires a tool name');
      }
      const result = await callTool(
        state,
        name,
        typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {},
      );
      return response(id, result);
    }
    default:
      if (isNotification) return null;
      return errorResponse(id, -32601, `Method not found: ${message.method ?? '(none)'}`);
  }
}

/** Runs the newline-delimited stdio loop. */
export function serveStdio(input: NodeJS.ReadableStream, output: NodeJS.WritableStream): void {
  const state: McpState = {};
  let buffer = '';
  input.setEncoding('utf8');
  input.on('data', (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (line === '') continue;
      void (async () => {
        let reply: JsonRpcResponse | null;
        try {
          reply = await handleMessage(state, JSON.parse(line) as JsonRpcRequest);
        } catch {
          reply = errorResponse(null, -32700, 'Parse error');
        }
        if (reply !== null) output.write(`${JSON.stringify(reply)}\n`);
      })();
    }
  });
}
