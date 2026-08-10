// Background service worker (MV3). T18.4: the real conversion — the
// bundled @wdf/import pipeline turns the capture payload into a verified
// package, downloaded as a standalone HTML (the T15.1 sendable default;
// the .wdf option arrives with the popup UX, T18.5). Fully client-side:
// the pipeline uses parse5, no DOM needed (§10.31 "Architettura").
import type { WdfCapture } from '@wdf/core';
import {
  aggregateReport,
  geometryExclusions,
  importDocument,
  stripCaptureMarks,
  type AssetLoad,
  type CssFetcher,
} from '@wdf/import';
import standaloneTemplate from '@wdf/viewer/standalone.html';

import {
  base64ToBytes,
  bytesToBase64,
  downloadFilename,
  type CaptureRequest,
  type ConvertReply,
} from './protocol.js';
import { fillStandalone } from './standalone.js';

const enc = new TextEncoder();

/** Injects the content script into the clicked tab (activeTab grant). */
async function startCapture(tabId: number | undefined): Promise<void> {
  if (tabId === undefined) return;
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

chrome.action.onClicked.addListener((tab) => {
  void startCapture(tab.id);
});

// The toolbar action cannot be clicked by automation: the e2e smoke test
// (e2e/capture.mjs) triggers the same entry point through this hook.
(globalThis as Record<string, unknown>)['wdfStartCapture'] = startCapture;

async function convertCapture(request: CaptureRequest): Promise<ConvertReply> {
  const report = [...request.report];
  const baseUrl = request.snapshot.baseUrl;
  const resolve = (url: string): string => {
    try {
      return new URL(url, baseUrl).href;
    } catch {
      return url;
    }
  };

  // Everything the pipeline may reach comes from the capture payload —
  // zero network in the background, by construction.
  const images = new Map(request.images.map((i) => [i.url, base64ToBytes(i.base64)]));
  const loadAsset = (src: string): Promise<AssetLoad> => {
    const bytes = images.get(resolve(src)) ?? images.get(src);
    return Promise.resolve(
      bytes === undefined ? { reason: 'not captured from the live page' } : { bytes },
    );
  };
  const sheets = new Map(request.stylesheets.map((s) => [s.href, s.css]));
  const fetchCss: CssFetcher = (href) => {
    const css = sheets.get(resolve(href)) ?? sheets.get(href);
    return Promise.resolve(css === undefined ? undefined : enc.encode(css));
  };

  const capture: WdfCapture = {
    capture: '0.1',
    url: request.provenance.url,
    capturedAt: request.provenance.capturedAt,
    userAgent: request.provenance.userAgent,
    viewport: {
      width: request.provenance.viewport.width,
      height: request.provenance.viewport.height,
      devicePixelRatio: request.provenance.viewport.devicePixelRatio,
    },
    // The popup UX (T18.5) adds the full-page choice; article is the
    // ratified default (§10.31 "UX").
    mode: 'article',
  };

  const result = await importDocument(
    {
      kind: 'html',
      text: request.snapshot.html,
      baseName: request.snapshot.title !== '' ? request.snapshot.title : new URL(baseUrl).host,
      // The embedded original is the marker-free snapshot, declared as a
      // dom-snapshot (docs/ext-source.md v0.3).
      sourceBytes: enc.encode(stripCaptureMarks(request.snapshot.html)),
      sourceName: request.provenance.url,
      sourceEncoding: 'utf-8',
      sourceKind: 'dom-snapshot',
    },
    {
      captureExclusions: new Set(geometryExclusions(request.geometry).map((e) => e.id)),
      captureEmbeds: { baseUrl, hasPoster: (url) => images.has(url) },
      capture,
      withSource: true,
      loadAsset,
      fetchCss,
      // Provenance over wall clock: the manifest dates the capture instant.
      date: request.provenance.capturedAt,
    },
    report,
  );
  if (result === undefined) {
    return { type: 'wdf-error', message: 'no representable content found on this page' };
  }

  const standalone = fillStandalone(
    standaloneTemplate,
    result.title,
    bytesToBase64(result.wdfBytes),
  );
  return {
    type: 'wdf-download',
    filename: downloadFilename(result.title, 'html'),
    mediaType: 'text/html',
    base64: bytesToBase64(enc.encode(standalone)),
    report: aggregateReport(report),
  };
}

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse: (reply: ConvertReply) => void) => {
    const request = message as Partial<CaptureRequest>;
    if (request.type !== 'wdf-capture') return false;
    convertCapture(request as CaptureRequest)
      .then(sendResponse)
      .catch((e: unknown) => {
        sendResponse({ type: 'wdf-error', message: `conversion failed: ${String(e)}` });
      });
    return true; // async sendResponse: keep the channel open
  },
);
