#!/usr/bin/env node
// MCP server for WDF packages over stdio. Register e.g. in Claude Code:
//   claude mcp add wdf -- node <repo>/packages/mcp/dist/index.js
import { serveStdio } from './rpc.js';

serveStdio(process.stdin, process.stdout);
