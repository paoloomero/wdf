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
  DEFAULT_OPTIONS,
  downloadFilename,
  type CaptureOptions,
  type CaptureRequest,
  type ConvertReply,
  type GdocsCaptureRequest,
  type StartRequest,
  type StatusMessage,
} from './protocol.js';
import { fillStandalone } from './standalone.js';
import { ext } from './compat.js';
import { prepareGdocsExport } from './gdocs.js';

const enc = new TextEncoder();

// Options chosen in the popup, keyed by tab: set by wdf-start, consumed
// when that tab's content script delivers its capture payload.
const pendingOptions = new Map<number, CaptureOptions>();

/** Injects the right content script into the given tab (activeTab grant):
 *  the DOM capture, or the Google Docs export path (T18.9). */
async function startCapture(
  tabId: number | undefined,
  options: CaptureOptions = DEFAULT_OPTIONS,
): Promise<void> {
  if (tabId === undefined) return;
  pendingOptions.set(tabId, options);
  const file = options.site === 'gdocs' ? 'content-gdocs.js' : 'content.js';
  await ext.scripting.executeScript({ target: { tabId }, files: [file] });
}

// The toolbar action opens the popup (T18.5); automation cannot click
// either, so the e2e smoke test (e2e/capture.mjs) triggers the same entry
// point the popup uses through this hook.
(globalThis as Record<string, unknown>)['wdfStartCapture'] = startCapture;

/** Best-effort status broadcast to the popup (it may be closed). */
function notify(tabId: number, ok: boolean, lines: string[]): void {
  const status: StatusMessage = { type: 'wdf-status', tabId, ok, lines };
  ext.runtime.sendMessage(status).catch(() => undefined);
}

async function convertCapture(
  request: CaptureRequest,
  options: CaptureOptions,
): Promise<ConvertReply> {
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
    mode: options.mode,
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
      fullPage: options.mode === 'full-page',
      // Provenance over wall clock: the manifest dates the capture instant.
      date: request.provenance.capturedAt,
    },
    report,
  );
  if (result === undefined) {
    return { type: 'wdf-error', message: 'no representable content found on this page' };
  }
  return buildReply(result, options, report);
}

/** The download reply for a converted document: raw .wdf, or the
 *  double-suffixed standalone (§10.38) as the sendable default. */
function buildReply(
  result: { wdfBytes: Uint8Array; title: string },
  options: CaptureOptions,
  report: string[],
): ConvertReply {
  if (options.output === 'wdf') {
    return {
      type: 'wdf-download',
      filename: downloadFilename(result.title, 'wdf'),
      mediaType: 'application/wdf+zip',
      base64: bytesToBase64(result.wdfBytes),
      report: aggregateReport(report),
    };
  }
  const standalone = fillStandalone(
    standaloneTemplate,
    result.title,
    bytesToBase64(result.wdfBytes),
  );
  return {
    type: 'wdf-download',
    filename: downloadFilename(result.title, 'wdf.html'),
    mediaType: 'text/html',
    base64: bytesToBase64(enc.encode(standalone)),
    report: aggregateReport(report),
  };
}

/** T18.9: converts the official Google Docs export (plan §10.43). The
 *  export is server-delivered bytes — the source stays `fetched-html`,
 *  and the whole document is converted (no article landmark to find). */
async function convertGdocs(
  request: GdocsCaptureRequest,
  options: CaptureOptions,
): Promise<ConvertReply> {
  const report: string[] = [
    'Google Docs detected — converted from the official web-page export (session-authenticated)',
  ];
  const exported = prepareGdocsExport(base64ToBytes(request.zipBase64));
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
    mode: 'full-page',
  };
  const result = await importDocument(
    {
      kind: 'html',
      text: exported.html,
      baseName: exported.htmlName.replace(/\.html$/i, ''),
      sourceBytes: exported.htmlBytes,
      sourceName: request.provenance.url,
      sourceEncoding: 'utf-8',
    },
    {
      capture,
      withSource: true,
      loadAsset: (src) => {
        const bytes = exported.files.get(src) ?? exported.files.get(decodeURIComponent(src));
        return Promise.resolve(
          bytes === undefined ? { reason: 'not present in the export zip' } : { bytes },
        );
      },
      fullPage: true,
      date: request.provenance.capturedAt,
    },
    report,
  );
  if (result === undefined) {
    return { type: 'wdf-error', message: 'the Google Docs export produced no content' };
  }
  return buildReply(result, options, report);
}

ext.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse: (reply: ConvertReply) => void) => {
    const typed = message as { type?: string; tabId?: number; options?: StartRequest['options'] };
    if (typed.type === 'wdf-start') {
      void startCapture(typed.tabId, typed.options);
      return false;
    }
    if (typed.type !== 'wdf-capture' && typed.type !== 'wdf-capture-gdocs') return false;
    const tabId = sender.tab?.id ?? -1;
    const options = pendingOptions.get(tabId) ?? DEFAULT_OPTIONS;
    pendingOptions.delete(tabId);
    (typed.type === 'wdf-capture-gdocs'
      ? convertGdocs(message as GdocsCaptureRequest, options)
      : convertCapture(message as CaptureRequest, options)
    )
      .then((reply) => {
        sendResponse(reply);
        if (reply.type === 'wdf-download') notify(tabId, true, reply.report);
        else notify(tabId, false, [reply.message]);
      })
      .catch((e: unknown) => {
        sendResponse({ type: 'wdf-error', message: `conversion failed: ${String(e)}` });
        notify(tabId, false, [`conversion failed: ${String(e)}`]);
      });
    return true; // async sendResponse: keep the channel open
  },
);
