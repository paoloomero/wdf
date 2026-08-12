import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import {
  readPackage,
  validateCaptureExt,
  validateDatasets,
  validateProfile,
  validateStylesheet,
  verifyPackage,
  WdfError,
  type Violation,
  type WdfManifest,
} from '@wdf-dev/core';

import {
  aggregateReport,
  buildPackage,
  decodeHtml,
  DEFAULT_CAPS,
  fetchPage,
  importDocument,
  urlAssetLoader,
  type AssetLoader,
  type CssFetcher,
  type ImportInput,
} from '@wdf-dev/import';

import { hasViewerTemplate, makeStandalone } from './lib/build.js';
import { readDirFiles, writeDirFiles } from './lib/fsutil.js';
import { fsFontReader, localAssetLoader } from './lib/loaders.js';

/** Output sinks, injectable for tests. `out` is raw stdout (no newline added). */
export interface Ctx {
  log(s: string): void;
  err(s: string): void;
  out(s: string): void;
}

export const defaultCtx: Ctx = {
  log: (s) => {
    console.log(s);
  },
  err: (s) => {
    console.error(s);
  },
  out: (s) => {
    process.stdout.write(s);
  },
};

const dec = new TextDecoder('utf-8', { fatal: true });

function formatViolation(v: Violation): string {
  return `  [${v.spec}] ${v.severity === 'warning' ? 'warning: ' : ''}${v.path} — ${v.message}`;
}

/** Exit codes (plan T3.1): 0 valid, 1 invalid, 2 operational error. */
export async function cmdValidate(
  file: string,
  opts: { json?: boolean } = {},
  ctx: Ctx = defaultCtx,
): Promise<number> {
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(file);
  } catch (e) {
    ctx.err(`error: cannot read ${file} (${String(e)})`);
    return 2;
  }

  let violations: Violation[] = [];
  let integrity = false;
  let determinism = false;
  try {
    const pkg = readPackage(bytes);
    const entry = dec.decode(pkg.files.get(pkg.manifest.entry) ?? new Uint8Array());
    violations.push(...validateProfile(entry));
    const styles = pkg.files.get('content/styles.css');
    if (styles !== undefined) violations.push(...validateStylesheet(dec.decode(styles)));
    violations.push(...validateDatasets(pkg));
    violations.push(...validateCaptureExt(pkg));
    const verify = await verifyPackage(pkg);
    integrity = verify.integrity;
    determinism = verify.determinism;
    violations.push(...verify.problems);
  } catch (e) {
    if (e instanceof WdfError) {
      violations = [
        { spec: e.spec, path: e.path ?? '(package)', message: e.message, severity: 'error' },
      ];
    } else {
      ctx.err(`error: ${String(e)}`);
      return 2;
    }
  }

  const errors = violations.filter((v) => v.severity === 'error');
  const warnings = violations.filter((v) => v.severity === 'warning');
  const valid = errors.length === 0 && integrity && determinism;

  if (opts.json === true) {
    ctx.log(JSON.stringify({ valid, integrity, determinism, violations }, null, 2));
  } else {
    for (const v of violations) ctx.log(formatViolation(v));
    ctx.log(
      `${valid ? 'VALID' : 'INVALID'}: ${String(errors.length)} error(s), ${String(warnings.length)} warning(s); integrity ${integrity ? 'ok' : 'FAILED'}, determinism ${determinism ? 'ok' : 'FAILED'}`,
    );
  }
  return valid ? 0 : 1;
}

export async function cmdPack(
  dir: string,
  opts: { output?: string; standalone?: boolean } = {},
  ctx: Ctx = defaultCtx,
): Promise<number> {
  try {
    const source = readDirFiles(dir);
    const bytes = await buildPackage(source);
    const base = basename(dir.replace(/\/+$/, ''));
    if (opts.standalone === true) {
      const manifest = JSON.parse(
        dec.decode(source.get('manifest.json') ?? new Uint8Array()),
      ) as WdfManifest;
      const output = opts.output ?? `${base}.html`;
      writeFileSync(output, makeStandalone(bytes, manifest.title));
      ctx.log(`wrote ${output} (standalone, ${String(bytes.length)} bytes embedded)`);
      if (!hasViewerTemplate()) {
        ctx.log('note: @wdf-dev/viewer is not built — used the minimal fallback shell');
      }
    } else {
      const output = opts.output ?? `${base}.wdf`;
      writeFileSync(output, bytes);
      ctx.log(`wrote ${output} (${String(bytes.length)} bytes)`);
    }
    return 0;
  } catch (e) {
    if (e instanceof WdfError) {
      ctx.err(`invalid package source: ${e.message}`);
      return 1;
    }
    ctx.err(`error: ${String(e)}`);
    return 2;
  }
}

export function cmdUnpack(file: string, dir: string | undefined, ctx: Ctx = defaultCtx): number {
  try {
    const pkg = readPackage(readFileSync(file));
    const target = dir ?? basename(file).replace(/\.wdf$/, '');
    if (existsSync(target) && readdirSync(target).length > 0) {
      ctx.err(`error: ${target} exists and is not empty`);
      return 2;
    }
    writeDirFiles(target, pkg.files);
    ctx.log(`unpacked ${String(pkg.files.size)} files to ${target}/`);
    return 0;
  } catch (e) {
    if (e instanceof WdfError) {
      ctx.err(`invalid package: ${e.message}`);
      return 1;
    }
    ctx.err(`error: ${String(e)}`);
    return 2;
  }
}

export function cmdExtract(
  file: string,
  opts: { outline?: boolean } = {},
  ctx: Ctx = defaultCtx,
): number {
  try {
    const pkg = readPackage(readFileSync(file));
    const path = opts.outline === true ? 'ai/outline.json' : 'ai/content.md';
    ctx.out(dec.decode(pkg.files.get(path) ?? new Uint8Array()));
    return 0;
  } catch (e) {
    if (e instanceof WdfError) {
      ctx.err(`invalid package: ${e.message}`);
      return 1;
    }
    ctx.err(`error: ${String(e)}`);
    return 2;
  }
}

function urlBaseName(url: string): string {
  try {
    const last = new URL(url).pathname
      .split('/')
      .filter((s) => s !== '')
      .pop();
    return last === undefined ? 'imported' : last.replace(/\.[^.]+$/, '') || 'imported';
  } catch {
    return 'imported';
  }
}

export async function cmdImport(
  input: string,
  opts: {
    output?: string;
    title?: string;
    lang?: string;
    date?: string;
    withSource?: boolean;
    embedFonts?: boolean;
    fetchRemote?: boolean;
    fullPage?: boolean;
    standalone?: boolean;
  } = {},
  ctx: Ctx = defaultCtx,
): Promise<number> {
  const isUrl = /^https?:\/\//i.test(input);
  const isMarkdown = !isUrl && /\.(md|markdown)$/i.test(input);
  const report: string[] = [];

  let text: string;
  let loader: AssetLoader | undefined;
  let baseName: string;
  // Word support folder access for page headers/footers (T14.1, local only).
  let loadSibling: ((relPath: string) => Promise<Uint8Array | undefined>) | undefined;
  // External stylesheets for the source extension (WP15). Network policy:
  // inherent for URL imports; opt-in (--fetch-remote) for local files.
  let fetchCss: CssFetcher | undefined;
  const asBytes = async (load: Promise<ReturnType<AssetLoader>> | ReturnType<AssetLoader>) => {
    const result = await load;
    return 'bytes' in result ? result.bytes : undefined;
  };
  const remoteUrl = (href: string): string | undefined => {
    if (/^https?:\/\//i.test(href)) return href;
    if (href.startsWith('//')) return `https:${href}`;
    return undefined;
  };
  // Original input, kept byte-for-byte for the `source` extension (WP13).
  let sourceBytes: Uint8Array | undefined;
  let sourceName = '';
  let sourceEncoding = 'utf-8';
  if (isUrl) {
    try {
      const page = await fetchPage(input, DEFAULT_CAPS);
      const decoded = decodeHtml(page.bytes);
      text = decoded.text;
      if (decoded.encoding !== 'utf-8') report.push(`decoded page as ${decoded.encoding}`);
      loader = urlAssetLoader(page.baseUrl, DEFAULT_CAPS);
      baseName = urlBaseName(input);
      sourceBytes = page.bytes;
      sourceName = input;
      sourceEncoding = decoded.encoding;
      const cssLoader = urlAssetLoader(page.baseUrl, DEFAULT_CAPS);
      fetchCss = (href) => asBytes(cssLoader(href));
    } catch (e) {
      ctx.err(`error: cannot fetch ${input} (${String(e)})`);
      return 2;
    }
  } else {
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(input);
    } catch (e) {
      ctx.err(`error: cannot read ${input} (${String(e)})`);
      return 2;
    }
    sourceBytes = bytes;
    sourceName = basename(input);
    if (isMarkdown) {
      text = dec.decode(bytes);
    } else {
      const decoded = decodeHtml(bytes);
      text = decoded.text;
      if (decoded.encoding !== 'utf-8') {
        report.push(`decoded source as ${decoded.encoding} (declared or detected)`);
      }
      sourceEncoding = decoded.encoding;
      loader = localAssetLoader(dirname(input), DEFAULT_CAPS);
      loadSibling = (relPath) => {
        try {
          return Promise.resolve<Uint8Array | undefined>(
            readFileSync(join(dirname(input), decodeURIComponent(relPath))),
          );
        } catch {
          return Promise.resolve(undefined);
        }
      };
      // WP15: remote references in a saved page resolve only with the
      // explicit opt-in — a local import must not surprise with network.
      const remote = urlAssetLoader('https://invalid.localhost/', DEFAULT_CAPS);
      if (opts.fetchRemote === true) {
        const local = loader;
        loader = (src) => {
          const url = remoteUrl(src);
          return url === undefined ? local(src) : remote(url);
        };
      }
      const sibling = loadSibling;
      fetchCss = async (href) => {
        const url = remoteUrl(href);
        if (url !== undefined) {
          return opts.fetchRemote === true ? asBytes(remote(url)) : undefined;
        }
        return sibling(href);
      };
    }
    baseName = basename(input).replace(/\.[^.]+$/, '');
  }

  // The pipeline itself is the shared isomorphic path (T7.5): the CLI only
  // resolves the input and supplies the filesystem/network loaders.
  const docInput: ImportInput = {
    kind: isMarkdown ? 'markdown' : 'html',
    text,
    baseName,
    sourceName,
    sourceEncoding,
  };
  if (sourceBytes !== undefined) docInput.sourceBytes = sourceBytes;

  const importOpts: Parameters<typeof importDocument>[1] = { readFont: fsFontReader };
  if (opts.title !== undefined) importOpts.title = opts.title;
  if (opts.lang !== undefined) importOpts.lang = opts.lang;
  if (opts.date !== undefined) importOpts.date = opts.date;
  if (opts.withSource === true) importOpts.withSource = true;
  if (opts.embedFonts === true) importOpts.embedFonts = true;
  if (opts.fullPage === true) importOpts.fullPage = true;
  if (loader !== undefined) importOpts.loadAsset = loader;
  if (loadSibling !== undefined) importOpts.loadSibling = loadSibling;
  if (fetchCss !== undefined) importOpts.fetchCss = fetchCss;

  try {
    const result = await importDocument(docInput, importOpts, report);
    if (result === undefined) {
      ctx.err('error: no representable content found in the input');
      return 1;
    }
    const output = opts.output ?? `${baseName}.wdf`;
    writeFileSync(output, result.wdfBytes);
    for (const line of aggregateReport(report)) ctx.log(`note: ${line}`);
    ctx.log(`wrote ${output} (${String(result.wdfBytes.length)} bytes)`);

    // T15.1 (plan §10.28): the sendable artifact in one step — the standalone
    // distribution file (spec §9) next to the package.
    if (opts.standalone === true) {
      const html = makeStandalone(result.wdfBytes, result.title);
      const htmlPath = output.replace(/\.wdf$/i, '') + '.html';
      writeFileSync(htmlPath, html);
      ctx.log(`wrote ${htmlPath} (standalone, ${String(result.wdfBytes.length)} bytes embedded)`);
    }

    const check = validateProfile(result.html).filter((v) => v.severity === 'error');
    if (check.length > 0) {
      for (const v of check) ctx.log(formatViolation(v));
      ctx.err(`import produced ${String(check.length)} profile error(s) — package written anyway`);
      return 1;
    }
    return 0;
  } catch (e) {
    ctx.err(`error: ${String(e)}`);
    return 2;
  }
}

const NEW_INDEX = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>New WDF document</title>
  </head>
  <body>
    <article>
      <section id="sec-start">
        <h1 id="h-start">New WDF document</h1>
        <p id="p-0001">Edit <em>content/index.html</em>, then run <code>wdf pack</code>.</p>
      </section>
    </article>
  </body>
</html>
`;

export function cmdNew(dir: string, ctx: Ctx = defaultCtx): number {
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    ctx.err(`error: ${dir} exists and is not empty`);
    return 2;
  }
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const manifest: WdfManifest = {
    wdf: '0.1',
    id: `urn:uuid:${globalThis.crypto.randomUUID()}`,
    title: 'New WDF document',
    language: 'en',
    created: now,
    modified: now,
    entry: 'content/index.html',
  };
  mkdirSync(join(dir, 'content'), { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(dir, 'content', 'index.html'), NEW_INDEX);
  ctx.log(`created ${dir}/ — edit content/index.html, then: wdf pack ${dir}`);
  return 0;
}
