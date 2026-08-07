// Rasterizes the PWA icons (plan T8.1) from the brand SVG sources in brand/svg/
// as PNG screenshots via headless Chrome — no image dependency needed.
// Committed artifacts; regenerate with: node scripts/gen-icons.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'site/icons');
mkdirSync(outDir, { recursive: true });

const chrome = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => existsSync(p));
if (chrome === undefined) {
  console.error('No Chrome/Chromium found — icons not regenerated.');
  process.exit(1);
}

const tileSvg = readFileSync(join(root, 'brand/svg/wdf-reader.svg'), 'utf8');
const INK = '#101418';

// Regular icons: the tile fills the canvas (its own rounded corners show on a
// transparent background). Maskable: full-bleed ink square with the tile in
// the ~80% safe zone — Android crops a circle out of it.
function iconHtml(size, { maskable }) {
  const scale = maskable ? 0.8 : 1;
  const bg = maskable ? INK : 'transparent';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; }
  body { width: ${size}px; height: ${size}px; overflow: hidden; background: ${bg};
    display: flex; align-items: center; justify-content: center; }
  svg { width: ${Math.round(size * scale)}px; height: ${Math.round(size * scale)}px; display: block; }
  </style></head><body>${tileSvg}</body></html>`;
}

const work = mkdtempSync(join(tmpdir(), 'wdf-icons-'));
const targets = [
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['maskable-512.png', 512, { maskable: true }],
];
for (const [name, size, opts] of targets) {
  const page = join(work, `${name}.html`);
  writeFileSync(page, iconHtml(size, opts));
  const result = spawnSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--force-device-scale-factor=1',
      '--default-background-color=00000000',
      `--window-size=${size},${size}`,
      `--screenshot=${join(outDir, name)}`,
      `file://${page}`,
    ],
    { stdio: 'pipe', timeout: 30_000 },
  );
  if (result.status !== 0) {
    console.error(`${name}: Chrome exited with ${result.status}\n${String(result.stderr)}`);
    process.exit(1);
  }
  console.log(`${name} written`);
}
