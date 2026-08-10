// T18.7: the remaining dossier cases of §10.27 as deterministic local
// fixtures, captured with the REAL extension.
//
// 1. JS-mounted article: the served HTML has NO article — a script builds
//    it in the DOM (the Anthropic/Accademia gap: "the content does not
//    exist in the downloaded HTML"). The capture must contain it.
// 2. Fake login: the article and its image exist only WITH the session
//    cookie — `wdf import <url>` could never reach them; the extension
//    runs with the page's session and captures what the user sees.
//
// Run with: pnpm --filter @wdf/extension test:e2e
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  captureTab,
  extractEmbeddedWdf,
  launchWithExtension,
  PNG,
  repoRoot,
  serve,
} from './harness.mjs';

const { pathToFileURL } = await import('node:url');
const { join } = await import('node:path');
const core = await import(pathToFileURL(join(repoRoot, 'packages/core/dist/index.js')).href);
const dec = new TextDecoder();

const MOUNTED_TITLE = 'Verbale della seduta';
const MOUNTED_TEXT = 'Il consiglio approva il bilancio con voti favorevoli quattordici.';
const PRIVATE_TITLE = 'Area riservata — circolare interna';
const PRIVATE_TEXT = 'La circolare interna numero 7 è riservata al personale autenticato.';

const { server, base } = await serve((req, res) => {
  const authed = (req.headers.cookie ?? '').includes('wdfsession=ok');
  if (req.url === '/spa') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    // NO article in the served bytes: the client fetches JSON from an API
    // and mounts the DOM — the real shape of the dossier gap.
    res.end(`<!doctype html><html lang="it"><head><title>${MOUNTED_TITLE}</title></head>
<body><div id="app"></div>
<script>
  fetch('/api/article').then((r) => r.json()).then((data) => {
    const main = document.createElement('main');
    const article = document.createElement('article');
    const h1 = document.createElement('h1');
    h1.textContent = data.title;
    const p = document.createElement('p');
    p.textContent = data.body;
    article.append(h1, p);
    main.append(article);
    document.getElementById('app').append(main);
  });
</script></body></html>`);
  } else if (req.url === '/api/article') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ title: MOUNTED_TITLE, body: MOUNTED_TEXT }));
  } else if (req.url === '/login') {
    res.writeHead(302, { 'set-cookie': 'wdfsession=ok; Path=/', location: '/private' });
    res.end();
  } else if (req.url === '/private') {
    if (!authed) {
      res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><body><p>Accesso richiesto.</p></body></html>');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html lang="it"><head><title>${PRIVATE_TITLE}</title></head>
<body><main><article><h1>${PRIVATE_TITLE}</h1>
<p>${PRIVATE_TEXT}</p>
<figure><img src="/badge.png" alt="badge"></figure>
</article></main></body></html>`);
  } else if (req.url === '/badge.png') {
    if (!authed) {
      res.writeHead(403).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(PNG);
  } else {
    res.writeHead(404).end();
  }
});

const { context, worker } = await launchWithExtension();

try {
  // ---- Case 1: JS-mounted article. ----
  // The served bytes really lack the content (the dossier gap).
  const served = await (await fetch(`${base}/spa`)).text();
  assert.ok(!served.includes(MOUNTED_TEXT), 'fixture must not ship the article in the HTML');

  const spa = await context.newPage();
  await spa.goto(`${base}/spa`, { waitUntil: 'networkidle' });
  await spa.waitForSelector('#app article');
  const spaDownload = await captureTab(worker, spa);
  assert.equal(spaDownload.suggestedFilename(), `${MOUNTED_TITLE}.wdf.html`);
  const spaWdf = extractEmbeddedWdf(readFileSync(await spaDownload.path(), 'utf8'));
  const spaPkg = core.readPackage(new Uint8Array(spaWdf));
  assert.equal((await core.verifyPackage(spaPkg)).verified, true);
  const spaHtml = dec.decode(spaPkg.files.get('content/index.html'));
  assert.ok(spaHtml.includes(MOUNTED_TEXT), 'JS-mounted text missing from the canonical');
  const spaMd = dec.decode(spaPkg.files.get('ai/content.md'));
  assert.ok(spaMd.includes(MOUNTED_TEXT), 'JS-mounted text missing from the AI layer');
  await spa.close();

  // ---- Case 2: behind a (fake) login. ----
  // Without the session the server denies both page and image.
  assert.equal((await fetch(`${base}/private`)).status, 401);
  assert.equal((await fetch(`${base}/badge.png`)).status, 403);

  const priv = await context.newPage();
  await priv.goto(`${base}/login`, { waitUntil: 'networkidle' });
  assert.ok(priv.url().endsWith('/private'), 'login redirect failed');
  const privDownload = await captureTab(worker, priv);
  assert.equal(privDownload.suggestedFilename(), `${PRIVATE_TITLE}.wdf.html`);
  const privWdf = extractEmbeddedWdf(readFileSync(await privDownload.path(), 'utf8'));
  const privPkg = core.readPackage(new Uint8Array(privWdf));
  assert.equal((await core.verifyPackage(privPkg)).verified, true);
  const privHtml = dec.decode(privPkg.files.get('content/index.html'));
  assert.ok(privHtml.includes(PRIVATE_TEXT), 'session-gated text missing from the canonical');
  assert.ok(
    /content\/assets\/[0-9a-f]{16}\.png/.test(privHtml),
    'session-gated image not captured through the page session',
  );
  const capture = JSON.parse(dec.decode(privPkg.files.get('ext/capture/capture.json')));
  assert.equal(capture.url, `${base}/private`);
  await priv.close();

  console.log('e2e dossier OK: JS-mounted article and login-gated page both captured');
  console.log(`  spa:     ${spaDownload.suggestedFilename()} (content absent from served HTML)`);
  console.log(`  private: ${privDownload.suggestedFilename()} (401/403 without the session)`);
} finally {
  await context.close();
  server.close();
}
