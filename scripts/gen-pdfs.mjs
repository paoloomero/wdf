// Generates the comparison PDFs for the examples (plan T5.1) by printing the
// same content/index.html through headless Chrome — a serious PDF, produced
// from the very same source, not a strawman (plan §8.4).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (chrome === undefined) {
  console.error('No Chrome/Chromium found — comparison PDFs not regenerated.');
  process.exit(1);
}

const examplesDir = join(root, 'examples');
for (const name of readdirSync(examplesDir).sort()) {
  const src = join(examplesDir, name);
  if (!existsSync(join(src, 'content', 'index.html'))) continue;

  // Arrange a copy where package-relative paths (content/…, data/…) resolve
  // from the entry document.
  const work = mkdtempSync(join(tmpdir(), 'wdf-pdf-'));
  cpSync(join(src, 'content'), join(work, 'content'), { recursive: true });
  cpSync(join(src, 'content', 'index.html'), join(work, 'index.html'));

  const out = join(src, 'comparison.pdf');
  const result = spawnSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-pdf-header-footer',
      `--print-to-pdf=${out}`,
      `file://${join(work, 'index.html')}`,
    ],
    { stdio: 'pipe', timeout: 60_000 },
  );
  rmSync(work, { recursive: true, force: true });
  if (result.status !== 0) {
    console.error(`${name}: Chrome exited with ${String(result.status)}`);
    console.error(String(result.stderr));
    process.exit(1);
  }
  console.log(`${name}: comparison.pdf written`);
}
mkdirSync(join(root, 'site'), { recursive: true });
