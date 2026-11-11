import {
  parseCaptureExt,
  readPackage,
  STANDALONE_PACKAGE,
  validatePackage,
  WdfError,
  type ValidationResult,
  type WdfCapture,
  type WdfOutline,
  type WdfPackage,
} from '@wdf-dev/core';

import { reportEntries } from '@wdf-dev/import';

import { convertFiles, pickMainFile, toStandalone } from './convert.js';
import { initLang, lang, msg, onLangChange } from './i18n.js';
import {
  agentBlocks,
  binarySourceDetails,
  buildOriginalSrcdoc,
  buildPrintSrcdoc,
  buildSrcdoc,
  captureDetails,
  captureNote,
  citation,
  conversionReport,
  outlineTree,
  parseSourceExt,
  visualSourceDetails,
  type OutlineTreeNode,
  type SourceExt,
} from './prepare.js';

function $(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing element #${id}`);
  return node;
}

const dec = new TextDecoder('utf-8', { fatal: true });

interface Loaded {
  pkg: WdfPackage;
  outline: WdfOutline;
  markdown: string;
  sourceExt: SourceExt | undefined;
  captureExt: WdfCapture | undefined;
}

let loaded: Loaded | undefined;
let selectedId: string | undefined;
// Paper view (WP10): rendering-only A4 sheet look for the Human view.
let paged = false;
// Plain view (spec §6.7.4, plan §10.70): the author's stylesheet off.
let plain = false;
// Bound tables get their "typed data ✓" mark only once the package verified.
let datasetsOk = false;
// Conversion report (ext-source 0.6) available for the Original view.
let reportAvailable = false;
// An anchor requested via the URL fragment, honoured once the Human frame
// is ready — so a shared link like document.html#p-0012 opens AT the spot.
let pendingAnchor: string | undefined;

// ---------------------------------------------------------------------------
// Status bar: normal text is sticky; flash messages restore it.

let statusText = '';
let statusTimer: ReturnType<typeof setTimeout> | undefined;
function setStatus(text: string): void {
  statusText = text;
  // A flash in progress keeps the bar; the new text shows when it ends.
  if (statusTimer === undefined) $('status-left').textContent = text;
}
function statusFlash(message: string, ms = 3500): void {
  $('status-left').textContent = message;
  if (statusTimer !== undefined) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusTimer = undefined;
    $('status-left').textContent = statusText;
  }, ms);
}

// ---------------------------------------------------------------------------
// Citation resolution (the consumer side of "copy citation"): paste a
// wdf:<document-id>#<element-id> URI — or a bare element id — into the
// sidebar search and the Reader jumps to the cited element (spec §7.10).

function resolveCitation(raw: string): boolean {
  if (loaded === undefined) return false;
  const text = raw.trim();
  const uri = /^wdf:(.+)#([A-Za-z][\w:.-]*)$/.exec(text);
  const id = uri !== null ? (uri[2] ?? '') : (/^#?([A-Za-z][\w:.-]*)$/.exec(text)?.[1] ?? '');
  if (id === '') return false;
  if (uri !== null && uri[1] !== loaded.pkg.manifest.id) {
    statusFlash(msg().otherDocument);
    return true;
  }
  if (!loaded.outline.some((n) => n.id === id)) {
    if (uri === null) return false; // plain text: fall through to the filter
    statusFlash(msg().anchorMissing(id));
    return true;
  }
  select(id, 'outline');
  statusFlash(msg().jumped(id));
  return true;
}

// ---------------------------------------------------------------------------
// Home: two zones, Read and Convert (plan §10.80, handoff "wdf_home_v2").
// Each card is its own drop target; files are routed by type whichever card
// receives them, and a card that got the "wrong" files says what happened
// instead of refusing. State lives in data-state, styled by viewer.css.

type Zone = 'read' | 'convert';
type ZoneState = 'idle' | 'over' | 'working' | 'error' | 'notice';

function zoneEl(zone: Zone): HTMLElement {
  return $(zone === 'read' ? 'zone-read' : 'zone-convert');
}

function zoneText(zone: Zone, cls: string, text: string): void {
  const node = zoneEl(zone).querySelector(`.${cls}`);
  if (node !== null) node.textContent = text;
}

interface ZoneText {
  working?: string;
  notice?: string;
  title?: string;
  body?: string;
}
// Each card's texts as a function of the language (plan §10.81), so a
// language change re-renders a notice or an error already on screen.
const zoneTexts: Record<Zone, () => ZoneText> = { read: () => ({}), convert: () => ({}) };

/** Sets a card's state; texts go in after it, so live regions announce them. */
function setZone(zone: Zone, state: ZoneState, make: () => ZoneText = () => ({})): void {
  const el = zoneEl(zone);
  el.dataset['state'] = state;
  if (state === 'working') el.setAttribute('aria-busy', 'true');
  else el.removeAttribute('aria-busy');
  zoneTexts[zone] = make;
  paintZone(zone);
}

function paintZone(zone: Zone): void {
  const state = zoneEl(zone).dataset['state'];
  const text = zoneTexts[zone]();
  zoneText(zone, 'js-working-name', text.working ?? '');
  zoneText(zone, 'js-notice', state === 'notice' ? (text.notice ?? '') : '');
  zoneText(zone, 'js-error-title', state === 'error' ? (text.title ?? '') : '');
  zoneText(zone, 'js-error-body', state === 'error' ? (text.body ?? '') : '');
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

/** "a.png, b.txt and 3 more" — the names a card could not use. */
function nameList(files: ReadonlyMap<string, Uint8Array>): string {
  const names = [...files.keys()].map(baseName);
  if (names.length <= 3) return names.join(', ');
  return msg().andMore(names.slice(0, 3).join(', '), names.length - 3);
}

/** What a convertible set is, in the words of the wrong-zone notice. */
function describeDocument(mainPath: string): string {
  if (/\.docx$/i.test(mainPath)) return msg().aWordFile;
  if (/\.(md|markdown)$/i.test(mainPath)) return msg().aMarkdownFile;
  if (/\.html?$/i.test(mainPath)) return msg().aWebPage;
  return msg().notAWdf;
}

/** Lets the browser paint a state before a long synchronous stretch. A hidden
 *  page never runs animation frames, so a timer bounds the wait. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 100);
    requestAnimationFrame(() => {
      setTimeout(() => {
        clearTimeout(timer);
        resolve();
      }, 0);
    });
  });
}

// ---------------------------------------------------------------------------
// In-browser converter (T7.6, plan §10.24): the dropped files convert to .wdf
// fully client-side — no upload, no network requests.

// The last dropped file set, kept so toggling options re-runs the conversion.
let droppedSet: Map<string, Uint8Array> | undefined;
let droppedZone: Zone = 'convert';
let droppedNotice: (() => string) | undefined;
let converted: { bytes: Uint8Array; title: string; fileName: string } | undefined;

function entryOf(item: DataTransferItem): FileSystemEntry | null {
  return typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
}

/** Reads a drag-and-drop entry (file or directory) into the path map. */
async function readEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: Map<string, Uint8Array>,
): Promise<void> {
  if (entry.name.startsWith('.')) return; // .DS_Store and friends
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => {
      (entry as FileSystemFileEntry).file(res, rej);
    });
    out.set(prefix + entry.name, new Uint8Array(await file.arrayBuffer()));
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      // readEntries returns batches (Chrome: 100 per call) until empty.
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => {
        reader.readEntries(res, rej);
      });
      if (batch.length === 0) break;
      for (const child of batch) await readEntry(child, `${prefix}${entry.name}/`, out);
    }
  }
}

async function fileListToMap(files: Iterable<File>): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  for (const file of files) {
    if (file.name.startsWith('.')) continue;
    out.set(file.name, new Uint8Array(await file.arrayBuffer()));
  }
  return out;
}

/** Routes a file set by type: a .wdf opens, anything else converts. */
async function handleDropped(files: Map<string, Uint8Array>, zone: Zone): Promise<void> {
  setZone(zone === 'read' ? 'convert' : 'read', 'idle');
  const wdf = [...files.keys()].sort().find((p) => /\.wdf$/i.test(p));
  if (wdf !== undefined) {
    const bytes = files.get(wdf);
    if (bytes === undefined) return;
    const name = baseName(wdf);
    setZone(zone, 'working', () => ({ working: name }));
    await nextPaint();
    if (!openBytes(bytes, name, zone)) return;
    // The document now covers the home: the wrong-zone line also goes to
    // the document's status bar, where it can be seen.
    if (zone === 'convert') {
      setZone(zone, 'notice', () => ({ notice: msg().alreadyWdf }));
      statusFlash(msg().alreadyWdf, 6000);
    } else {
      setZone(zone, 'idle');
    }
    return;
  }
  const main = pickMainFile(files);
  if (main === undefined) {
    $('convert-panel').hidden = true;
    setZone(zone, 'error', () => ({
      title: zone === 'read' ? msg().notWdf : msg().nothingToConvert,
      body: files.size === 0 ? msg().noFiles : msg().unusable(nameList(files)),
    }));
    return;
  }
  droppedSet = files;
  droppedZone = zone;
  droppedNotice = zone === 'read' ? () => msg().converting(describeDocument(main)) : undefined;
  await runConvert(true);
}

async function runConvert(fresh = false): Promise<void> {
  if (droppedSet === undefined) return;
  const files = droppedSet;
  const zone = droppedZone;
  const main = pickMainFile(files) ?? '';
  const panel = $('convert-panel');
  const download = $('convert-download') as HTMLButtonElement;
  $('convert-download-error').hidden = true;
  setZone(zone, 'working', () => ({ working: baseName(main) }));
  download.disabled = true;
  await nextPaint();
  const withSource = ($('convert-source') as HTMLInputElement).checked;
  let result;
  try {
    result = await convertFiles(files, withSource ? { withSource: true } : {});
  } catch (e) {
    panel.hidden = true;
    const detail = e instanceof Error ? e.message : String(e);
    setZone(zone, 'error', () => ({ title: msg().convertFailed, body: detail }));
    return;
  } finally {
    download.disabled = false;
  }
  if (result === undefined) {
    panel.hidden = true;
    setZone(zone, 'error', () => ({
      title: msg().nothingToConvert,
      body: msg().noContent(baseName(main)),
    }));
    return;
  }
  if (droppedNotice === undefined) setZone(zone, 'idle');
  else {
    const notice = droppedNotice;
    setZone(zone, 'notice', () => ({ notice: notice() }));
  }

  converted = { bytes: result.wdfBytes, title: result.title, fileName: result.fileName };
  const base = result.fileName.replace(/\.wdf$/i, '');
  $('convert-doc-title').textContent = result.title;
  $('convert-base').textContent = base;
  $('convert-from').textContent = baseName(main);
  $('convert-name-html').textContent = `${base}.wdf.html`;
  $('convert-name-wdf').textContent = result.fileName;
  // The author answers for the PDF (plan §10.78): nothing compares it with
  // the document, so the panel says so before anyone downloads.
  panel.classList.toggle('has-pdf', result.visualName !== undefined);
  panel.classList.toggle(
    'pdf-dropped',
    [...files.keys()].some((p) => /\.pdf$/i.test(p)),
  );
  for (const node of panel.querySelectorAll('.js-pdf-name')) {
    node.textContent = result.visualName ?? '';
  }
  renderConvertReport(result.report);
  panel.hidden = false;
  if (fresh) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Conversion report: what was dropped or changed first, in ink, then the
// plain notes (the importer's own classification, ext-source 0.6). The notes
// themselves stay in English (plan §10.81); tags and headings translate.
let shownReport: readonly string[] = [];

function renderConvertReport(report: readonly string[]): void {
  shownReport = report;
  const m = msg();
  const entries = reportEntries(report);
  const changes = entries.filter((e) => e.kind !== 'info');
  const info = entries.filter((e) => e.kind === 'info');
  const fill = (listId: string, items: typeof entries): void => {
    const list = $(listId);
    list.textContent = '';
    for (const e of items) {
      const li = document.createElement('li');
      li.className = e.kind === 'info' ? 'note' : 'note note--change';
      const tag = document.createElement('span');
      tag.className = e.kind === 'info' ? 'tag tag--line' : 'tag tag--ink';
      tag.textContent = m.noteTag[e.kind];
      const text = document.createElement('span');
      text.textContent = e.count > 1 ? `${e.message} (×${String(e.count)})` : e.message;
      li.append(tag, text);
      list.append(li);
    }
    list.hidden = items.length === 0;
  };
  fill('convert-notes', changes);
  fill('convert-info', info);
  const head = (id: string, label: string, n: number): void => {
    $(id).textContent = `${label} · ${String(n)}`;
    $(id).hidden = n === 0;
  };
  head('convert-changes-head', m.changesHead, changes.length);
  head('convert-info-head', m.notesHead, info.length);
  $('convert-count-changes').textContent = changes.length === 0 ? '' : m.nChanged(changes.length);
  $('convert-count-notes').textContent = info.length === 0 ? '' : m.nNotes(info.length);
  $('convert-report').hidden = entries.length === 0;
}

function saveFile(data: BlobPart, type: string, name: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
}

// The .wdf.html template (plan §10.80) is a same-origin lazy asset of the
// Reader deployment, precached by the SW — fetched on the first download in
// that format, never from a third party. The standalone never calls this.
let standaloneTemplate: Promise<string> | undefined;

function loadStandaloneTemplate(): Promise<string> {
  standaloneTemplate ??= fetch('standalone-template.html')
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
      return r.text();
    })
    .then((text) => {
      if (!text.includes(STANDALONE_PACKAGE)) throw new Error('not a standalone template');
      return text;
    })
    .catch((e: unknown) => {
      standaloneTemplate = undefined; // a later click may succeed (e.g. back online)
      throw e;
    });
  return standaloneTemplate;
}

async function downloadConverted(): Promise<void> {
  if (converted === undefined) return;
  const error = $('convert-download-error');
  error.hidden = true;
  const format = document.querySelector<HTMLInputElement>(
    'input[name="convert-format"]:checked',
  )?.value;
  if (format !== 'wdf.html') {
    saveFile(converted.bytes.slice().buffer, 'application/wdf+zip', converted.fileName);
    return;
  }
  const button = $('convert-download') as HTMLButtonElement;
  button.disabled = true;
  try {
    const html = toStandalone(await loadStandaloneTemplate(), {
      title: converted.title,
      wdfBytes: converted.bytes,
    });
    saveFile(html, 'text/html', converted.fileName.replace(/\.wdf$/i, '.wdf.html'));
  } catch {
    error.textContent = msg().noTemplate;
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
}

/** Opens a package in the app view; false (and an error in `zone`) if unreadable. */
function openBytes(bytes: Uint8Array, name: string, zone: Zone = 'read'): boolean {
  const fail = (detail: string): false => {
    setZone(zone, 'error', () => ({ title: msg().openFailed, body: `${name}: ${detail}` }));
    return false;
  };
  let pkg: WdfPackage;
  try {
    pkg = readPackage(bytes);
  } catch (e) {
    return fail(e instanceof WdfError ? e.message : String(e));
  }
  try {
    const markdown = dec.decode(pkg.files.get('ai/content.md') ?? new Uint8Array());
    const outline = JSON.parse(
      dec.decode(pkg.files.get('ai/outline.json') ?? new Uint8Array()),
    ) as WdfOutline;
    loaded = {
      pkg,
      outline,
      markdown,
      sourceExt: parseSourceExt(pkg.files),
      captureExt: parseCaptureExt(pkg.files),
    };
  } catch (e) {
    return fail(msg().unreadableAi(String(e)));
  }

  $('drop-screen').hidden = true;
  $('app').hidden = false;
  document.title = `${pkg.manifest.title} — WDF`;
  $('doc-title').textContent = pkg.manifest.title;
  $('doc-title').title = name;
  // WP18: a live-page capture declares its nature next to the badge
  // (docs/ext-capture.md §6); the full provenance is in the badge details.
  paintCaptureNote(loaded);

  renderHuman(loaded);
  renderAgent(loaded);
  renderOriginal(loaded);
  renderOutline(loaded);
  ($('outline-search') as HTMLInputElement).value = '';
  setView('human');
  datasetsOk = false;
  shownVerdict = undefined;
  setBadgeState('wait', msg().checking);
  // A URL fragment names the anchor to open at (resolved when the Human
  // frame is ready) — the human-consumable end of a citation link.
  pendingAnchor = /^#([A-Za-z][\w:.-]*)$/.exec(location.hash)?.[1];
  void verify(loaded);
  return true;
}

function renderHuman(doc: Loaded): void {
  const entry = dec.decode(doc.pkg.files.get(doc.pkg.manifest.entry) ?? new Uint8Array());
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  ($('human') as HTMLIFrameElement).srcdoc = buildSrcdoc(entry, doc.pkg.files, nonce, { plain });
}

function setPlain(on: boolean): void {
  plain = on;
  $('plain-toggle').classList.toggle('active', on);
  if (loaded !== undefined) renderHuman(loaded);
  statusFlash(on ? msg().plainOn : msg().plainOff);
}

// The Original view's conversion report (ext-source 0.6, review F04): what
// the producer transformed or dropped, next to the original it describes.
function renderReport(doc: Loaded): void {
  const panel = $('original-report');
  const list = $('original-report-list');
  list.textContent = '';
  panel.hidden = true;
  const report =
    doc.sourceExt === undefined ? undefined : conversionReport(doc.pkg.files, doc.sourceExt);
  reportAvailable = report !== undefined;
  if (report === undefined) return;
  const m = msg();
  const parts = [m.reportNotes(report.entries.length)];
  if (report.losses > 0) parts.push(m.reportDropped(report.losses));
  if (report.changes > 0) parts.push(m.reportTransformed(report.changes));
  $('original-report-summary').textContent = m.reportSummary(
    parts.join(', '),
    report.toolVersion === '' ? '' : ` (${report.tool} ${report.toolVersion})`,
  );
  for (const e of report.entries) {
    const li = document.createElement('li');
    li.className = `report__${e.kind}`;
    li.textContent = `${m.reportKind[e.kind]}: ${e.message}${e.count > 1 ? ` (×${String(e.count)})` : ''}`;
    list.append(li);
  }
}

// Print / export as PDF (WP10): a dedicated script-less frame with the
// paged-media sheet; the browser's print engine does the pagination.
function exportPdf(): void {
  if (loaded === undefined) return;
  // The author's PDF rendition IS the PDF of this document (ext-source 0.5):
  // download it instead of print-exporting a re-rendering.
  if (visualAvailable && visualUrl !== undefined) {
    const a = document.createElement('a');
    a.href = visualUrl;
    a.download = visualFileName;
    a.click();
    return;
  }
  printDocument();
}

// The whole document through the browser's print engine. Also the answer to
// the browser's own Print shortcut (plan §10.93): printing the Reader window
// would give one page, the document frame cut at the first screen.
function printDocument(): void {
  if (loaded === undefined) return;
  const entry = dec.decode(loaded.pkg.files.get(loaded.pkg.manifest.entry) ?? new Uint8Array());
  const frame = $('print-frame') as HTMLIFrameElement;
  frame.onload = () => {
    frame.contentWindow?.print();
  };
  frame.srcdoc = buildPrintSrcdoc(entry, loaded.pkg.files);
}

/** Ctrl+P / Cmd+P, with no other modifier. */
function isPrintShortcut(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'p';
}

function setPaged(on: boolean): void {
  paged = on;
  $('paged-toggle').classList.toggle('active', on);
  postToHuman({ type: 'wdf-paged', on });
}

// "Original" view (WP13): the embedded source, shown untouched. The toggle
// only appears when the package carries the `source` extension. A binary
// original (ext-source 0.4) has nothing to render: the view shows its
// metadata and offers the embedded bytes for download instead.
let originalIsBinary = false;
let binaryUrl: string | undefined;
let visualUrl: string | undefined;
let currentView: 'human' | 'agent' | 'original' = 'human';
// When the package carries the author's PDF rendition, the toolbar "PDF"
// button downloads THAT file — the authoritative page image — instead of
// print-exporting the Human view (Paolo's UI decision, 25 Aug).
let visualAvailable = false;
let visualFileName = '';

// In-app rendering of the author's PDF rendition (WP21 T21.2): the Reader
// lazy-loads the PDF.js wrapper (a same-origin asset precached by the SW)
// the first time the Original view needs it. The standalone never loads
// it; it shows the PDF in the browser's own viewer instead, where there is
// one (plan §10.82: no code shipped or fetched, the bytes are the
// package's). The Reader falls back to it too if PDF.js fails. With
// neither, the download cards are the view. No code is ever fetched from a
// third-party origin.
let visualPdf: 'idle' | 'loading' | 'ready' | 'native' | 'failed' = 'idle';
let pdfGen = 0;
let visualPages: { size: string; count?: number } | undefined;

function paintPdfMeta(): void {
  if (visualPages === undefined) return;
  const { size, count } = visualPages;
  $('original-pdf-meta').textContent =
    count === undefined ? size : `${size} · ${msg().pages(count)}`;
}

// The two files above the PDF on view (plan §10.82): the PDF and the original.
function paintPdfLinks(pdfName: string): void {
  const pdf = $('original-pdf-download') as HTMLAnchorElement;
  const source = $('original-source-download') as HTMLAnchorElement;
  const sourceLink = $('original-binary-download') as HTMLAnchorElement;
  pdf.href = visualUrl ?? '';
  pdf.download = pdfName;
  pdf.textContent = pdfName;
  source.href = sourceLink.href;
  source.download = sourceLink.download;
  source.textContent = sourceLink.download;
  source.hidden = sourceLink.download === '';
}

async function ensureVisualPdf(doc: Loaded): Promise<void> {
  if (visualPdf !== 'idle') return;
  const ext = doc.sourceExt;
  const details = ext === undefined ? undefined : visualSourceDetails(doc.pkg.files, ext);
  const bytes = ext?.visual === undefined ? undefined : doc.pkg.files.get(ext.visual.path);
  const standalone = document.getElementById('wdf-package') !== null;
  if (ext === undefined || details === undefined || bytes === undefined) {
    visualPdf = 'failed';
    return;
  }
  const gen = pdfGen;
  if (!standalone) {
    visualPdf = 'loading';
    try {
      // dist/pdfjs.js is a separately built asset (build.mjs) external to this
      // bundle — the literal specifier stays for esbuild, TS cannot resolve it.
      // @ts-expect-error TS2307 — no source module behind the runtime asset
      const mod = (await import('./pdfjs.js')) as typeof import('./pdfview.js');
      const pages = $('original-pdf-pages');
      pages.textContent = '';
      const count = await mod.renderPdfInto(pages, bytes, $('content').clientWidth);
      if (gen !== pdfGen) return; // another document took over meanwhile
      if (count === 0) throw new Error('empty PDF');
      visualPages = { size: details.sizeLabel, count };
      visualPdf = 'ready';
    } catch {
      if (gen !== pdfGen) return;
    }
  }
  if (visualPdf !== 'ready') {
    // navigator.pdfViewerEnabled: Chrome/Edge, Firefox, desktop Safari.
    const native = navigator.pdfViewerEnabled && visualUrl !== undefined;
    if (native) {
      ($('original-pdf-native') as HTMLIFrameElement).src = visualUrl ?? '';
      visualPages = { size: details.sizeLabel };
    }
    visualPdf = native ? 'native' : 'failed';
  }
  paintPdfMeta();
  paintPdfLinks(details.fileName);
  if (currentView === 'original') setView('original');
}

function paintPdfTitle(): void {
  $('pdf-export').title = visualAvailable
    ? msg().downloadAuthorPdf(visualFileName)
    : msg().exportPdf;
}

// What the browser's own Print gives in place of the Reader window (plan
// §10.93). Created here, never in the page source: a text extractor reading a
// .wdf.html must find the document, not a line about printing.
function paintPrintNotice(): void {
  let notice = document.getElementById('print-notice');
  if (notice === null) {
    notice = document.createElement('p');
    notice.id = 'print-notice';
    notice.className = 'print-notice';
    document.body.append(notice);
  }
  notice.textContent = msg().printNotice;
}

// The author's PDF rendition (ext-source 0.5, WP21): the lean card offers
// a download; the standalone adds a pointer to the installable Reader.
function renderVisual(doc: Loaded): void {
  const card = $('original-visual');
  if (visualUrl !== undefined) {
    URL.revokeObjectURL(visualUrl);
    visualUrl = undefined;
  }
  const ext = doc.sourceExt;
  const details = ext === undefined ? undefined : visualSourceDetails(doc.pkg.files, ext);
  const bytes = ext?.visual === undefined ? undefined : doc.pkg.files.get(ext.visual.path);
  if (ext === undefined || details === undefined || bytes === undefined) {
    card.hidden = true;
    visualAvailable = false;
    visualFileName = '';
    paintPdfTitle();
    return;
  }
  card.hidden = false;
  visualAvailable = true;
  visualFileName = details.fileName;
  paintPdfTitle();
  $('original-visual-name').textContent = details.fileName;
  $('original-visual-meta').textContent = `${details.mediaType} · ${details.sizeLabel}`;
  const link = $('original-visual-download') as HTMLAnchorElement;
  visualUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: details.mediaType }));
  link.href = visualUrl;
  link.download = details.fileName;
  // Spec §9 standalone (embedded package): no bundled renderer — point to
  // the installable Reader instead (docs/ext-source.md consumer guidance).
  $('original-visual-hint').hidden = document.getElementById('wdf-package') === null;
}

function renderOriginal(doc: Loaded): void {
  const frame = $('original') as HTMLIFrameElement;
  const button = $('view-original');
  originalIsBinary = doc.sourceExt?.kind === 'binary';
  if (binaryUrl !== undefined) {
    URL.revokeObjectURL(binaryUrl);
    binaryUrl = undefined;
  }
  // A new document resets the rendition rendering (WP21 T21.2).
  pdfGen++;
  visualPdf = 'idle';
  visualPages = undefined;
  $('original-pdf-pages').textContent = '';
  $('original-pdf-native').removeAttribute('src');
  renderVisual(doc);
  renderReport(doc);
  if (doc.sourceExt === undefined) {
    button.hidden = true;
    frame.srcdoc = '';
    return;
  }
  button.hidden = false;
  if (originalIsBinary) {
    frame.srcdoc = '';
    const details = binarySourceDetails(doc.pkg.files, doc.sourceExt);
    const bytes = doc.pkg.files.get(doc.sourceExt.main);
    if (details === undefined || bytes === undefined) {
      button.hidden = true;
      return;
    }
    $('original-binary-name').textContent = details.fileName;
    $('original-binary-meta').textContent = `${details.mediaType} · ${details.sizeLabel}`;
    const link = $('original-binary-download') as HTMLAnchorElement;
    binaryUrl = URL.createObjectURL(
      new Blob([bytes as BlobPart], {
        type: doc.sourceExt.mediaType ?? 'application/octet-stream',
      }),
    );
    link.href = binaryUrl;
    link.download = details.fileName;
    return;
  }
  frame.srcdoc = buildOriginalSrcdoc(doc.pkg.files, doc.sourceExt);
}

function renderAgent(doc: Loaded): void {
  const container = $('agent');
  container.textContent = '';
  for (const block of agentBlocks(doc.markdown)) {
    const div = document.createElement('div');
    div.className = 'md-block';
    div.dataset['ids'] = block.ids.join(' ');
    let rest = block.text;
    // Wrap anchors in highlighted spans, keeping the raw text intact.
    const parts = rest.split(/(\{#[a-z]+-[a-z0-9-]*\})/g);
    for (const part of parts) {
      if (/^\{#[a-z]+-[a-z0-9-]*\}$/.test(part)) {
        const span = document.createElement('span');
        span.className = 'md-anchor';
        span.textContent = part;
        div.append(span);
      } else if (part !== '') {
        div.append(document.createTextNode(part));
      }
    }
    rest = '';
    div.addEventListener('click', () => {
      const first = block.ids[0];
      if (first !== undefined) select(first, 'agent');
    });
    container.append(div);
  }
}

function typeLabel(type: string): string {
  const map: Record<string, string> = {
    section: '§',
    heading: 'H',
    paragraph: '¶',
    table: '⊞',
    figure: '▣',
    blockquote: '❝',
    'list-item': '•',
  };
  return map[type] ?? '·';
}

const LINK_SVG =
  '<svg class="icon icon--sm icon--muted" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M10.2 13.8a3.6 3.6 0 0 0 5.1 0l2.6-2.6a3.6 3.6 0 0 0-5.1-5.1l-1 1"></path>' +
  '<path d="M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-2.6 2.6a3.6 3.6 0 0 0 5.1 5.1l1-1"></path></svg>';

function renderOutline(doc: Loaded): void {
  const nav = $('outline');
  nav.textContent = '';
  const render = (nodes: OutlineTreeNode[]): HTMLUListElement => {
    const ul = document.createElement('ul');
    for (const { node, children } of nodes) {
      const li = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'ol-row';

      const label = document.createElement('button');
      label.className = 'ol-label';
      const type = document.createElement('span');
      type.className = 'ol-type';
      type.textContent = typeLabel(node.type);
      const text = document.createElement('span');
      // Titled nodes read as prose; untitled ones show their anchor id in
      // mono, as in the design's anchor list.
      text.className = node.title === undefined ? 'ol-text ol-text--id' : 'ol-text';
      text.textContent = node.title ?? node.id;
      label.append(type, text);
      label.title = node.id;
      label.addEventListener('click', () => {
        select(node.id, 'outline');
      });

      const cite = document.createElement('button');
      cite.className = 'ol-cite';
      cite.innerHTML = LINK_SVG;
      cite.title = msg().copyCitationFor(node.id);
      cite.dataset['cite'] = node.id;
      cite.addEventListener('click', () => {
        void copyCitation(node.id, cite);
      });

      row.append(label, cite);
      li.append(row);
      if (children.length > 0) li.append(render(children));
      ul.append(li);
    }
    return ul;
  };
  nav.append(render(outlineTree(doc.outline)));
  const count = doc.outline.length;
  $('anchor-count').textContent = String(count);
  setStatus(msg().anchors(count));
  $('status-right').textContent = `wdf ${doc.pkg.manifest.wdf}`;
}

// ---------------------------------------------------------------------------
// Verification badge (T4.2)

// Chip + popover share one state vocabulary; green stays reserved for
// verification (design rule, plan §10.63).
function setBadgeState(state: 'wait' | 'ok' | 'bad' | 'warn', text: string): void {
  const glyph = { wait: '…', ok: '✓', bad: '✕', warn: '!' }[state];
  $('badge').className = `chipv chipv--${state}`;
  $('badge-icon').textContent = glyph;
  $('badge-label').textContent = text;
  $('details-panel').className = `popover popover--${state}`;
  $('details-head-label').textContent = text;
}

// The last verdict, kept so a language change repaints it (plan §10.81)
// without validating again.
let shownVerdict:
  { doc: Loaded; result: ValidationResult } | { doc: Loaded; error: string } | undefined;

async function verify(doc: Loaded): Promise<void> {
  let verdict: NonNullable<typeof shownVerdict>;
  try {
    // One pipeline, one verdict, shared with the CLI and MCP (spec §8.2
    // errata 2026-09-15, plan §10.70). Green only for `verified`; a digest
    // mismatch is the only case called tampering.
    verdict = { doc, result: await validatePackage(doc.pkg) };
  } catch (e) {
    verdict = { doc, error: String(e) };
  }
  if (loaded !== doc) return; // another document took over meanwhile
  shownVerdict = verdict;
  paintVerdict();
}

function paintVerdict(): void {
  if (shownVerdict === undefined) return;
  const { doc } = shownVerdict;
  const m = msg();
  const list = $('details-list');
  list.textContent = '';
  const add = (text: string, cls: string): void => {
    const li = document.createElement('li');
    li.className = cls;
    li.textContent = text;
    list.append(li);
  };
  if ('error' in shownVerdict) {
    setBadgeState('warn', m.status['not-verifiable'].label);
    add(m.verificationCrashed(shownVerdict.error), 'bad');
    datasetsOk = false;
    return;
  }
  const { result } = shownVerdict;
  const text = m.status[result.status];
  const state: 'ok' | 'bad' | 'warn' = result.verified
    ? 'ok'
    : result.status === 'unsupported-version' || result.status === 'not-verifiable'
      ? 'warn'
      : 'bad';
  setBadgeState(state, text.label);
  add(`${text.label}: ${text.detail}`, result.verified ? 'ok' : 'bad');
  add(result.integrity ? m.integrityOk : m.integrityFailed, result.integrity ? 'ok' : 'bad');
  add(
    result.determinism ? m.determinismOk : m.determinismFailed,
    result.determinism ? 'ok' : 'bad',
  );
  add(
    result.conformance ? m.conformanceOk : m.conformanceFailed,
    result.conformance ? 'ok' : 'bad',
  );
  // Validator messages stay in English: they cite the spec (plan §10.81).
  for (const v of result.violations) {
    add(
      `[${v.spec}] ${v.severity === 'warning' ? m.warning : ''}${v.path} — ${v.message}`,
      v.severity === 'warning' ? '' : 'bad',
    );
  }
  if (doc.captureExt !== undefined) {
    for (const line of captureDetails(doc.captureExt, lang())) add(line, '');
  }
  add(m.notAuthenticity, '');

  // Status bar (design "app shell 4A"): anchors · content hash · verdict —
  // the same verdict as the badge, never a second opinion.
  try {
    const hashes = JSON.parse(
      dec.decode(doc.pkg.files.get('integrity/hashes.json') ?? new Uint8Array()),
    ) as { files?: Record<string, string> };
    const entryHash = hashes.files?.[doc.pkg.manifest.entry];
    const short =
      entryHash === undefined ? '' : ` · sha-256 ${entryHash.slice(0, 4)}…${entryHash.slice(-4)}`;
    const verdict = result.verified ? m.verifiedLocally : text.label.toUpperCase();
    setStatus(`${m.anchors(doc.outline.length)}${short} · ${verdict}`);
  } catch {
    /* status bar is informational — never block on it */
  }
  // Bound tables (§6.5) are marked as typed data only on a verified package.
  datasetsOk = result.verified;
  postToHuman({ type: 'wdf-datasets', ok: datasetsOk });
}

function paintCaptureNote(doc: Loaded): void {
  const note = $('capture-note');
  note.hidden = doc.captureExt === undefined;
  note.textContent = doc.captureExt === undefined ? '' : captureNote(doc.captureExt, lang());
}

// ---------------------------------------------------------------------------
// Selection, citations (T4.3, T4.4)

function postToHuman(message: unknown): void {
  ($('human') as HTMLIFrameElement).contentWindow?.postMessage(message, '*');
}

function select(id: string, source: 'human' | 'agent' | 'outline'): void {
  selectedId = id;
  // Agent view highlight.
  const container = $('agent');
  let target: HTMLElement | undefined;
  for (const block of container.querySelectorAll<HTMLElement>('.md-block')) {
    const ids = (block.dataset['ids'] ?? '').split(' ');
    const hit = ids.includes(id);
    block.classList.toggle('selected', hit && target === undefined);
    if (hit && target === undefined) target = block;
  }
  if (target !== undefined && !$('agent').hidden) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  // Human view scroll (unless the click originated there).
  if (source !== 'human') postToHuman({ type: 'wdf-scroll', id });

  // Citation chip.
  if (loaded !== undefined) {
    $('chip').hidden = false;
    $('chip-id').textContent = citation(loaded.pkg.manifest.id, id);
  }
}

async function copyCitation(id: string, button?: HTMLElement): Promise<void> {
  if (loaded === undefined) return;
  const text = citation(loaded.pkg.manifest.id, id);
  try {
    await navigator.clipboard.writeText(text);
    if (button !== undefined) {
      const old = button.textContent;
      button.textContent = '✓';
      setTimeout(() => {
        button.textContent = old;
      }, 900);
    }
  } catch {
    window.prompt(msg().copyCitationPrompt, text);
  }
}

// ---------------------------------------------------------------------------
// Wiring

// The outline navigates by element ids — meaningless in the Original view
// (PDF rendition, download card, or untouched source): there it closes and
// its toggle disables; the previous open state returns with Human/Agent.
let sidebarWasOpen = false;

function setView(view: 'human' | 'agent' | 'original'): void {
  currentView = view;
  const app = $('app');
  const sidebarToggle = $('sidebar-toggle') as HTMLButtonElement;
  if (view === 'original') {
    // Only remember the state on the way IN (repeated setView('original')
    // calls — e.g. when the PDF render completes — must not overwrite it).
    if (!sidebarToggle.disabled) sidebarWasOpen = app.classList.contains('sidebar-open');
    app.classList.remove('sidebar-open');
    sidebarToggle.disabled = true;
  } else if (sidebarToggle.disabled) {
    sidebarToggle.disabled = false;
    app.classList.toggle('sidebar-open', sidebarWasOpen);
  }
  // Reader only (WP21 T21.2): first entry into Original kicks off the lazy
  // in-app rendering of the author's PDF rendition; until it is ready (or
  // when it fails, or in the standalone) the download card is the view.
  if (view === 'original' && originalIsBinary && visualPdf === 'idle' && loaded !== undefined) {
    void ensureVisualPdf(loaded);
  }
  const pdfReady = originalIsBinary && (visualPdf === 'ready' || visualPdf === 'native');
  $('original-pdf-pages').hidden = visualPdf !== 'ready';
  $('original-pdf-native').hidden = visualPdf !== 'native';
  $('human').hidden = view !== 'human';
  $('agent').hidden = view !== 'agent';
  $('original').hidden = view !== 'original' || originalIsBinary;
  $('original-binary').hidden = view !== 'original' || !originalIsBinary || pdfReady;
  $('original-pdf').hidden = view !== 'original' || !pdfReady;
  $('view-human').classList.toggle('active', view === 'human');
  $('view-agent').classList.toggle('active', view === 'agent');
  $('view-original').classList.toggle('active', view === 'original');
  // Paper acts on the document rendering: available only where it applies
  // (the Human view); the paper state itself survives view switches. PDF
  // does too when it print-exports — but when it downloads the author's
  // rendition it applies everywhere.
  ($('paged-toggle') as HTMLButtonElement).disabled = view !== 'human';
  ($('plain-toggle') as HTMLButtonElement).disabled = view !== 'human';
  $('original-report').hidden = view !== 'original' || !reportAvailable;
  ($('pdf-export') as HTMLButtonElement).disabled = view !== 'human' && !visualAvailable;
  if (view === 'agent' && selectedId !== undefined) select(selectedId, 'outline');
}

// A language change (plan §10.81) repaints what the code wrote; the shell's
// own texts are handled by i18n.ts.
function repaintTexts(): void {
  paintPrintNotice();
  paintZone('read');
  paintZone('convert');
  if (!$('convert-panel').hidden) renderConvertReport(shownReport);
  if ($('convert-download-error').hidden === false)
    $('convert-download-error').textContent = msg().noTemplate;
  if (loaded === undefined) return;
  paintCaptureNote(loaded);
  paintPdfTitle();
  paintPdfMeta();
  renderReport(loaded); // rebuilt hidden: show it again where it belongs
  $('original-report').hidden = currentView !== 'original' || !reportAvailable;
  for (const cite of $('outline').querySelectorAll<HTMLElement>('[data-cite]')) {
    cite.title = msg().copyCitationFor(cite.dataset['cite'] ?? '');
  }
  if (shownVerdict === undefined) {
    setStatus(msg().anchors(loaded.outline.length));
    setBadgeState('wait', msg().checking);
  } else {
    paintVerdict();
  }
}

function init(): void {
  initLang();
  onLangChange(repaintTexts);
  // Reader-only typography (plan §10.62): IBM Plex loads lazily from the
  // deployment (plex.css + woff2, precached by the SW). The standalone never
  // injects it and falls back to the system stacks — the single-file rule
  // and "no network from the document" stay intact.
  if (document.getElementById('wdf-package') === null) {
    const plex = document.createElement('link');
    plex.rel = 'stylesheet';
    plex.href = 'plex.css';
    document.head.appendChild(plex);
  }

  // No page-wide drop target (plan §10.80): only the two cards take files. A
  // file dropped anywhere else must not make the browser navigate to it.
  const isFileDrag = (e: DragEvent): boolean => e.dataTransfer?.types.includes('Files') === true;
  for (const eventName of ['dragover', 'drop'] as const) {
    window.addEventListener(eventName, (e) => {
      if (isFileDrag(e)) e.preventDefault();
    });
  }
  for (const zone of ['read', 'convert'] as const) {
    const el = zoneEl(zone);
    const input = $(zone === 'read' ? 'file-input-read' : 'file-input') as HTMLInputElement;
    // The whole card is the mouse target; its "choose" button is the keyboard
    // target (Enter/Space click it natively) and its click bubbles here.
    el.addEventListener('click', (e) => {
      const target = e.target as Element;
      if (target === input || target.closest('[role="alert"], [role="status"]') !== null) return;
      if (el.dataset['state'] === 'working') return;
      input.click();
    });
    input.addEventListener('change', () => {
      const files = input.files;
      if (files !== null && files.length > 0) {
        void fileListToMap(files).then((map) => handleDropped(map, zone));
      }
      input.value = ''; // choosing the same file again still fires change
    });
    // Child elements fire their own enter/leave: count the depth, and give
    // the card back the state it had (a notice, an error) when the drag leaves.
    let depth = 0;
    let rest = 'idle';
    el.addEventListener('dragenter', (e) => {
      if (!isFileDrag(e) || el.dataset['state'] === 'working') return;
      e.preventDefault();
      if (depth++ === 0) rest = el.dataset['state'] ?? 'idle';
      el.dataset['state'] = 'over';
    });
    el.addEventListener('dragover', (e) => {
      if (!isFileDrag(e) || el.dataset['state'] === 'working') return;
      e.preventDefault();
      if (e.dataTransfer !== null) e.dataTransfer.dropEffect = 'copy';
    });
    el.addEventListener('dragleave', () => {
      if (depth === 0) return;
      if (--depth === 0 && el.dataset['state'] === 'over') el.dataset['state'] = rest;
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      if (el.dataset['state'] === 'working') return;
      el.dataset['state'] = rest;
      const dt = e.dataTransfer;
      if (dt === null) return;
      // webkitGetAsEntry must be taken synchronously, before the event ends;
      // it is the only way to receive dropped folders (Word's _files/.fld).
      const entries = [...dt.items].map(entryOf).filter((en) => en !== null);
      if (entries.length > 0) {
        void (async () => {
          const map = new Map<string, Uint8Array>();
          for (const entry of entries) await readEntry(entry, '', map);
          await handleDropped(map, zone);
        })();
      } else {
        void fileListToMap(dt.files).then((map) => handleDropped(map, zone));
      }
    });
  }
  $('convert-open').addEventListener('click', () => {
    if (converted !== undefined) openBytes(converted.bytes, converted.fileName, 'convert');
  });
  $('convert-download').addEventListener('click', () => {
    void downloadConverted();
  });
  $('convert-source').addEventListener('change', () => {
    void runConvert();
  });

  $('view-human').addEventListener('click', () => {
    setView('human');
  });
  $('view-agent').addEventListener('click', () => {
    setView('agent');
  });
  $('view-original').addEventListener('click', () => {
    setView('original');
  });
  $('paged-toggle').addEventListener('click', () => {
    setPaged(!paged);
  });
  $('plain-toggle').addEventListener('click', () => {
    setPlain(!plain);
  });
  $('pdf-export').addEventListener('click', () => {
    exportPdf();
  });
  // A reloaded Human frame starts unpaged and unmarked: re-apply both.
  $('human').addEventListener('load', () => {
    if (paged) postToHuman({ type: 'wdf-paged', on: true });
    if (datasetsOk) postToHuman({ type: 'wdf-datasets', ok: true });
    if (pendingAnchor !== undefined && loaded !== undefined) {
      const id = pendingAnchor;
      if (loaded.outline.some((n) => n.id === id)) select(id, 'outline');
      pendingAnchor = undefined;
    }
  });
  // The outline column starts closed everywhere; the ☰ icon opens it.
  $('sidebar-toggle').addEventListener('click', () => {
    $('app').classList.toggle('sidebar-open');
  });
  // The chip toggles the verification popover, anchored under itself.
  $('badge').addEventListener('click', () => {
    const panel = $('details-panel');
    if (panel.hidden) {
      panel.style.left = `${String(Math.max(10, Math.min($('badge').offsetLeft, window.innerWidth - 400)))}px`;
      panel.hidden = false;
    } else {
      panel.hidden = true;
    }
  });
  $('details-close').addEventListener('click', () => {
    $('details-panel').hidden = true;
  });
  // Anchor search (design "app shell 4A"): filters the outline by title or
  // id; an ancestor of a match stays visible (textContent includes children).
  // A pasted citation URI resolves immediately; Enter jumps to an exact id
  // or to the first visible match.
  const searchInput = $('outline-search') as HTMLInputElement;
  const applyFilter = (q: string): void => {
    for (const li of $('outline').querySelectorAll('li')) {
      li.hidden = q !== '' && !(li.textContent ?? '').toLowerCase().includes(q);
    }
  };
  searchInput.addEventListener('input', () => {
    const v = searchInput.value.trim();
    if (/^wdf:.+#/.test(v)) {
      resolveCitation(v);
      searchInput.value = '';
      applyFilter('');
      return;
    }
    applyFilter(v.toLowerCase());
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (resolveCitation(searchInput.value)) return;
    const first = $('outline').querySelector<HTMLElement>('li:not([hidden]) .ol-label');
    first?.click();
  });
  $('chip-copy').addEventListener('click', () => {
    if (selectedId !== undefined) void copyCitation(selectedId, $('chip-copy'));
  });

  // Ctrl/Cmd+P with a document open prints the document, not the window
  // (plan §10.93). The document frame forwards the same shortcut ('wdf-print').
  paintPrintNotice();
  window.addEventListener('keydown', (e) => {
    if (!isPrintShortcut(e) || loaded === undefined) return;
    e.preventDefault();
    printDocument();
  });

  window.addEventListener('message', (e: MessageEvent) => {
    const data = e.data as { type?: string; id?: string; href?: string } | null;
    if (data === null || typeof data !== 'object') return;
    if (data.type === 'wdf-print') {
      printDocument();
    } else if (data.type === 'wdf-click' && typeof data.id === 'string') {
      select(data.id, 'human');
    } else if (data.type === 'wdf-link' && typeof data.href === 'string') {
      if (/^(https?:\/\/|mailto:)/.test(data.href)) window.open(data.href, '_blank', 'noopener');
    }
  });

  // PWA (plan T8.1): offline shell + OS file handling for .wdf.
  const isHttp = location.protocol === 'https:' || location.protocol === 'http:';
  if (isHttp && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register('sw.js').catch(() => undefined);
  }
  // Install prompt (plan §10.69): Chrome/Edge fire `beforeinstallprompt` when
  // the app is installable. The toolbar button appears only then. The home
  // button is always there (plan §10.80): without a pending prompt it says
  // how to install instead — the event never comes when the Reader is
  // already installed, nor on browsers that cannot install it.
  interface InstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  }
  const installButtons = ['install-home', 'install-app']
    .map((id) => document.getElementById(id))
    .filter((el): el is HTMLButtonElement => el instanceof HTMLButtonElement);
  const runningAsApp =
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true;
  // Home cell: data-install unavailable | available | installed (viewer.css);
  // the toolbar button simply shows or hides.
  const installCell = document.getElementById('install-cell');
  const showInstall = (on: boolean): void => {
    const toolbar = document.getElementById('install-app');
    if (toolbar !== null) toolbar.hidden = !on;
    if (installCell !== null) installCell.dataset['install'] = on ? 'available' : 'unavailable';
  };
  if (runningAsApp && installCell !== null) installCell.dataset['install'] = 'installed';
  const canInstall = 'onbeforeinstallprompt' in window;
  if (canInstall) installCell?.querySelector('.when-unavailable')?.remove();
  const installHelp = document.getElementById('install-help');
  const explainInstall = (): void => {
    if (installHelp === null) return;
    installHelp.textContent = canInstall ? msg().installHere : msg().installElsewhere;
    installHelp.hidden = false;
  };
  onLangChange(() => {
    if (installHelp !== null && !installHelp.hidden) explainInstall();
  });
  let installPrompt: InstallPromptEvent | null = null;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event as InstallPromptEvent;
    if (!runningAsApp) showInstall(true);
  });
  for (const button of installButtons) {
    button.addEventListener('click', () => {
      const pending = installPrompt;
      if (pending === null) {
        explainInstall();
        return;
      }
      if (installHelp !== null) installHelp.hidden = true;
      installPrompt = null;
      showInstall(false);
      void pending
        .prompt()
        .then(() => pending.userChoice)
        .catch(() => undefined);
    });
  }
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    showInstall(false);
    if (installCell !== null) installCell.dataset['install'] = 'installed';
  });
  interface LaunchParamsLike {
    files?: FileSystemHandle[];
  }
  const launchQueue = (
    window as { launchQueue?: { setConsumer(cb: (params: LaunchParamsLike) => void): void } }
  ).launchQueue;
  if (launchQueue !== undefined) {
    launchQueue.setConsumer((params) => {
      const handle = params.files?.[0];
      if (handle !== undefined && handle.kind === 'file') {
        void (handle as FileSystemFileHandle)
          .getFile()
          .then((file) => file.arrayBuffer())
          .then((buf) => {
            openBytes(new Uint8Array(buf), handle.name);
          });
      }
    });
  }

  // Standalone distribution profile (spec §9): embedded package.
  const embedded = document.getElementById('wdf-package');
  if (embedded !== null) {
    // The readable copy and its note (§9.5, §9.7) serve readers that run no
    // script; here the document renders from the package (§9.6) — drop them.
    document.getElementById('wdf-readable')?.remove();
    document.getElementById('wdf-agent-note')?.remove();
    const b64 = (embedded.textContent ?? '').replace(/\s+/g, '');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    openBytes(bytes, 'embedded document');
    return;
  }

  // Hosted viewer convenience: ?doc=<same-site .wdf URL> (user-initiated).
  const doc = new URLSearchParams(location.search).get('doc');
  if (doc !== null && (location.protocol === 'http:' || location.protocol === 'https:')) {
    void fetch(doc)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        openBytes(new Uint8Array(buf), doc);
      })
      .catch((e: unknown) => {
        setZone('read', 'error', () => ({ title: msg().openFailed, body: `${doc}: ${String(e)}` }));
      });
  }
}

init();
