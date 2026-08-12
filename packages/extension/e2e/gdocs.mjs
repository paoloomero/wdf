// T18.9 (plan §10.43): site-aware Google Docs capture with the REAL
// extension. The fixture mimics the decisive facts of docs.google.com:
// the editor page's DOM does NOT contain the document (canvas rendering),
// and the official export — gated behind the user's session cookie —
// does. The capture must come from the export, with `source.kind`
// "fetched-html" (server-delivered bytes, not a snapshot).
//
// Run with: pnpm --filter @wdf-dev/extension test:e2e
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { zipSync } from 'fflate';

import {
  captureTab,
  extractEmbeddedWdf,
  launchWithExtension,
  PNG,
  repoRoot,
  serve,
} from './harness.mjs';

const core = await import(pathToFileURL(join(repoRoot, 'packages/core/dist/index.js')).href);
const dec = new TextDecoder();
const enc = new TextEncoder();

const DOC_TITLE = 'Relazione annuale 2026';
const DOC_TEXT = 'Il fatturato consolidato cresce del dodici per cento.';

const exportZip = zipSync({
  'Relazione2026.html': enc.encode(`<html><head><title>${DOC_TITLE}</title></head>
<body><h1>${DOC_TITLE}</h1><p>${DOC_TEXT}</p>
<p><img src="images/image1.png" alt="grafico"></p></body></html>`),
  'images/image1.png': new Uint8Array(PNG),
});

const { server, base } = await serve((req, res) => {
  const authed = (req.headers.cookie ?? '').includes('docsession=ok');
  if (req.url === '/document/d/test42/edit') {
    // The "editor": session cookie set here; the DOM carries NO document
    // text — like the real canvas-based editor.
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'set-cookie': 'docsession=ok; Path=/',
    });
    res.end(`<!doctype html><html><head><title>${DOC_TITLE} - Documenti Google</title></head>
<body><div id="editor-chrome">menu file modifica</div><canvas width="800" height="600"></canvas></body></html>`);
  } else if (req.url === '/document/d/test42/export?format=zip') {
    if (!authed) {
      res.writeHead(401).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/zip' });
    res.end(Buffer.from(exportZip));
  } else {
    res.writeHead(404).end();
  }
});

const { context, worker } = await launchWithExtension();

try {
  // The export really is session-gated (a bare fetch has no cookie).
  assert.equal((await fetch(`${base}/document/d/test42/export?format=zip`)).status, 401);

  const page = await context.newPage();
  await page.goto(`${base}/document/d/test42/edit`, { waitUntil: 'networkidle' });

  const download = await captureTab(worker, page, {
    mode: 'full-page',
    output: 'standalone',
    site: 'gdocs',
  });
  assert.equal(download.suggestedFilename(), `${DOC_TITLE}.wdf.html`);
  const wdfBytes = extractEmbeddedWdf(readFileSync(await download.path(), 'utf8'));
  const pkg = core.readPackage(new Uint8Array(wdfBytes));
  assert.equal((await core.verifyPackage(pkg)).verified, true);
  assert.deepEqual(core.validateCaptureExt(pkg), []);

  const html = dec.decode(pkg.files.get('content/index.html'));
  assert.ok(html.includes(DOC_TEXT), 'document text must come from the export');
  assert.ok(!html.includes('editor-chrome'), 'editor DOM must not leak into the canonical');
  assert.ok(/content\/assets\/[0-9a-f]{16}\.png/.test(html), 'export image not packaged');

  const sourceJson = JSON.parse(dec.decode(pkg.files.get('ext/source/source.json')));
  assert.equal(sourceJson.kind, 'fetched-html', 'export bytes are fetched, not a snapshot');
  const captureJson = JSON.parse(dec.decode(pkg.files.get('ext/capture/capture.json')));
  assert.equal(captureJson.mode, 'full-page');
  assert.ok(captureJson.url.endsWith('/document/d/test42/edit'));

  console.log('e2e gdocs OK: canvas editor bypassed, official export captured with the session');
  console.log(`  ${download.suggestedFilename()} — source.kind=${sourceJson.kind}`);
} finally {
  await context.close();
  server.close();
}
