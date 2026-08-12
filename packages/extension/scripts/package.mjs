// Store packaging (T18.8): builds and zips the submission artifacts —
// dist/wdf-save-as-wdf-chrome-<version>.zip  (Chrome Web Store)
// dist/wdf-save-as-wdf-firefox-<version>.zip (addons.mozilla.org)
// Run with: pnpm --filter @wdf-dev/extension package
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');

const build = spawnSync('node', [join(pkgRoot, 'build.mjs')], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

const version = JSON.parse(readFileSync(join(pkgRoot, 'src/manifest.json'), 'utf8')).version;

for (const target of ['chrome', 'firefox']) {
  const zipName = `wdf-save-as-wdf-${target}-${version}.zip`;
  const zipPath = join(pkgRoot, 'dist', zipName);
  rmSync(zipPath, { force: true });
  // Zip the CONTENTS of the folder (stores want manifest.json at the
  // root). -X plus the excludes keep macOS metadata (__MACOSX, ._*,
  // .DS_Store) out — AMO flags every hidden file. Always submit THIS
  // zip, never a Finder "Compress" of the folder.
  const zip = spawnSync(
    'zip',
    ['-r', '-X', zipPath, '.', '-x', '.*', '-x', '*/.*', '-x', '__MACOSX/*'],
    {
      cwd: join(pkgRoot, 'dist', target),
      stdio: 'pipe',
    },
  );
  if (zip.status !== 0) {
    console.error(`zip failed for ${target}:\n${String(zip.stderr)}`);
    process.exit(1);
  }
  console.log(`dist/${zipName} written`);
}
