import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { readPackage } from '@wdf-dev/core';
import { describe, expect, it } from 'vitest';

import { cmdImport, type Ctx } from '../../cli/src/commands.js';
import { convertFiles, mapAssetLoader, pickMainFile } from '../src/convert.js';

// T7.6 acceptance (plan §10.24): the Reader's converter runs the same
// isomorphic pipeline as the CLI over an in-memory map of the dropped files
// — same input, same date → byte-identical package — and never touches the
// network: remote references are refused.

const fixturesDir = resolve(import.meta.dirname, '../../../fixtures/import');
const DATE = '2026-08-05T12:00:00Z';

function silent(): Ctx {
  return { log: () => undefined, err: () => undefined, out: () => undefined };
}

/** Reads fixture files into the shape a drag-and-drop produces. */
function mapOf(names: string[], prefix = ''): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const add = (rel: string): void => {
    const full = join(fixturesDir, rel);
    if (statSync(full).isDirectory()) {
      for (const child of readdirSync(full).sort()) add(`${rel}/${child}`);
    } else {
      out.set(prefix + rel, readFileSync(full));
    }
  };
  for (const name of names) add(name);
  return out;
}

describe('pickMainFile', () => {
  it('picks the document, not files inside support folders', () => {
    const files = mapOf(['word-header-it.html', 'word-header-it.fld']);
    expect(pickMainFile(files)).toBe('word-header-it.html');
  });

  it('prefers the shallowest candidate, ties broken alphabetically', () => {
    const files = new Map<string, Uint8Array>([
      ['folder/deep.html', new Uint8Array()],
      ['b.html', new Uint8Array()],
      ['a.html', new Uint8Array()],
    ]);
    expect(pickMainFile(files)).toBe('a.html');
  });

  it('returns undefined when the set has no document', () => {
    expect(pickMainFile(new Map([['image.png', new Uint8Array()]]))).toBeUndefined();
  });
});

describe('no network, ever', () => {
  it('refuses remote and protocol-relative references', async () => {
    const loader = mapAssetLoader(new Map(), 'doc.html', 1024);
    for (const src of ['https://example.org/a.png', '//example.org/a.png', 'ftp://x/a.png']) {
      const load = await loader(src);
      expect('reason' in load && load.reason).toContain('no network');
    }
  });
});

describe('browser converter ↔ CLI parity', () => {
  async function cliBytes(input: string, withSource: boolean): Promise<Uint8Array> {
    const out = join(mkdtempSync(join(tmpdir(), 'wdf-conv-')), 'out.wdf');
    const opts = withSource
      ? { output: out, date: DATE, withSource: true }
      : { output: out, date: DATE };
    const code = await cmdImport(join(fixturesDir, input), opts, silent());
    expect(code).toBe(0);
    return readFileSync(out);
  }

  it('Word export with support folder (header/footer + images) is byte-identical', async () => {
    const files = mapOf(['word-header-it.html', 'word-header-it.fld']);
    const result = await convertFiles(files, { withSource: true, date: DATE });
    expect(result).toBeDefined();
    expect(new Uint8Array(result?.wdfBytes ?? [])).toEqual(
      new Uint8Array(await cliBytes('word-header-it.html', true)),
    );
    // The package really carries the assets and the page header content.
    const pkg = readPackage(result?.wdfBytes ?? new Uint8Array());
    expect([...pkg.files.keys()].some((p) => p.startsWith('content/assets/'))).toBe(true);
  });

  it('a saved page with a local stylesheet embeds it in the source extension', async () => {
    const files = mapOf(['saved-page-css.html', 'saved-page-css_files']);
    const result = await convertFiles(files, { withSource: true, date: DATE });
    expect(new Uint8Array(result?.wdfBytes ?? [])).toEqual(
      new Uint8Array(await cliBytes('saved-page-css.html', true)),
    );
    const pkg = readPackage(result?.wdfBytes ?? new Uint8Array());
    expect([...pkg.files.keys()].some((p) => /^ext\/source\/.*\.css$/.test(p))).toBe(true);
  });

  it('a folder-wrapped drop resolves relative paths from the main file', async () => {
    const flat = await convertFiles(mapOf(['word-header-it.html', 'word-header-it.fld']), {
      withSource: true,
      date: DATE,
    });
    const wrapped = await convertFiles(
      mapOf(['word-header-it.html', 'word-header-it.fld'], 'Documenti/'),
      { withSource: true, date: DATE },
    );
    expect(new Uint8Array(wrapped?.wdfBytes ?? [])).toEqual(new Uint8Array(flat?.wdfBytes ?? []));
  });

  it('a plain Word export without source matches the CLI too', async () => {
    const files = mapOf(['word-headings-it.html']);
    const result = await convertFiles(files, { date: DATE });
    expect(result?.fileName).toBe('word-headings-it.wdf');
    expect(new Uint8Array(result?.wdfBytes ?? [])).toEqual(
      new Uint8Array(await cliBytes('word-headings-it.html', false)),
    );
  });
});
