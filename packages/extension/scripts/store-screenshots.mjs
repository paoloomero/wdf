// Store screenshots (T18.8): 1280×800 PNGs for the CWS/AMO listings,
// generated from the REAL extension so they never lie. Regenerate with:
// node scripts/store-screenshots.mjs  (after node build.mjs)
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { captureTab, launchWithExtension, serve } from '../e2e/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '../store');

const TITLE = 'Il futuro dei documenti verificabili';
const { server, base } = await serve((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="it"><head><title>${TITLE}</title>
<style>body{font:17px/1.7 Georgia,serif;max-width:42rem;margin:2rem auto;padding:0 1rem}</style>
</head><body><main><article>
<h1>${TITLE}</h1>
<p>Un documento dovrebbe restare leggibile, citabile e verificabile anche
fuori dal sito che lo ha pubblicato. Questa pagina di esempio viene
catturata dall'estensione così come il browser la mostra.</p>
<h2>Che cosa contiene il pacchetto</h2>
<p>Il file scaricato contiene il contenuto canonico, il livello per le
agenti AI e le impronte crittografiche che ne provano l'integrità: il
badge qui sopra è la verifica, eseguita interamente offline.</p>
<p>La provenienza della cattura — indirizzo, istante, viewport — è
registrata nel pacchetto e visibile con un click sul badge.</p>
</article></main></body></html>`);
});

const { context, worker } = await launchWithExtension();

try {
  const extensionId = new URL(worker.url()).host;

  // 1. The popup, controls visible (past the one-time notice), framed on
  //    a neutral backdrop at the store's required size.
  await worker.evaluate(() => chrome.storage.local.set({ privacyNoticeAcknowledged: true }));
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 1280, height: 800 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.waitForSelector('#controls', { state: 'visible' });
  await popup.addStyleTag({
    content: `html{background:#e8ebef;display:flex;align-items:center;justify-content:center;height:100%}
      body{background:#fff;border-radius:10px;box-shadow:0 12px 40px rgba(22,32,58,.25)}`,
  });
  await popup.screenshot({ path: join(outDir, 'screenshot-popup.png') });
  await popup.close();

  // 2. The result: the downloaded standalone opened in the browser — the
  //    embedded Reader with its verification badge and capture note.
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(base, { waitUntil: 'networkidle' });
  const download = await captureTab(worker, page);
  // download.path() has no extension — file:// would not render it as HTML.
  const { tmpdir } = await import('node:os');
  const standalonePath = join(tmpdir(), `wdf-store-${String(Date.now())}.wdf.html`);
  await download.saveAs(standalonePath);
  const reader = await context.newPage();
  await reader.setViewportSize({ width: 1280, height: 800 });
  await reader.goto(pathToFileURL(standalonePath).href);
  await reader.waitForSelector('#badge.badge-ok', { timeout: 15000 });
  await reader.screenshot({ path: join(outDir, 'screenshot-reader.png') });

  console.log('store/screenshot-popup.png and store/screenshot-reader.png written');
} finally {
  await context.close();
  server.close();
}
