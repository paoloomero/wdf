// Background service worker (MV3). T18.2: the conversion stage answers a
// capture with an observable diagnostic (.capture.json); @wdf/import takes
// this seat in T18.4.
import { buildDiagnostic } from './diagnostic.js';
import {
  bytesToBase64,
  downloadFilename,
  type CaptureRequest,
  type DownloadReply,
} from './protocol.js';

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

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse: (reply: DownloadReply) => void) => {
    const request = message as Partial<CaptureRequest>;
    if (request.type !== 'wdf-capture') return false;
    const diagnostic = buildDiagnostic(request as CaptureRequest);
    const json = `${JSON.stringify(diagnostic, null, 2)}\n`;
    sendResponse({
      type: 'wdf-download',
      filename: downloadFilename(request.snapshot?.title ?? '', 'capture.json'),
      mediaType: 'application/json',
      base64: bytesToBase64(new TextEncoder().encode(json)),
    });
    return false;
  },
);
