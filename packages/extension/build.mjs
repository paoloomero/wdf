// Builds the loadable extension folder (plan §10.32 T18.1, viewer-build
// style): dist/chrome/ is what chrome://extensions "Load unpacked" takes.
// dist/chrome-e2e/ is the SAME build plus a localhost host permission:
// automation cannot produce the toolbar click that grants activeTab, so
// the smoke test (e2e/smoke.mjs) needs declared access to its fixture
// server. The production manifest never carries host permissions (§10.31).
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import { firefoxManifest } from './build-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'dist/chrome');

rmSync(join(here, 'dist'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [
    join(here, 'src/background.ts'),
    join(here, 'src/content.ts'),
    join(here, 'src/content-gdocs.ts'),
    join(here, 'src/popup.ts'),
    join(here, 'src/options.ts'),
  ],
  bundle: true,
  format: 'iife',
  minify: true,
  target: ['chrome110'],
  legalComments: 'none',
  // The viewer's standalone template ships inside the background bundle
  // (T18.4): the extension is fully client-side, no template fetch ever.
  loader: { '.html': 'text' },
  outdir: out,
});

cpSync(join(here, 'src/manifest.json'), join(out, 'manifest.json'));
cpSync(join(here, 'src/popup.html'), join(out, 'popup.html'));
cpSync(join(here, 'src/options.html'), join(out, 'options.html'));
cpSync(join(here, 'icons'), join(out, 'icons'), { recursive: true });

const manifest = JSON.parse(readFileSync(join(here, 'src/manifest.json'), 'utf8'));
manifest.name += ' (e2e)';
manifest.host_permissions = ['http://127.0.0.1/*', 'http://localhost/*'];
const e2e = join(here, 'dist/chrome-e2e');
cpSync(out, e2e, { recursive: true });
writeFileSync(join(e2e, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// Firefox (T18.6): same files, event-page manifest. Load it from
// about:debugging → "Load Temporary Add-on" → dist/firefox/manifest.json.
const chromeManifest = JSON.parse(readFileSync(join(here, 'src/manifest.json'), 'utf8'));
const firefox = join(here, 'dist/firefox');
cpSync(out, firefox, { recursive: true });
writeFileSync(
  join(firefox, 'manifest.json'),
  JSON.stringify(firefoxManifest(chromeManifest), null, 2) + '\n',
);

console.log('extension built: dist/chrome + dist/firefox (loadable), dist/chrome-e2e (smoke test)');
