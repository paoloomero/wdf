// T18.4 acceptance: the REAL extension converts a live page whose video
// embed is MOUNTED BY JAVASCRIPT (the §10.27 dossier case: the content
// does not exist in the served HTML) into a standalone HTML download whose
// embedded .wdf is VALID and verified, carries the capture provenance and
// the dom-snapshot source, and renders the embed as a placeholder link.
//
// Two local origins: the page lives on 127.0.0.1; a second server on
// `localhost` (a DIFFERENT origin, no CORS headers) hosts the video embed
// page, a stylesheet and an image — exercising the declared cross-origin
// report paths of §10.31 alongside the happy paths.
//
// Run with: pnpm --filter @wdf/extension test:e2e
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../..');
const extensionDir = join(here, '../dist/chrome-e2e');

const PAGE_TITLE = 'La conferenza, annotata';
// 1×1 red PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const listen = (server) => new Promise((res) => server.listen(0, '127.0.0.1', res));

// Cross-origin server (reached as http://localhost:<port>): no CORS.
const foreign = createServer((req, res) => {
  if (req.url?.startsWith('/embed/')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><body>player</body></html>');
  } else if (req.url === '/theme.css') {
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
const embedUrl = `${foreignBase}/embed/talk-42`;

const site = createServer((req, res) => {
  if (req.url === '/app.css') {
    res.writeHead(200, { 'content-type': 'text/css' });
    res.end('p { color: rgb(1, 2, 3); }');
  } else if (req.url === '/photo.png') {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(PNG);
  } else if (req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>
<html lang="it"><head><title>${PAGE_TITLE}</title>
<link rel="stylesheet" href="/app.css">
<link rel="stylesheet" href="${foreignBase}/theme.css">
</head><body>
<div id="banner" style="position:fixed;bottom:0">Questo sito usa i cookie — Accetta</div>
<nav id="hidden-menu" style="display:none"><a href="/x">menu nascosto</a></nav>
<main><article><h1>La conferenza, annotata</h1>
<p>Guarda la registrazione e leggi le note.</p>
<figure><img src="/photo.png" alt="copertina"></figure>
<div id="video-slot"></div>
<img src="${foreignBase}/pixel.png" alt="pixel estraneo">
</article></main>
<footer><p>Pubblicato da Esempio SRL</p></footer>
<script>
  // The dossier case: the embed does NOT exist in the served HTML.
  const f = document.createElement('iframe');
  f.src = ${JSON.stringify(embedUrl)};
  f.title = 'video';
  document.getElementById('video-slot').appendChild(f);
</script>
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
  page.on('console', (msg) => console.log(`  [page ${msg.type()}] ${msg.text()}`));
  page.on('dialog', (d) => {
    console.log(`  [page dialog] ${d.message()}`);
    void d.dismiss();
  });
  await page.goto(pageUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('#video-slot iframe');

  const tabId = await worker.evaluate(
    (url) =>
      new Promise((res) => {
        chrome.tabs.query({ url: `${url}*` }, (tabs) => res(tabs[0]?.id));
      }),
    pageUrl,
  );
  assert.notEqual(tabId, undefined, 'fixture tab not found from the service worker');

  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await worker.evaluate((id) => globalThis.wdfStartCapture(id), tabId);
  const download = await downloadPromise;

  // Default output: the sendable standalone HTML, double-suffixed (§10.38).
  assert.equal(download.suggestedFilename(), `${PAGE_TITLE}.wdf.html`);
  const standalone = readFileSync(await download.path(), 'utf8');
  assert.ok(standalone.includes('<title>La conferenza, annotata</title>'), 'standalone title');

  // Extract the embedded package and put it through the REAL validator.
  const b64 = /<script type="application\/wdf\+zip" id="wdf-package">([^<]*)<\/script>/.exec(
    standalone,
  )?.[1];
  assert.ok(b64 !== undefined && b64.length > 0, 'embedded package not found in standalone');
  const wdfBytes = Buffer.from(b64, 'base64');
  const work = mkdtempSync(join(tmpdir(), 'wdf-e2e-'));
  const wdfPath = join(work, 'capture.wdf');
  writeFileSync(wdfPath, wdfBytes);
  const cli = spawnSync(
    process.execPath,
    [join(repoRoot, 'packages/cli/dist/index.js'), 'validate', wdfPath],
    {
      encoding: 'utf8',
    },
  );
  assert.equal(cli.status, 0, `CLI validate failed:\n${cli.stdout}\n${cli.stderr}`);
  assert.ok(cli.stdout.includes('VALID'), cli.stdout);

  // Inspect the package with the reference implementation.
  const core = await import(pathToFileURL(join(repoRoot, 'packages/core/dist/index.js')).href);
  const pkg = core.readPackage(new Uint8Array(wdfBytes));
  const verify = await core.verifyPackage(pkg);
  assert.equal(verify.verified, true, JSON.stringify(verify.problems));
  assert.deepEqual(core.validateCaptureExt(pkg), []);

  const dec = new TextDecoder();
  const captureJson = JSON.parse(dec.decode(pkg.files.get('ext/capture/capture.json')));
  assert.equal(captureJson.capture, '0.1');
  assert.equal(captureJson.url, pageUrl);
  assert.equal(captureJson.mode, 'article');
  assert.ok(captureJson.viewport.width > 0);

  const sourceJson = JSON.parse(dec.decode(pkg.files.get('ext/source/source.json')));
  assert.equal(sourceJson.kind, 'dom-snapshot');
  const original = dec.decode(pkg.files.get(sourceJson.main));
  assert.ok(!original.includes('data-wdf-cap'), 'markers leaked into the embedded source');
  assert.ok(original.includes('<iframe'), 'the snapshot must keep the mounted iframe');

  const html = dec.decode(pkg.files.get('content/index.html'));
  assert.ok(html.includes(`href="${embedUrl}"`), 'embed URL lost');
  assert.ok(html.includes('Open on localhost'), 'placeholder link text missing');
  assert.ok(!html.includes('<iframe'), 'iframe leaked into the canonical');
  assert.ok(!html.includes('cookie'), 'fixed banner leaked into the canonical');
  assert.ok(!html.includes('menu nascosto'), 'hidden menu leaked into the canonical');
  assert.ok(!html.includes('Pubblicato da'), 'article mode must extract the landmark only');
  assert.ok(/content\/assets\/[0-9a-f]{16}\.png/.test(html), 'captured image not packaged');

  // ---- Second run: full page, bare .wdf (the popup's options, T18.5). ----
  const wdfDownloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await worker.evaluate(({ id, options }) => globalThis.wdfStartCapture(id, options), {
    id: tabId,
    options: { mode: 'full-page', output: 'wdf' },
  });
  const wdfDownload = await wdfDownloadPromise;
  assert.equal(wdfDownload.suggestedFilename(), `${PAGE_TITLE}.wdf`);
  const rawWdf = readFileSync(await wdfDownload.path());
  const cliWdf = spawnSync(
    process.execPath,
    [join(repoRoot, 'packages/cli/dist/index.js'), 'validate', await wdfDownload.path()],
    { encoding: 'utf8' },
  );
  assert.equal(cliWdf.status, 0, `CLI validate (.wdf) failed:\n${cliWdf.stdout}\n${cliWdf.stderr}`);
  const fullPkg = core.readPackage(new Uint8Array(rawWdf));
  const fullCapture = JSON.parse(dec.decode(fullPkg.files.get('ext/capture/capture.json')));
  assert.equal(fullCapture.mode, 'full-page');
  const fullHtml = dec.decode(fullPkg.files.get('content/index.html'));
  assert.ok(fullHtml.includes('Pubblicato da Esempio SRL'), 'full-page must keep the footer');
  assert.ok(!fullHtml.includes('cookie'), 'pre-filter must still drop the fixed banner');

  // ---- Popup: one-time privacy notice, ack, restore from options. ----
  const extensionId = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  assert.ok(await popup.isVisible('#privacy-notice'), 'first open must show the privacy notice');
  assert.ok(await popup.isHidden('#controls'), 'controls hidden until acknowledged');
  await popup.click('#privacy-ack');
  await popup.waitForSelector('#controls', { state: 'visible' });
  await popup.reload();
  assert.ok(await popup.isHidden('#privacy-notice'), 'notice must not reappear after ack');
  assert.ok(await popup.isVisible('#controls'), 'controls visible after ack');
  await popup.goto(`chrome-extension://${extensionId}/options.html`);
  await popup.click('#reset-privacy');
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  assert.ok(await popup.isVisible('#privacy-notice'), 'options page must restore the notice');
  await popup.close();

  console.log('e2e OK: capture → convert → download, all three UX paths');
  console.log(`  default:   ${download.suggestedFilename()} (${standalone.length} bytes)`);
  console.log(`  option:    ${wdfDownload.suggestedFilename()} [${fullCapture.mode}]`);
  console.log(
    `  capture.json: ${captureJson.url} @ ${captureJson.capturedAt} [${captureJson.mode}]`,
  );
  console.log(`  placeholder: Open on localhost → ${embedUrl}`);
  console.log('  popup: privacy notice shown once, acknowledged, restored from options');
} finally {
  await context.close();
  site.close();
  foreign.close();
}
