// In-page delivery of the background's reply, shared by both content
// scripts: anchor download (no "downloads" permission) or the interim
// error surface.
import { base64ToBytes, type ConvertReply } from './protocol.js';

export function deliverReply(reply: unknown): void {
  const r = reply as Partial<ConvertReply> & {
    message?: string;
    base64?: string;
    filename?: string;
    mediaType?: string;
  };
  if (r.type === 'wdf-error') {
    console.error(`WDF: ${r.message ?? 'conversion failed'}`);
    alert(`WDF — ${r.message ?? 'conversion failed'}`);
    return;
  }
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
}
