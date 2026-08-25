// Assembles the public demo site (plan T5.2) into _site/:
// pitch page, hosted viewer, the three examples as .wdf + standalone .html +
// comparison .pdf. Run with: pnpm demo
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, '_site');
const cli = join(root, 'packages/cli/dist/index.js');

rmSync(site, { recursive: true, force: true });
mkdirSync(join(site, 'examples'), { recursive: true });

const run = (args) => {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

for (const name of ['municipal-decree', 'energy-report', 'technical-article']) {
  const src = join(root, 'examples', name);
  run([cli, 'pack', src, '-o', join(site, 'examples', `${name}.wdf`)]);
  run([cli, 'validate', join(site, 'examples', `${name}.wdf`)]);
  run([cli, 'pack', src, '--standalone', '-o', join(site, 'examples', `${name}.html`)]);
  const pdf = join(src, 'comparison.pdf');
  if (existsSync(pdf)) cpSync(pdf, join(site, 'examples', `${name}.pdf`));
}

cpSync(join(root, 'packages/viewer/dist/viewer.html'), join(site, 'viewer.html'));
// Reader-only lazy assets (WP21 T21.2): PDF.js wrapper + worker, loaded on
// demand by the Reader's Original view and precached by the service worker.
// The standalone template never references them.
cpSync(join(root, 'packages/viewer/dist/pdfjs.js'), join(site, 'pdfjs.js'));
cpSync(join(root, 'packages/viewer/dist/pdfjs-worker.js'), join(site, 'pdfjs-worker.js'));
// Reader-only typography (plan §10.62): IBM Plex, injected by main.ts in app
// mode only; the standalone falls back to system fonts.
cpSync(join(root, 'packages/viewer/dist/plex.css'), join(site, 'plex.css'));
cpSync(join(root, 'packages/viewer/dist/plex'), join(site, 'plex'), { recursive: true });
cpSync(join(root, 'site/index.html'), join(site, 'index.html'));
cpSync(join(root, 'site/extension-privacy.html'), join(site, 'extension-privacy.html'));
cpSync(join(root, 'site/site.css'), join(site, 'site.css'));
cpSync(join(root, 'site/favicon.ico'), join(site, 'favicon.ico'));
// PWA shell (plan T8.1): manifest with .wdf file_handlers, offline worker, icons.
cpSync(join(root, 'site/manifest.webmanifest'), join(site, 'manifest.webmanifest'));
// Stamp the SW cache name with the viewer build hash (plan §10.18): a new
// viewer build changes sw.js, which triggers the SW update cycle and evicts
// the stale offline shell that §10.17 ran into.
const viewerHash = createHash('sha256')
  .update(readFileSync(join(site, 'viewer.html')))
  // The lazy assets are part of the shell: a PDF.js update must evict the
  // stale precache exactly like a viewer update does.
  .update(readFileSync(join(site, 'pdfjs.js')))
  .update(readFileSync(join(site, 'pdfjs-worker.js')))
  .update(readFileSync(join(site, 'plex.css')))
  .digest('hex')
  .slice(0, 8);
const sw = readFileSync(join(root, 'site/sw.js'), 'utf8');
writeFileSync(join(site, 'sw.js'), sw.replace("'wdf-reader-v1'", `'wdf-reader-${viewerHash}'`));
cpSync(join(root, 'site/icons'), join(site, 'icons'), { recursive: true });
cpSync(join(root, 'spec/wdf-core-0.1.md'), join(site, 'wdf-core-0.1.md'));
for (const doc of ['llm-extraction-comparison.md', 'mcp-demo.md']) {
  if (existsSync(join(root, 'docs', doc))) cpSync(join(root, 'docs', doc), join(site, doc));
}

console.log(`demo site assembled in _site/`);
