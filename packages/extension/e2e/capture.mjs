// T18.2 acceptance: the real capture — DOM snapshot + geometry, CSSOM and
// fetch-fallback stylesheets, canvas images, cross-origin limits in the
// report — exercised with the REAL extension loaded in Chromium.
//
// Two local origins: the page lives on 127.0.0.1, a second server on
// `localhost` (a DIFFERENT origin) serves a stylesheet and an image
// WITHOUT CORS headers — so the sheet's CSSOM is blocked and its fetch is
// CORS-denied (report), and the image taints the canvas and its fetch is
// denied too (report). That is the declared activeTab cost (§10.31).
//
// Run with: pnpm --filter @wdf/extension test:e2e
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const extensionDir = join(here, '../dist/chrome-e2e');

const PAGE_TITLE = 'Cattura — Città di Périgueux';
// 1×1 red PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const listen = (server) => new Promise((res) => server.listen(0, '127.0.0.1', res));

// Cross-origin server (reached as http://localhost:<port>): no CORS headers.
const foreign = createServer((req, res) => {
  if (req.url === '/theme.css') {
    res.writeHead(200, { 'content-type': 'text/css' });
    res.end('h1 { letter-spacing: 1px; }');
  } else if (req.url === '/pixel.png') {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(PNG);
  } else {
    res.writeHead(404).end();
  }
});
await listen(foreign);
const foreignBase = `http://localhost:${foreign.address().port}`;

const site = createServer((req, res) => {
  if (req.url === '/app.css') {
    res.writeHead(200, { 'content-type': 'text/css' });
    res.end('p { color: rgb(1, 2, 3); }\n.hero { margin: 0; }');
  } else if (req.url === '/photo.png') {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(PNG);
  } else if (req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>
<html lang="it"><head><title>${PAGE_TITLE}</title>
<link rel="stylesheet" href="/app.css">
<link rel="stylesheet" href="${foreignBase}/theme.css">
<style>body { font-family: serif; }</style>
</head><body>
<header id="stick" style="position:sticky;top:0">sticky header</header>
<div id="banner" style="position:fixed;bottom:0">cookie banner</div>
<nav id="hidden-menu" style="display:none"><a href="/x">menu</a></nav>
<div id="offscreen" style="position:absolute;left:-9999px">skip link trap</div>
<article><h1>Il documento</h1><p>Testo.</p>
<img id="same" src="/photo.png" srcset="/photo.png 1x, /photo.png 2x" alt="foto">
<img id="foreign" src="${foreignBase}/pixel.png" alt="pixel">
<iframe src="about:blank" title="embed"></iframe>
</article>
</body></html>`);
  } else {
    res.writeHead(404).end();
  }
});
await listen(site);
const pageUrl = `http://127.0.0.1:${site.address().port}/`;

const context = await chromium.launchPersistentContext('', {
  // Extensions need the FULL Chromium in new-headless mode.
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
});

try {
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker', { timeout: 15000 });

  const page = await context.newPage();
  await page.goto(pageUrl, { waitUntil: 'networkidle' });

  const tabId = await worker.evaluate(
    (url) =>
      new Promise((res) => {
        chrome.tabs.query({ url: `${url}*` }, (tabs) => res(tabs[0]?.id));
      }),
    pageUrl,
  );
  assert.notEqual(tabId, undefined, 'fixture tab not found from the service worker');

  const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
  await worker.evaluate((id) => globalThis.wdfStartCapture(id), tabId);
  const download = await downloadPromise;

  assert.equal(download.suggestedFilename(), `${PAGE_TITLE}.capture.json`);
  const d = JSON.parse(readFileSync(await download.path(), 'utf8'));

  // Provenance (the future capture.json, docs/ext-capture.md §4).
  assert.equal(d.provenance.url, pageUrl);
  assert.ok(d.provenance.userAgent.includes('Chrome'), 'user agent missing');
  assert.ok(d.provenance.viewport.width > 0 && d.provenance.viewport.height > 0);
  assert.match(d.provenance.capturedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

  // Snapshot.
  assert.equal(d.page.title, PAGE_TITLE);
  assert.equal(d.page.lang, 'it');
  assert.ok(d.page.snapshotBytes > 500, 'snapshot suspiciously small');

  // Geometry facts for the T18.3 pre-filter.
  assert.ok(d.geometry.elements > 10, 'too few elements measured');
  assert.ok(d.geometry.hidden >= 2, `hidden count: ${d.geometry.hidden}`); // nav + its child a
  assert.ok(d.geometry.fixedOrSticky >= 2, `fixed/sticky count: ${d.geometry.fixedOrSticky}`);

  // Stylesheets: same-origin via CSSOM; cross-origin without CORS ends in
  // the report (CSSOM blocked AND fetch CORS-denied).
  const sameSheet = d.stylesheets.find((s) => s.href.endsWith('/app.css'));
  assert.equal(sameSheet?.origin, 'cssom');
  assert.ok(sameSheet.bytes > 20);
  assert.ok(
    d.report.some((line) => line.includes('theme.css')),
    `cross-origin sheet not reported: ${JSON.stringify(d.report)}`,
  );

  // Images: same-origin from the render (canvas → PNG); cross-origin
  // without CORS taints the canvas and its fetch is denied → report.
  const sameImg = d.images.find((i) => i.url.endsWith('/photo.png'));
  assert.equal(sameImg?.origin, 'canvas');
  assert.equal(sameImg?.mediaType, 'image/png');
  assert.ok(
    d.report.some((line) => line.includes('pixel.png')),
    `cross-origin image not reported: ${JSON.stringify(d.report)}`,
  );

  // The iframe is announced as a future placeholder (ext-capture §5).
  assert.ok(d.report.some((line) => line.includes('iframe')));

  console.log('e2e capture OK: snapshot + geometry + stylesheets + images + report');
  console.log(
    `  elements: ${d.geometry.elements}, hidden: ${d.geometry.hidden}, fixed/sticky: ${d.geometry.fixedOrSticky}`,
  );
  console.log(
    `  stylesheets: ${d.stylesheets.map((s) => `${s.href.split('/').pop()}[${s.origin}]`).join(', ')}`,
  );
  console.log(
    `  images: ${d.images.map((i) => `${i.url.split('/').pop()}[${i.origin}]`).join(', ')}`,
  );
  for (const line of d.report) console.log(`  | ${line}`);
} finally {
  await context.close();
  site.close();
  foreign.close();
}
