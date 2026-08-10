// Content script, injected on the user's click (activeTab — never declared
// statically in the manifest). T18.2: capture the rendered page — DOM
// snapshot + geometry, original stylesheets, image bytes — and ship it to
// the background; download the returned bytes via an in-page anchor (no
// "downloads" permission, the pipe stays activeTab + scripting).
import {
  canvasEncoder,
  CAPTURE_CAPS,
  collectImages,
  collectStylesheets,
  measureElement,
  snapshotAndMeasure,
  type SheetLike,
} from './capture.js';
import {
  base64ToBytes,
  bytesToBase64,
  type CaptureRequest,
  type DownloadReply,
} from './protocol.js';

async function capturePage(): Promise<CaptureRequest> {
  const report: string[] = [];

  const { snapshot, elements } = snapshotAndMeasure(document, (el) => measureElement(el, window));

  const iframes = document.querySelectorAll('iframe').length;
  if (iframes > 0) {
    report.push(
      `${String(iframes)} iframe(s) on the page — embedded content becomes a placeholder with a link at conversion (ext-capture §5)`,
    );
  }
  let shadow = 0;
  for (const el of document.querySelectorAll('*')) if (el.shadowRoot !== null) shadow++;
  if (shadow > 0) {
    report.push(`${String(shadow)} shadow root(s) not serialized in the snapshot`);
  }

  const fetchText = async (url: string): Promise<string> => {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${String(resp.status)}`);
    return resp.text();
  };
  const stylesheets = await collectStylesheets(
    Array.from(document.styleSheets) as SheetLike[],
    Array.from(document.adoptedStyleSheets ?? []) as SheetLike[],
    fetchText,
    report,
  );

  const fetchBytes = async (url: string): Promise<{ base64: string; mediaType: string }> => {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${String(resp.status)}`);
    const blob = await resp.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return { base64: bytesToBase64(bytes), mediaType: blob.type };
  };
  const images = await collectImages(
    Array.from(document.images),
    canvasEncoder(document),
    fetchBytes,
    CAPTURE_CAPS,
    report,
  );

  return {
    type: 'wdf-capture',
    provenance: {
      url: location.href,
      capturedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      userAgent: navigator.userAgent,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      },
    },
    snapshot,
    stylesheets,
    images,
    geometry: {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      },
      document: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
      elements,
    },
    report,
  };
}

void (async () => {
  const request = await capturePage();
  const reply: unknown = await chrome.runtime.sendMessage(request);
  const r = reply as Partial<DownloadReply>;
  if (r.type !== 'wdf-download' || typeof r.base64 !== 'string' || typeof r.filename !== 'string')
    return;
  const blob = new Blob([base64ToBytes(r.base64) as BlobPart], {
    type: r.mediaType ?? 'application/octet-stream',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = r.filename;
  a.rel = 'noopener';
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
})();
