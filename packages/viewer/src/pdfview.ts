// PDF.js wrapper for the Reader's Original view (WP21 T21.2, plan §10.57).
//
// Built as a SEPARATE same-origin asset (dist/pdfjs.js + dist/pdfjs-worker.js),
// deployed next to viewer.html and precached by the service worker: the
// Reader loads it lazily with a dynamic import the first time it must render
// an author PDF rendition (ext-source 0.5 `visual`). The standalone file
// never loads it — its Original view stays the download card — and no code
// is ever fetched from a third-party origin (docs/ext-source.md, consumer
// guidance).
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-worker.js', document.baseURI).href;

/** Widest a rendered page gets, in CSS pixels (readable, not wall-to-wall). */
const MAX_PAGE_CSS_WIDTH = 900;

/**
 * Renders every page of `bytes` into `container` as canvases, sequentially.
 * Returns the page count. `viewWidth` is the CSS width of the VISIBLE pane
 * the pages will occupy — the container itself is typically still hidden
 * while rendering, so its own clientWidth would read 0. The caller owns
 * cancellation: it empties the container and ignores the promise when the
 * document changes — rendering stops at the next page boundary once the
 * container leaves the DOM.
 */
export async function renderPdfInto(
  container: HTMLElement,
  bytes: Uint8Array,
  viewWidth: number,
): Promise<number> {
  // pdf.js transfers the buffer to the worker — hand it a copy so the
  // package bytes stay intact for downloads and re-renders.
  const doc = await getDocument({ data: bytes.slice() }).promise;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const cssWidth = Math.min(Math.max(viewWidth - 32, 280), MAX_PAGE_CSS_WIDTH);
  for (let n = 1; n <= doc.numPages; n++) {
    if (!container.isConnected) break;
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = cssWidth / base.width;
    const viewport = page.getViewport({ scale: scale * dpr });
    const canvas = document.createElement('canvas');
    canvas.className = 'wdf-pdf-page';
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${String(Math.floor(viewport.width / dpr))}px`;
    canvas.style.height = `${String(Math.floor(viewport.height / dpr))}px`;
    await page.render({ canvas, viewport }).promise;
    if (!container.isConnected) break;
    container.appendChild(canvas);
  }
  const count = doc.numPages;
  void doc.loadingTask.destroy();
  return count;
}
