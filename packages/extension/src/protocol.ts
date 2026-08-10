// The content-script ↔ background message protocol (WP18, plan §10.31).
// chrome.runtime messaging is JSON-only, so binary payloads travel as
// base64 — the declared fallback if this proves too slow on real pages is
// converting in the content script (§10.31 "Architettura").

/** Sent by the injected content script after capturing the page. */
export interface CaptureRequest {
  type: 'wdf-capture';
  title: string;
  url: string;
}

/** Background's reply: the bytes the content script downloads in-page. */
export interface DownloadReply {
  type: 'wdf-download';
  filename: string;
  mediaType: string;
  base64: string;
}

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
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim();
  return `${cleaned === '' ? 'capture' : cleaned}.${extension}`;
}
