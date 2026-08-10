// Content script, injected on the user's click (activeTab — never declared
// statically in the manifest). T18.1: capture document.title, ship it to
// the background, download the returned bytes via an in-page anchor — no
// "downloads" permission needed, the pipe stays activeTab + scripting.
import { base64ToBytes, type CaptureRequest, type DownloadReply } from './protocol.js';

(() => {
  const request: CaptureRequest = {
    type: 'wdf-capture',
    title: document.title,
    url: location.href,
  };
  void chrome.runtime.sendMessage(request).then((reply: unknown) => {
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
  });
})();
