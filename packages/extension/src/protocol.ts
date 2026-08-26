// The content-script ↔ background message protocol (WP18, plan §10.31).
// chrome.runtime messaging is JSON-only, so binary payloads travel as
// base64 — the declared fallback if this proves too slow on real pages is
// converting in the content script (§10.31 "Architettura").

import type { CaptureGeometry, CapturedImage, CapturedStylesheet, DomSnapshot } from './capture.js';

/** Provenance of the capture — the future ext/capture/capture.json fields
 *  (docs/ext-capture.md §4); `mode` is decided at conversion (T18.4/T18.5). */
export interface CaptureProvenance {
  url: string;
  capturedAt: string;
  userAgent: string;
  viewport: { width: number; height: number; devicePixelRatio: number };
}

/** chrome.storage.local key of the one-time privacy notice (§10.31). */
export const PRIVACY_ACK_KEY = 'privacyNoticeAcknowledged';

/** What the user asked for in the popup (T18.5, §10.31 "UX"). */
export interface CaptureOptions {
  /** Extracted article (default) or the whole page. */
  mode: 'article' | 'full-page';
  /** Standalone .wdf.html (the sendable default, §10.38) or raw .wdf. */
  output: 'standalone' | 'wdf';
  /** Site-aware capture (T18.9): use the site's official export. */
  site?: 'gdocs';
}

export const DEFAULT_OPTIONS: CaptureOptions = { mode: 'article', output: 'standalone' };

/** Popup → background: start a capture of the given tab. */
export interface StartRequest {
  type: 'wdf-start';
  tabId: number;
  options: CaptureOptions;
}

/** Background → popup: outcome of a conversion (fire-and-forget). */
export interface StatusMessage {
  type: 'wdf-status';
  tabId: number;
  ok: boolean;
  /** Aggregated conversion report (ok) or the error message (not ok). */
  lines: string[];
}

/** Sent by the injected content script after capturing the page. */
export interface CaptureRequest {
  type: 'wdf-capture';
  provenance: CaptureProvenance;
  snapshot: DomSnapshot;
  stylesheets: CapturedStylesheet[];
  images: CapturedImage[];
  geometry: CaptureGeometry;
  report: string[];
}

/** Sent by the Google Docs content script: the official export, fetched
 *  with the user's session (T18.9, plan §10.43). */
export interface GdocsCaptureRequest {
  type: 'wdf-capture-gdocs';
  /** The export?format=zip bytes (HTML + images). */
  zipBase64: string;
  provenance: CaptureProvenance;
}

/** Background's reply: the bytes the content script downloads in-page. */
export interface DownloadReply {
  type: 'wdf-download';
  filename: string;
  mediaType: string;
  base64: string;
  /** Aggregated conversion report — surfaced by the popup UX (T18.5). */
  report: string[];
}

/** Background's reply when the conversion could not produce a document. */
export interface ErrorReply {
  type: 'wdf-error';
  message: string;
}

/**
 * Background's ack when it saved the file itself via chrome.downloads
 * (0.1.1): the content script has nothing to do. The in-page anchor stays
 * as the fallback — some sites (e.g. CSP `sandbox` without
 * `allow-downloads`) forbid downloads initiated inside the page, which is
 * why the downloads API is the primary path.
 */
export interface SavedReply {
  type: 'wdf-saved';
}

export type ConvertReply = DownloadReply | ErrorReply | SavedReply;

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * A download file name derived from the page title: printable characters
 * only, no path separators or characters that filesystems or the download
 * UI mangle, length-capped, never empty.
 */
export function downloadFilename(title: string, extension: string): string {
  const cleaned = title
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim();
  return `${cleaned === '' ? 'capture' : cleaned}.${extension}`;
}
