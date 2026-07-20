// Assembles the public demo site (plan T5.2) into _site/:
// pitch page, hosted viewer, the three examples as .wdf + standalone .html +
// comparison .pdf. Run with: pnpm demo
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
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

for (const name of ['delibera-pa', 'report-dati', 'articolo-tecnico']) {
  const src = join(root, 'examples', name);
  run([cli, 'pack', src, '-o', join(site, 'examples', `${name}.wdf`)]);
  run([cli, 'validate', join(site, 'examples', `${name}.wdf`)]);
  run([cli, 'pack', src, '--standalone', '-o', join(site, 'examples', `${name}.html`)]);
  const pdf = join(src, 'comparison.pdf');
  if (existsSync(pdf)) cpSync(pdf, join(site, 'examples', `${name}.pdf`));
}

cpSync(join(root, 'packages/viewer/dist/viewer.html'), join(site, 'viewer.html'));
cpSync(join(root, 'site/index.html'), join(site, 'index.html'));
cpSync(join(root, 'site/site.css'), join(site, 'site.css'));
cpSync(join(root, 'spec/wdf-core-0.1.md'), join(site, 'wdf-core-0.1.md'));
for (const doc of ['llm-extraction-comparison.md', 'mcp-demo.md']) {
  if (existsSync(join(root, 'docs', doc))) cpSync(join(root, 'docs', doc), join(site, doc));
}

console.log(`demo site assembled in _site/`);
