import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// Plan §10.86: every `wdf …` command quoted in the public texts (site,
// READMEs, skills, docs) must exist in this CLI, with the options it quotes.
// Together with the rule "nothing in the texts that npm cannot do", this keeps
// the first copied instruction working.

const root = resolve(import.meta.dirname, '../../..');

/** Commands and their flags, read from the commander definitions. */
function cliSpec(): Map<string, Set<string>> {
  const src = readFileSync(join(root, 'packages/cli/src/index.ts'), 'utf8');
  const spec = new Map<string, Set<string>>();
  for (const block of src.split(".command('").slice(1)) {
    const name = block.slice(0, block.indexOf("'"));
    const flags = new Set(['-h', '--help']);
    for (const m of block.matchAll(/\.option\(\s*'([^']+)'/g)) {
      for (const flag of (m[1] ?? '').matchAll(/(--?[a-z][\w-]*)/g)) flags.add(flag[1] ?? '');
    }
    spec.set(name, flags);
  }
  return spec;
}

function files(dir: string, ext: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules') return [];
    if (statSync(path).isDirectory()) return files(path, ext);
    return ext.test(name) ? [path] : [];
  });
}

const TEXTS = [
  ...files(join(root, 'site'), /\.html$/),
  join(root, 'README.md'),
  ...readdirSync(join(root, 'packages')).map((p) => join(root, 'packages', p, 'README.md')),
  ...files(join(root, 'skills'), /\.md$/),
  ...files(join(root, 'docs'), /\.md$/),
].filter((path) => existsSync(path));

// `wdf <command>` or `npx [-y] @wdf-dev/cli[@version] <command>`.
const INVOCATION = /(?:^|[\s`(>])(?:wdf|npx (?:-y )?@wdf-dev\/cli(?:@[\w.-]+)?) ([a-z]+)\b/;

interface Quote {
  where: string;
  command: string;
  flags: string[];
  /** Quoted as `npx @wdf-dev/cli …`: unambiguously a command. */
  npx: boolean;
}

function quotes(): Quote[] {
  const out: Quote[] = [];
  for (const path of TEXTS) {
    const lines = readFileSync(path, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = INVOCATION.exec(lines[i] ?? '');
      if (m === null) continue;
      // A shell line continued with a backslash belongs to the same command.
      let text = (lines[i] ?? '').slice(m.index);
      let j = i;
      while (text.trimEnd().endsWith('\\') && j + 1 < lines.length) text += ` ${lines[++j] ?? ''}`;
      const flags = [...text.matchAll(/(?:^|\s|`)(--?[a-z][\w-]*)/g)].map((f) => f[1] ?? '');
      out.push({
        where: `${relative(root, path)}:${String(i + 1)}`,
        command: m[1] ?? '',
        flags,
        npx: /^\W?npx/.test(text),
      });
    }
  }
  return out;
}

describe('CLI commands quoted in the public texts (plan §10.86)', () => {
  const spec = cliSpec();
  const all = quotes();

  it('reads the CLI definitions and finds the quoted commands', () => {
    expect([...spec.keys()]).toEqual(
      expect.arrayContaining(['validate', 'pack', 'unpack', 'extract', 'import', 'new']),
    );
    expect(all.some((q) => q.where.startsWith('site/index.html') && q.command === 'import')).toBe(
      true,
    );
  });

  it('quotes only commands and options the CLI has', () => {
    const wrong = all.flatMap((q) => {
      const flags = spec.get(q.command);
      // A bare "wdf <word>" may be prose ("il wdf di…"); npx is always a command.
      if (flags === undefined) return q.npx ? [`${q.where}: unknown command "${q.command}"`] : [];
      return q.flags
        .filter((f) => !flags.has(f))
        .map((f) => `${q.where}: wdf ${q.command} has no ${f}`);
    });
    expect(wrong).toEqual([]);
  });
});
