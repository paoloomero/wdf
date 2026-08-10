// T18.1 acceptance: the content script → background → download pipe,
// exercised with the REAL extension loaded in Chromium (plan §10.32).
// Uses dist/chrome-e2e (production build + localhost host permission; see
// build.mjs for why automation cannot rely on the activeTab gesture), and
// triggers the background's entry point through its wdfStartCapture hook
// because no automation API clicks the toolbar action.
//
// Run with: pnpm --filter @wdf/extension test:e2e
// (needs `pnpm exec playwright install chromium` once; not part of the
// default `pnpm test` — CI wiring is T18.7.)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const extensionDir = join(here, '../dist/chrome-e2e');

const PAGE_TITLE = 'Pipe check — Città di Périgueux';
const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(
    `<!doctype html><html><head><title>${PAGE_TITLE}</title></head><body><p>hello</p></body></html>`,
  );
});
await new Promise((res) => server.listen(0, '127.0.0.1', res));
const port = server.address().port;
const pageUrl = `http://127.0.0.1:${port}/`;

const context = await chromium.launchPersistentContext('', {
  // Extensions need the FULL Chromium in new-headless mode — the default
  // headless shell does not load them.
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
});

try {
  // The MV3 service worker may not be up yet when the context opens.
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker', { timeout: 15000 });

  const page = await context.newPage();
  await page.goto(pageUrl);

  const tabId = await worker.evaluate(
    (url) =>
      new Promise((res) => {
        chrome.tabs.query({ url: `${url}*` }, (tabs) => res(tabs[0]?.id));
      }),
    pageUrl,
  );
  assert.notEqual(tabId, undefined, 'fixture tab not found from the service worker');

  const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
  await worker.evaluate((id) => globalThis.wdfStartCapture(id), tabId);
  const download = await downloadPromise;

  assert.equal(download.suggestedFilename(), `${PAGE_TITLE}.txt`);
  const text = readFileSync(await download.path(), 'utf8');
  assert.ok(text.includes(`title: ${PAGE_TITLE}`), `title missing in payload:\n${text}`);
  assert.ok(text.includes(`url: ${pageUrl}`), `url missing in payload:\n${text}`);

  console.log('e2e smoke OK: click → inject → message → convert → download');
  console.log(`  suggested filename: ${download.suggestedFilename()}`);
  console.log(text.replace(/^/gm, '  | '));
} finally {
  await context.close();
  server.close();
}
