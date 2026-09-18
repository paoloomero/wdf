// Assembles the public demo site (plan T5.2) into _site/:
// pitch page, hosted viewer, the three examples as .wdf + standalone .html +
// comparison .pdf. Run with: pnpm demo
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
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
cpSync(join(root, 'site/manifesto.html'), join(site, 'manifesto.html'));
// Feature illustrations (brand/illustrations, web-sized in site/illustrations).
cpSync(join(root, 'site/illustrations'), join(site, 'illustrations'), { recursive: true });
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

// Spec as an indexable page (plan §10.72): the Markdown spec goes through our
// own importer, and the package's content/index.html is set into the site
// frame (topbar and footer taken from manifesto.html). Fixed date = the
// spec's own date, so the build stays deterministic.
const origin = 'https://wdf.dev/';
const specWdf = join(site, 'spec.wdf');
run([
  cli,
  'import',
  join(root, 'spec/wdf-core-0.1.md'),
  '-o',
  specWdf,
  '--date',
  '2026-07-18T00:00:00Z',
]);
run([cli, 'validate', specWdf]);
const specDir = mkdtempSync(join(tmpdir(), 'wdf-spec-'));
run([cli, 'unpack', specWdf, specDir]);
const specDoc = readFileSync(join(specDir, 'content/index.html'), 'utf8');
rmSync(specDir, { recursive: true, force: true });
const specBody = specDoc.slice(
  specDoc.indexOf('<article>') + '<article>'.length,
  specDoc.lastIndexOf('</article>'),
);
const specTitle = 'WDF Core 0.1 — Web Document Format Core Specification';
const specDescription =
  'The WDF Core 0.1 specification: container, WDF-HTML profile, canonical AI-layer extraction, integrity and the standalone distribution profile.';
const frame = readFileSync(join(root, 'site/manifesto.html'), 'utf8');
const specPage =
  frame
    .slice(0, frame.indexOf('<main'))
    .replace(/<title>[^<]*<\/title>/, `<title>${specTitle}</title>`)
    .replace(/(<meta\s+name="description"\s+content=")[^"]*"/, `$1${specDescription}"`)
    .replace(/(<meta\s+property="og:title"\s+content=")[^"]*"/, `$1${specTitle}"`)
    .replace(/(<meta\s+property="og:description"\s+content=")[^"]*"/, `$1${specDescription}"`)
    .replaceAll(`${origin}manifesto.html`, `${origin}spec.html`)
    .replace(' aria-current="page"', '')
    .replace('<a href="spec.html">Spec</a>', '<a href="spec.html" aria-current="page">Spec</a>') +
  `<main class="article article--spec">
      <div class="band">
        <div class="band__in">
          <p class="eyebrow">Specification</p>
          <p class="spec__formats">
            This page is the spec imported as a WDF document:
            <a href="viewer.html?doc=spec.wdf">open it in the Reader</a> ·
            <a href="spec.wdf" download>spec.wdf</a> ·
            <a href="wdf-core-0.1.md">Markdown source</a>
          </p>
${specBody}
        </div>
      </div>
    ` +
  frame.slice(frame.indexOf('</main>'));
writeFileSync(join(site, 'spec.html'), specPage);

// Crawler entry points (plan §10.72). No lastmod: the build stays time-independent.
const pages = ['', 'manifesto.html', 'spec.html', 'extension-privacy.html'];
writeFileSync(
  join(site, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${origin}sitemap.xml\n`,
);
writeFileSync(
  join(site, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    pages.map((page) => `  <url><loc>${origin}${page}</loc></url>\n`).join('') +
    `</urlset>\n`,
);

console.log(`demo site assembled in _site/`);
