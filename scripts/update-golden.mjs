// Regenerates the golden files under fixtures/golden/*/ from each input.html.
// Golden files are contracts (CLAUDE.md): review the diff carefully.
// Requires @wdf/core to be built: pnpm golden:update does both.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { extract, serializeOutline } = await import(join(root, 'packages/core/dist/index.js'));

const goldenRoot = join(root, 'fixtures/golden');
for (const name of readdirSync(goldenRoot).sort()) {
  const dir = join(goldenRoot, name);
  const html = readFileSync(join(dir, 'input.html'), 'utf8');
  const { markdown, outline } = extract(html);
  writeFileSync(join(dir, 'content.md'), markdown);
  writeFileSync(join(dir, 'outline.json'), serializeOutline(outline));
  console.log(
    `${name}: content.md (${String(markdown.length)} bytes), outline.json (${String(outline.length)} nodes)`,
  );
}
