// Builds the single-file viewer (CLAUDE.md: ONE self-contained HTML file,
// no external requests at runtime) and the standalone template used by
// `wdf pack --standalone` (spec §9, plan T4.5).
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));

const result = await build({
  entryPoints: [join(here, 'src/main.ts')],
  bundle: true,
  format: 'iife',
  minify: true,
  target: ['es2020'],
  legalComments: 'none',
  write: false,
  // WP21 T21.2: the PDF.js wrapper is a SEPARATE same-origin asset the
  // Reader deployment ships next to viewer.html; the main bundle keeps a
  // native dynamic import so viewer.html itself stays one self-contained
  // file (the standalone never calls it).
  external: ['./pdfjs.js'],
});

// A literal "</script>" inside the bundle would terminate the host tag.
const js = (result.outputFiles[0]?.text ?? '').replaceAll('</script>', '<\\/script>');
const css = readFileSync(join(here, 'src/viewer.css'), 'utf8');
const shell = readFileSync(join(here, 'src/shell.html'), 'utf8');

const page = shell
  .replace('<!--WDF:CSS-->', () => `<style>\n${css}</style>`)
  .replace('<!--WDF:JS-->', () => `<script>\n${js}\n</script>`);

mkdirSync(join(here, 'dist'), { recursive: true });
writeFileSync(join(here, 'dist/viewer.html'), page.replace('<!--WDF:PACKAGE-->', ''));

const standalone = page
  .replace('<title>WDF Viewer</title>', '<title>__WDF_TITLE__</title>')
  // A standalone file is a document artifact opened from file://, not the
  // installable app: no manifest link.
  .replace(/\s*<link rel="manifest"[^>]*\/>/, '')
  .replace(
    '<!--WDF:PACKAGE-->',
    '<script type="application/wdf+zip" id="wdf-package">__WDF_PACKAGE_BASE64__</script>',
  );
writeFileSync(join(here, 'dist/standalone.html'), standalone);

// Reader-only lazy assets (WP21 T21.2, plan §10.57): PDF.js wrapper and its
// worker, deployed by the site build next to viewer.html and precached by
// the service worker. They are NOT part of the npm package (`files` in
// package.json) and never enter viewer.html or the standalone template.
await build({
  entryPoints: [join(here, 'src/pdfview.ts')],
  outfile: join(here, 'dist/pdfjs.js'),
  bundle: true,
  format: 'esm',
  minify: true,
  target: ['es2020'],
  legalComments: 'none',
});
await build({
  entryPoints: [join(here, 'node_modules/pdfjs-dist/build/pdf.worker.mjs')],
  outfile: join(here, 'dist/pdfjs-worker.js'),
  bundle: true,
  // Classic-script bundle: loads correctly whether pdf.js instantiates the
  // worker as a module or a classic worker.
  format: 'iife',
  minify: true,
  target: ['es2020'],
  legalComments: 'none',
});

// Reader-only typography (home redesign, plan §10.62; fonts from the
// "wdf_home_v2" handoff, plan §10.80): IBM Plex, self-hosted as lazy
// deployment assets — same model as PDF.js. main.ts injects plex.css only in
// app mode; the standalone falls back to the system font stacks, so
// viewer.html and every .wdf.html stay single self-contained files. Plex Sans
// is one variable file covering 400–600; Plex Mono ships three static weights.
const PLEX = [
  ['IBM Plex Sans', '400 600', 'IBMPlexSans-Variable.woff2'],
  ['IBM Plex Mono', '400', 'IBMPlexMono-400.woff2'],
  ['IBM Plex Mono', '500', 'IBMPlexMono-500.woff2'],
  ['IBM Plex Mono', '600', 'IBMPlexMono-600.woff2'],
];
rmSync(join(here, 'dist/plex'), { recursive: true, force: true });
mkdirSync(join(here, 'dist/plex'), { recursive: true });
const faces = [];
for (const [name, weight, file] of PLEX) {
  copyFileSync(join(here, 'fonts', file), join(here, 'dist/plex', file));
  faces.push(
    `@font-face { font-family: "${name}"; font-style: normal; font-weight: ${weight}; font-display: swap; src: url("plex/${file}") format("woff2"); }`,
  );
}
copyFileSync(join(here, 'fonts/LICENSE-IBMPlex.txt'), join(here, 'dist/plex/LICENSE-IBMPlex.txt'));
writeFileSync(join(here, 'dist/plex.css'), `${faces.join('\n')}\n`);

console.log(
  `viewer.html (${String(Math.round(page.length / 1024))} KiB), standalone.html template, pdfjs + plex assets written`,
);
