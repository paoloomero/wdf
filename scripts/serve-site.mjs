// Minimal static server for the demo site (docs/reader-install.md):
//   pnpm demo && node scripts/serve-site.mjs   → http://localhost:8642
// Correct MIME types matter: service workers and the web app manifest are
// rejected by the browser when served as octet-stream.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '_site');
const port = Number(process.argv[3] ?? 8642);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.md': 'text/markdown; charset=utf-8',
  '.wdf': 'application/wdf+zip',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

createServer(async (req, res) => {
  try {
    const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^\/+/, '');
    const file = join(root, path === '' ? 'index.html' : path);
    if (!file.startsWith(root)) throw new Error('forbidden');
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(port, () => {
  console.log(`serving ${root} on http://localhost:${String(port)}`);
});
