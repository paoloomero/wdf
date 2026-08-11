// Content script for Google Docs pages (T18.9), injected instead of the
// DOM-snapshot capture: the Docs editor renders on canvas, so the honest
// source is the official export, fetched same-origin WITH the user's
// session. The document produced from it declares `source.kind:
// "fetched-html"` — these are server-delivered bytes, not a snapshot.
import { ext } from './compat.js';
import { deliverReply } from './download.js';
import { exportUrlFromLocation } from './gdocs.js';
import { bytesToBase64, type GdocsCaptureRequest } from './protocol.js';

void (async () => {
  const exportUrl = exportUrlFromLocation(location.origin, location.pathname);
  if (exportUrl === undefined) {
    alert('WDF — this does not look like a Google Docs document page');
    return;
  }
  let zip: Uint8Array;
  try {
    const resp = await fetch(exportUrl);
    if (!resp.ok) throw new Error(`HTTP ${String(resp.status)}`);
    zip = new Uint8Array(await resp.arrayBuffer());
  } catch (e) {
    alert(`WDF — Google Docs export failed (${String(e)})`);
    return;
  }
  const request: GdocsCaptureRequest = {
    type: 'wdf-capture-gdocs',
    zipBase64: bytesToBase64(zip),
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
  };
  deliverReply(await ext.runtime.sendMessage(request));
})();
