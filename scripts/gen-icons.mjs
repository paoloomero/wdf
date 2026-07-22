// Generates the PWA icons (plan T8.1) as PNG screenshots of a sized HTML
// page via headless Chrome — no image dependency needed. Committed artifacts;
// regenerate with: node scripts/gen-icons.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

// maskable: full-bleed background (safe zone ≥ 80%); regular: rounded tile.
function iconHtml(size, { maskable }) {
  const radius = maskable ? 0 : Math.round(size * 0.18);
  const font = Math.round(size * (maskable ? 0.28 : 0.32));
  const sub = Math.round(size * 0.1);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; }
  body { width: ${size}px; height: ${size}px; overflow: hidden; }
  .tile { width: 100%; height: 100%; border-radius: ${radius}px;
    background: linear-gradient(160deg, #16203a 0%, #1a56c4 100%);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    font-family: -apple-system, system-ui, sans-serif; }
  .w { color: #fff; font-size: ${font}px; font-weight: 700; letter-spacing: 0.02em; }
  .s { color: #9db9ea; font-size: ${sub}px; font-weight: 600; letter-spacing: 0.3em;
    margin-top: ${Math.round(size * 0.02)}px; }
  </style></head><body><div class="tile"><div class="w">WDF</div><div class="s">READER</div></div></body></html>`;
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
rmSync(work, { recursive: true, force: true });
