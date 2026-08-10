// Background service worker (MV3). T18.1: the conversion stage is a plain
// text receipt proving the pipe; @wdf/import takes its place in T18.4.
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
// (e2e/smoke.mjs) triggers the same entry point through this hook.
(globalThis as Record<string, unknown>)['wdfStartCapture'] = startCapture;

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse: (reply: DownloadReply) => void) => {
    const request = message as Partial<CaptureRequest>;
    if (request.type !== 'wdf-capture') return false;
    const text = `WDF capture pipe check\ntitle: ${request.title ?? ''}\nurl: ${request.url ?? ''}\n`;
    sendResponse({
      type: 'wdf-download',
      filename: downloadFilename(request.title ?? '', 'txt'),
      mediaType: 'text/plain',
      base64: bytesToBase64(new TextEncoder().encode(text)),
    });
    return false;
  },
);
