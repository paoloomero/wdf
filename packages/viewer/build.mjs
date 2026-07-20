// Builds the single-file viewer (CLAUDE.md: ONE self-contained HTML file,
// no external requests at runtime) and the standalone template used by
// `wdf pack --standalone` (spec §9, plan T4.5).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  .replace(
    '<!--WDF:PACKAGE-->',
    '<script type="application/wdf+zip" id="wdf-package">__WDF_PACKAGE_BASE64__</script>',
  );
writeFileSync(join(here, 'dist/standalone.html'), standalone);

console.log(
  `viewer.html (${String(Math.round(page.length / 1024))} KiB), standalone.html template written`,
);
