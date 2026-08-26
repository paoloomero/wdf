// Shared plumbing of the extension e2e suite (T18.7): launch Chromium
// with the real extension, trigger a capture the way the popup does, and
// unwrap the downloaded artifacts.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
export const extensionDir = join(here, '../dist/chrome-e2e');
export const repoRoot = join(here, '../../..');

// 1×1 red PNG.
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Starts an http server on a 127.0.0.1 ephemeral port. */
export async function serve(handler) {
  const server = createServer(handler);
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

/** Launches full Chromium (new headless) with the e2e extension build. */
export async function launchWithExtension() {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker', { timeout: 15000 });
  return { context, worker };
}

/**
 * Triggers a capture of the page's tab through the background's
 * wdfStartCapture hook (the same entry point the popup uses — automation
 * cannot click the toolbar) and returns the resulting download.
 *
 * 0.1.1: the background saves via chrome.downloads, which Playwright's
 * page 'download' event does not observe — the harness polls the
 * extension's own downloads API instead and hands back a Download-like
 * shim (suggestedFilename / path / saveAs, the methods the suites use).
 */
export async function captureTab(worker, page, options) {
  const tabId = await worker.evaluate(
    (url) =>
      new Promise((res) => {
        chrome.tabs.query({ url: `${url.split('#')[0]}*` }, (tabs) => res(tabs[0]?.id));
      }),
    page.url(),
  );
  assert.notEqual(tabId, undefined, `tab not found for ${page.url()}`);
  const listDownloads = () =>
    worker.evaluate(
      () =>
        new Promise((res) => {
          chrome.downloads.search({}, (items) =>
            res(items.map((i) => ({ id: i.id, state: i.state, filename: i.filename }))),
          );
        }),
    );
  const before = new Set((await listDownloads()).map((i) => i.id));
  await worker.evaluate(({ id, options }) => globalThis.wdfStartCapture(id, options), {
    id: tabId,
    options,
  });
  const deadline = Date.now() + 30000;
  for (;;) {
    const items = await listDownloads();
    const item = items.find((i) => !before.has(i.id) && i.state === 'complete');
    if (item) {
      const { copyFileSync } = await import('node:fs');
      const { basename } = await import('node:path');
      // Playwright reroutes browser-level downloads to GUID-named files;
      // the intended name comes from the background's test hook.
      const saved = await worker.evaluate(() => globalThis.wdfLastSavedFilename);
      return {
        suggestedFilename: () => saved ?? basename(item.filename),
        path: () => Promise.resolve(item.filename),
        saveAs: (dest) => {
          copyFileSync(item.filename, dest);
          return Promise.resolve();
        },
      };
    }
    if (Date.now() > deadline) {
      throw new Error(`download did not complete: ${JSON.stringify(items)}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Extracts the embedded .wdf bytes from a standalone .wdf.html file. */
export function extractEmbeddedWdf(standaloneText) {
  const b64 = /<script type="application\/wdf\+zip" id="wdf-package">([^<]*)<\/script>/.exec(
    standaloneText,
  )?.[1];
  assert.ok(b64 !== undefined && b64.length > 0, 'embedded package not found in standalone');
  return Buffer.from(b64, 'base64');
}
