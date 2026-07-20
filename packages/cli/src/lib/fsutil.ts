import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Reads a source directory into a package-path map (posix separators).
 * Dotfiles and dot-directories are skipped.
 */
export function readDirFiles(dir: string, prefix = ''): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    const path = prefix === '' ? name : `${prefix}/${name}`;
    if (statSync(full).isDirectory()) {
      for (const [p, data] of readDirFiles(full, path)) files.set(p, data);
    } else {
      files.set(path, readFileSync(full));
    }
  }
  return files;
}

export function writeDirFiles(dir: string, files: ReadonlyMap<string, Uint8Array>): void {
  for (const [path, data] of files) {
    const full = join(dir, ...path.split('/'));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
  }
}
