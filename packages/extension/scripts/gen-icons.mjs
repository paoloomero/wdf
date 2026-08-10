// Rasterizes the extension icons (T18.8) from the brand tile SVG — same
// approach as the repo's scripts/gen-icons.mjs (screenshots, no image
// dependency), but through Playwright's Chromium, which this package
// already carries for the e2e suite. Committed artifacts; regenerate
// with: node scripts/gen-icons.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const outDir = join(here, '../icons');
mkdirSync(outDir, { recursive: true });

const tileSvg = readFileSync(join(root, 'brand/svg/wdf-reader.svg'), 'utf8');

const iconHtml = (size) => `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; }
  body { width: ${size}px; height: ${size}px; overflow: hidden; background: transparent;
    display: flex; align-items: center; justify-content: center; }
  svg { width: ${size}px; height: ${size}px; display: block; }
  </style></head><body>${tileSvg}</body></html>`;

const work = mkdtempSync(join(tmpdir(), 'wdf-ext-icons-'));
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const page = await browser.newPage();

for (const size of [16, 32, 48, 128]) {
  const file = join(work, `icon-${size}.html`);
  writeFileSync(file, iconHtml(size));
  await page.setViewportSize({ width: size, height: size });
  await page.goto(pathToFileURL(file).href);
  await page.screenshot({
    path: join(outDir, `icon-${size}.png`),
    omitBackground: true,
  });
  console.log(`icons/icon-${size}.png written`);
}
await browser.close();
