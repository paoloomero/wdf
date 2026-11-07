import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Publish contract (plan §10.46, WP19): exactly these packages go to npm; the
// extension is distributed through the browser stores, never through npm.
const PUBLISHED = ['core', 'import', 'viewer', 'cli', 'mcp'];

const packagesDir = join(import.meta.dirname, '../..');

function readPkg(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(packagesDir, name, 'package.json'), 'utf8'));
}

describe('npm publish contract (plan §10.46)', () => {
  it('exactly the five published packages are public', () => {
    for (const dir of readdirSync(packagesDir)) {
      if (!existsSync(join(packagesDir, dir, 'package.json'))) continue;
      const pkg = readPkg(dir);
      if (PUBLISHED.includes(dir)) {
        expect(pkg.private, `${dir} must be publishable`).toBeUndefined();
      } else {
        expect(pkg.private, `${dir} must stay private`).toBe(true);
      }
    }
  });

  it.each(PUBLISHED)('%s carries the required publish metadata', (dir) => {
    const pkg = readPkg(dir);
    expect(pkg.name).toBe(`@wdf-dev/${dir}`);
    expect(pkg.license).toBe('Apache-2.0');
    expect(pkg.homepage).toBe('https://wdf.dev');
    expect(pkg.bugs).toBe('https://github.com/paoloomero/wdf/issues');
    expect((pkg.repository as { directory?: string }).directory).toBe(`packages/${dir}`);
    expect((pkg.engines as { node?: string }).node).toBe('>=20');
    expect((pkg.publishConfig as { access?: string }).access).toBe('public');
    expect(pkg.files, `${dir} needs a files whitelist`).toBeInstanceOf(Array);
    expect(pkg.keywords).toContain('wdf');
    for (const file of ['README.md', 'LICENSE', 'NOTICE']) {
      expect(existsSync(join(packagesDir, dir, file)), `${dir}/${file}`).toBe(true);
    }
    // Licenses must ship inside the tarball, not rely on npm defaults.
    expect(pkg.files).toContain('LICENSE');
    expect(pkg.files).toContain('NOTICE');
  });

  it('bins are executable scripts with a shebang', () => {
    for (const [dir, bins] of [
      ['cli', { wdf: './dist/index.js' }],
      ['mcp', { 'wdf-mcp': './dist/index.js' }],
    ] as const) {
      expect(readPkg(dir).bin).toEqual(bins);
      const src = readFileSync(join(packagesDir, dir, 'src/index.ts'), 'utf8');
      expect(src.startsWith('#!/usr/bin/env node'), `${dir} shebang`).toBe(true);
    }
  });

  // Plan §10.86: one version for the five packages, and every place that
  // reports it (CLI --version, MCP serverInfo, conversion reports) agrees, with
  // a CHANGELOG entry for it.
  it('the five packages share one version, reported everywhere', () => {
    const version = String(readPkg('cli').version);
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    for (const dir of PUBLISHED) expect(readPkg(dir).version, dir).toBe(version);
    const src = (path: string): string => readFileSync(join(packagesDir, path), 'utf8');
    expect(src('cli/src/version.ts')).toContain(`CLI_VERSION = '${version}'`);
    expect(src('import/src/version.ts')).toContain(`IMPORT_VERSION = '${version}'`);
    expect(src('mcp/src/rpc.ts')).toContain(`name: 'wdf-mcp', version: '${version}'`);
    const changelog = readFileSync(join(packagesDir, '../CHANGELOG.md'), 'utf8');
    expect(changelog).toContain(`## ${version} — `);
  });

  it('the CLI ships its runtime fonts', () => {
    expect(readPkg('cli').files).toContain('fonts');
  });
});
