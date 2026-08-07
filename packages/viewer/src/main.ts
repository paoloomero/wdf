import {
  readPackage,
  validateDatasets,
  validateProfile,
  validateStylesheet,
  verifyPackage,
  WdfError,
  type Violation,
  type WdfOutline,
  type WdfPackage,
} from '@wdf/core';

import { convertFiles } from './convert.js';
import {
  agentBlocks,
  buildOriginalSrcdoc,
  buildPrintSrcdoc,
  buildSrcdoc,
  citation,
  outlineTree,
  parseSourceExt,
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
}

let loaded: Loaded | undefined;
let selectedId: string | undefined;
// Paper view (WP10): rendering-only A4 sheet look for the Human view.
let paged = false;

// ---------------------------------------------------------------------------
// Opening packages

function showDropError(message: string): void {
  const box = $('drop-error');
  box.textContent = message;
  box.hidden = false;
}

// ---------------------------------------------------------------------------
// In-browser converter (T7.6, plan §10.24): an HTML export dropped on the
// Reader converts to .wdf fully client-side — no upload, no network requests.

// The last dropped file set, kept so toggling options re-runs the conversion.
let droppedSet: Map<string, Uint8Array> | undefined;
let convertedBytes: Uint8Array | undefined;
let convertedName = 'document.wdf';
let downloadUrl: string | undefined;

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

/** A dropped .wdf opens as before; anything else goes to the converter. */
async function handleDropped(files: Map<string, Uint8Array>): Promise<void> {
  const wdf = [...files.keys()].sort().find((p) => /\.wdf$/i.test(p));
  if (wdf !== undefined) {
    const bytes = files.get(wdf);
    if (bytes !== undefined) openBytes(bytes, wdf.split('/').pop() ?? wdf);
    return;
  }
  droppedSet = files;
  await runConvert();
}

async function runConvert(): Promise<void> {
  if (droppedSet === undefined) return;
  $('drop-error').hidden = true;
  const withSource = ($('convert-source') as HTMLInputElement).checked;
  let result;
  try {
    result = await convertFiles(droppedSet, withSource ? { withSource: true } : {});
  } catch (e) {
    $('convert-panel').hidden = true;
    showDropError(String(e));
    return;
  }
  if (result === undefined) {
    $('convert-panel').hidden = true;
    showDropError('no representable content found in the input');
    return;
  }

  convertedBytes = result.wdfBytes;
  convertedName = result.fileName;
  $('convert-title').textContent = `${result.title} → ${result.fileName}`;
  const list = $('convert-report');
  list.textContent = '';
  for (const line of result.report) {
    const li = document.createElement('li');
    li.textContent = line;
    list.append(li);
  }
  if (downloadUrl !== undefined) URL.revokeObjectURL(downloadUrl);
  downloadUrl = URL.createObjectURL(
    new Blob([result.wdfBytes.slice().buffer], { type: 'application/wdf+zip' }),
  );
  const download = $('convert-download') as HTMLAnchorElement;
  download.href = downloadUrl;
  download.download = result.fileName;
  $('convert-panel').hidden = false;
}

function openBytes(bytes: Uint8Array, name: string): void {
  let pkg: WdfPackage;
  try {
    pkg = readPackage(bytes);
  } catch (e) {
    showDropError(e instanceof WdfError ? e.message : String(e));
    return;
  }
  try {
    const markdown = dec.decode(pkg.files.get('ai/content.md') ?? new Uint8Array());
    const outline = JSON.parse(
      dec.decode(pkg.files.get('ai/outline.json') ?? new Uint8Array()),
    ) as WdfOutline;
    loaded = { pkg, outline, markdown, sourceExt: parseSourceExt(pkg.files) };
  } catch (e) {
    showDropError(`unreadable AI layer: ${String(e)}`);
    return;
  }

  $('drop-screen').hidden = true;
  $('app').hidden = false;
  document.title = `${pkg.manifest.title} — WDF`;
  $('doc-title').textContent = pkg.manifest.title;
  $('doc-title').title = name;

  renderHuman(loaded);
  renderAgent(loaded);
  renderOriginal(loaded);
  renderOutline(loaded);
  setView('human');
  void verify(loaded);
}

function renderHuman(doc: Loaded): void {
  const entry = dec.decode(doc.pkg.files.get(doc.pkg.manifest.entry) ?? new Uint8Array());
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  ($('human') as HTMLIFrameElement).srcdoc = buildSrcdoc(entry, doc.pkg.files, nonce);
}

// Print / export as PDF (WP10): a dedicated script-less frame with the
// paged-media sheet; the browser's print engine does the pagination.
function exportPdf(): void {
  if (loaded === undefined) return;
  const entry = dec.decode(loaded.pkg.files.get(loaded.pkg.manifest.entry) ?? new Uint8Array());
  const frame = $('print-frame') as HTMLIFrameElement;
  frame.onload = () => {
    frame.contentWindow?.print();
  };
  frame.srcdoc = buildPrintSrcdoc(entry, loaded.pkg.files);
}

function setPaged(on: boolean): void {
  paged = on;
  $('paged-toggle').classList.toggle('active', on);
  postToHuman({ type: 'wdf-paged', on });
}

// "Original" view (WP13): the embedded source, shown untouched. The toggle
// only appears when the package carries the `source` extension.
function renderOriginal(doc: Loaded): void {
  const frame = $('original') as HTMLIFrameElement;
  const button = $('view-original');
  if (doc.sourceExt === undefined) {
    button.hidden = true;
    frame.srcdoc = '';
    return;
  }
  button.hidden = false;
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
      label.append(type, document.createTextNode(node.title ?? node.id));
      label.title = node.id;
      label.addEventListener('click', () => {
        select(node.id, 'outline');
      });

      const cite = document.createElement('button');
      cite.className = 'ol-cite';
      cite.textContent = '❞';
      cite.title = `Copy citation for ${node.id}`;
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
}

// ---------------------------------------------------------------------------
// Verification badge (T4.2)

async function verify(doc: Loaded): Promise<void> {
  const badge = $('badge');
  const label = $('badge-label');
  const list = $('details-list');
  list.textContent = '';
  const add = (text: string, cls: string): void => {
    const li = document.createElement('li');
    li.className = cls;
    li.textContent = text;
    list.append(li);
  };

  try {
    const result = await verifyPackage(doc.pkg);
    badge.className = result.verified ? 'badge badge-ok' : 'badge badge-bad';
    label.textContent = result.verified ? 'verified' : 'tampered';
    add(
      result.integrity
        ? 'Integrity: every file matches its SHA-256 digest (§8.2)'
        : 'Integrity: FAILED',
      result.integrity ? 'ok' : 'bad',
    );
    add(
      result.determinism
        ? 'Determinism: the AI layer is the canonical extraction of the content (§7.1)'
        : 'Determinism: FAILED',
      result.determinism ? 'ok' : 'bad',
    );
    for (const p of result.problems) add(`[${p.spec}] ${p.path} — ${p.message}`, 'bad');

    const entry = dec.decode(doc.pkg.files.get(doc.pkg.manifest.entry) ?? new Uint8Array());
    const violations: Violation[] = [...validateProfile(entry), ...validateDatasets(doc.pkg)];
    const styles = doc.pkg.files.get('content/styles.css');
    if (styles !== undefined) violations.push(...validateStylesheet(dec.decode(styles)));
    const errors = violations.filter((v) => v.severity === 'error');
    if (errors.length > 0 && result.verified) {
      badge.className = 'badge badge-warn';
      label.textContent = 'profile errors';
    }
    for (const v of violations) {
      add(
        `[${v.spec}] ${v.severity === 'warning' ? 'warning: ' : ''}${v.path} — ${v.message}`,
        v.severity === 'warning' ? '' : 'bad',
      );
    }
    if (errors.length === 0) add('WDF-HTML profile: conforming (§6)', 'ok');
  } catch (e) {
    badge.className = 'badge badge-warn';
    label.textContent = 'not verifiable';
    add(`Verification failed to run: ${String(e)}`, 'bad');
  }
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
    window.prompt('Copy citation:', text);
  }
}

// ---------------------------------------------------------------------------
// Wiring

function setView(view: 'human' | 'agent' | 'original'): void {
  $('human').hidden = view !== 'human';
  $('agent').hidden = view !== 'agent';
  $('original').hidden = view !== 'original';
  $('view-human').classList.toggle('active', view === 'human');
  $('view-agent').classList.toggle('active', view === 'agent');
  $('view-original').classList.toggle('active', view === 'original');
  // Paper and PDF act on the document rendering: available only where they
  // apply (the Human view). The paper state itself survives view switches.
  ($('paged-toggle') as HTMLButtonElement).disabled = view !== 'human';
  ($('pdf-export') as HTMLButtonElement).disabled = view !== 'human';
  if (view === 'agent' && selectedId !== undefined) select(selectedId, 'outline');
}

function init(): void {
  const dropCard = $('drop-card');
  const fileInput = $('file-input') as HTMLInputElement;

  fileInput.addEventListener('change', () => {
    const files = fileInput.files;
    if (files !== null && files.length > 0) {
      void fileListToMap(files).then(handleDropped);
    }
  });
  for (const eventName of ['dragover', 'dragenter'] as const) {
    dropCard.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropCard.classList.add('dragover');
    });
  }
  dropCard.addEventListener('dragleave', () => {
    dropCard.classList.remove('dragover');
  });
  dropCard.addEventListener('drop', (e) => {
    e.preventDefault();
    dropCard.classList.remove('dragover');
    const dt = e.dataTransfer;
    if (dt === null) return;
    // webkitGetAsEntry must be taken synchronously, before the event ends;
    // it is the only way to receive dropped folders (Word's _files/.fld).
    const entries = [...dt.items].map(entryOf).filter((en) => en !== null);
    if (entries.length > 0) {
      void (async () => {
        const map = new Map<string, Uint8Array>();
        for (const entry of entries) await readEntry(entry, '', map);
        await handleDropped(map);
      })();
    } else {
      void fileListToMap(dt.files).then(handleDropped);
    }
  });
  $('convert-open').addEventListener('click', () => {
    if (convertedBytes !== undefined) openBytes(convertedBytes, convertedName);
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
  $('pdf-export').addEventListener('click', () => {
    exportPdf();
  });
  // A reloaded Human frame starts unpaged: re-apply the paper view.
  $('human').addEventListener('load', () => {
    if (paged) postToHuman({ type: 'wdf-paged', on: true });
  });
  $('sidebar-toggle').addEventListener('click', () => {
    $('app').classList.toggle('sidebar-open');
  });
  // The outline column starts open on desktop, closed (overlay) on mobile.
  if (window.matchMedia('(min-width: 761px)').matches) {
    $('app').classList.add('sidebar-open');
  }
  $('badge').addEventListener('click', () => {
    $('details-panel').hidden = false;
  });
  $('details-close').addEventListener('click', () => {
    $('details-panel').hidden = true;
  });
  $('chip-copy').addEventListener('click', () => {
    if (selectedId !== undefined) void copyCitation(selectedId, $('chip-copy'));
  });

  window.addEventListener('message', (e: MessageEvent) => {
    const data = e.data as { type?: string; id?: string; href?: string } | null;
    if (data === null || typeof data !== 'object') return;
    if (data.type === 'wdf-click' && typeof data.id === 'string') {
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
        showDropError(`cannot load ${doc}: ${String(e)}`);
      });
  }
}

init();
