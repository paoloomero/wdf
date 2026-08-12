import { getAttr, isElement, sha256Hex, type WdfElement } from '@wdf-dev/core';

/**
 * Asset import (plan §10.7, T7.3): pull the images a document references into
 * content/assets/ with deterministic, content-hashed names, so the package is
 * self-contained. Two sources: files on disk (Word's `<name>_file/` folders)
 * and, for `wdf import <url>`, remote images fetched with strict caps. Only
 * the four profile image types survive; type is decided by magic bytes, not by
 * the extension in the (untrusted) URL.
 */

export interface AssetCaps {
  /** Max bytes for a single image. */
  perFile: number;
  /** Max total bytes across all imported images. */
  totalBytes: number;
  /** Max number of images. */
  maxCount: number;
  /** Max bytes for a fetched HTML page. */
  pageBytes: number;
  /** Network timeout for a single fetch (ms). */
  timeoutMs: number;
}

export const DEFAULT_CAPS: AssetCaps = {
  perFile: 5 * 1024 * 1024,
  totalBytes: 20 * 1024 * 1024,
  maxCount: 50,
  pageBytes: 10 * 1024 * 1024,
  timeoutMs: 10_000,
};

export interface LoadedAsset {
  /** content/assets/<hash>.<ext> */
  path: string;
  mediaType: string;
  bytes: Uint8Array;
}

export type AssetLoad = { bytes: Uint8Array } | { reason: string };
export type AssetLoader = (src: string) => Promise<AssetLoad>;

/** Recognizes the four profile image types by magic bytes (spec §6.3.3). */
export function identifyImage(b: Uint8Array): { ext: string; mediaType: string } | undefined {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { ext: 'png', mediaType: 'image/png' };
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { ext: 'jpg', mediaType: 'image/jpeg' };
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return { ext: 'webp', mediaType: 'image/webp' };
  }
  const head = new TextDecoder('latin1').decode(b.subarray(0, 300)).replace(/^﻿/, '').trimStart();
  if (/^(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)?<svg[\s>]/i.test(head)) {
    return { ext: 'svg', mediaType: 'image/svg+xml' };
  }
  return undefined;
}

/**
 * Fetches images referenced by a page (http/https only, no credentials,
 * redirects followed, timeout, per-file cap). SSRF note: this is a local CLI;
 * if the importer ever becomes a server-side service, private-network address
 * filtering must be added here.
 */
export function urlAssetLoader(baseUrl: string, caps: AssetCaps): AssetLoader {
  return async (src) => {
    let url: URL;
    try {
      url = new URL(src, baseUrl);
    } catch {
      return { reason: 'invalid URL' };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { reason: `scheme ${url.protocol} not allowed` };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, caps.timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
      if (!res.ok) return { reason: `HTTP ${String(res.status)}` };
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > caps.perFile) return { reason: 'exceeds per-file size limit' };
      return { bytes };
    } catch (e) {
      return { reason: String(e) };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Fetches the entry page for `wdf import <url>`, returning bytes + final URL. */
export async function fetchPage(
  url: string,
  caps: AssetCaps,
): Promise<{ bytes: Uint8Array; baseUrl: string }> {
  const target = new URL(url);
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error(`scheme ${target.protocol} not allowed`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, caps.timeoutMs);
  try {
    const res = await fetch(target, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > caps.pageBytes) throw new Error('page exceeds size limit');
    return { bytes, baseUrl: res.url === '' ? url : res.url };
  } finally {
    clearTimeout(timer);
  }
}

const PACKAGED_SRC = /^content\/assets(\/[A-Za-z0-9][A-Za-z0-9._-]*)+$/;

function collectImgSrcs(root: WdfElement): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const walk = (el: WdfElement): void => {
    for (const child of el.children) {
      if (!isElement(child)) continue;
      // <img> plus Word's VML <v:imagedata> carrier (full "Web Page" export).
      if (child.tag === 'img' || child.tag === 'v:imagedata') {
        const src = getAttr(child, 'src');
        if (src !== undefined && src !== '' && !seen.has(src)) {
          seen.add(src);
          order.push(src);
        }
      }
      walk(child);
    }
  };
  walk(root);
  return order;
}

/**
 * Resolves every referenced image through `loader`, applying the caps and
 * de-duplicating by content hash. Returns a map from original src to the
 * package path plus the assets to include; every decision is reported.
 */
export async function resolveDocumentAssets(
  root: WdfElement,
  loader: AssetLoader,
  caps: AssetCaps,
  report: string[],
): Promise<{ map: Map<string, string>; assets: LoadedAsset[] }> {
  const map = new Map<string, string>();
  const assets = new Map<string, LoadedAsset>();
  let total = 0;

  for (const src of collectImgSrcs(root)) {
    if (PACKAGED_SRC.test(src)) continue;
    if (src.startsWith('data:')) {
      report.push(`dropped inline data: image`);
      continue;
    }
    if (assets.size >= caps.maxCount) {
      report.push(`dropped image "${src}" (max ${String(caps.maxCount)} images reached)`);
      continue;
    }
    const load = await loader(src);
    if ('reason' in load) {
      report.push(`dropped image "${src}" (${load.reason})`);
      continue;
    }
    const kind = identifyImage(load.bytes);
    if (kind === undefined) {
      report.push(`dropped image "${src}" (not a supported image type)`);
      continue;
    }
    const path = `content/assets/${(await sha256Hex(load.bytes)).slice(0, 16)}.${kind.ext}`;
    if (!assets.has(path)) {
      if (total + load.bytes.length > caps.totalBytes) {
        report.push(`dropped image "${src}" (total asset size limit reached)`);
        continue;
      }
      assets.set(path, { path, mediaType: kind.mediaType, bytes: load.bytes });
      total += load.bytes.length;
    }
    map.set(src, path);
    report.push(`imported image "${src}" → ${path}`);
  }

  return { map, assets: [...assets.values()] };
}
