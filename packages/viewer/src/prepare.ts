import {
  parsePaginationExt,
  type WdfCapture,
  type WdfOutline,
  type WdfOutlineNode,
} from '@wdf-dev/core';

/** Pure helpers of the viewer — kept DOM-free so they are unit-testable. */

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  woff2: 'font/woff2',
};

export function mimeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return MIME[ext] ?? 'application/octet-stream';
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function toDataUri(path: string, bytes: Uint8Array): string {
  return `data:${mimeFor(path)};base64,${bytesToBase64(bytes)}`;
}

/**
 * Inlines package resources into the entry document: the stylesheet becomes a
 * <style> element, image sources become data: URIs. The sandboxed frame can
 * then render with zero requests (spec §11.3).
 */
export function inlineResources(html: string, files: ReadonlyMap<string, Uint8Array>): string {
  let out = html.replace(/<link\b[^>]*rel="stylesheet"[^>]*\/?>/, () => {
    const css = files.get('content/styles.css');
    if (css === undefined) return '';
    return `<style>\n${new TextDecoder().decode(css)}\n</style>`;
  });
  out = out.replace(/src="(content\/assets\/[^"]+)"/g, (match, path: string) => {
    const data = files.get(path);
    return data === undefined ? match : `src="${toDataUri(path, data)}"`;
  });
  return out;
}

/**
 * Paper view (WP17, plan §10.26): a true paginated preview — distinct A4
 * sheets on a grey desk, the imported page header/footer repeated on every
 * sheet, "Pag. N di M" labels. Built in-frame by the paginator below; the
 * exported PDF (browser print engine) remains the reference layout.
 */
export const PAGED_CSS = `
  html.wdf-paged body { background: #676d77; padding: 1.5rem 0; }
  .wdf-desk { display: flex; flex-direction: column; align-items: center; }
  .wdf-sheet {
    background: #fff; width: 210mm; height: 297mm; box-sizing: border-box;
    padding: 20mm; overflow: hidden; display: flex; flex-direction: column;
    box-shadow: 0 3px 18px rgba(0, 0, 0, 0.45);
  }
  .wdf-sheet > footer { margin-top: auto; }
  .wdf-sheet-body { flex: 0 1 auto; overflow: hidden; min-height: 0; }
  .wdf-sheet-body > :first-child { margin-top: 0; }
  .wdf-page-label { color: #dfe3ea; font: 12px/1 system-ui, sans-serif; margin: 0.5rem 0 1.4rem; }
  /* Measurement pass: the article at the exact print content width (A4
     minus 20mm margins), so line breaks match the print engine's. */
  article.wdf-measure { width: 170mm !important; max-width: none !important; margin: 0 !important; padding: 0 !important; }
`;

/** Paged-media sheet for print/PDF export (WP10): the browser paginates. */
export const PRINT_CSS = `
  @page { size: A4; margin: 20mm; }
  body { margin: 0; padding: 0; background: #fff; }
  article { max-width: none; margin: 0; }
  h1, h2, h3, h4, h5, h6 { break-after: avoid; }
  figure, tr { break-inside: avoid; }
  thead { display: table-header-group; }
  /* A top-level section (or its h1) starts on a fresh page, like a Word
     section break. Never the first one: the title stays with page one. */
  article > h1:not(:first-child),
  article > section:not(:first-child) { break-before: page; }
  /* Print shell (T14.2, plan §10.25): the imported page header/footer repeat
     on every sheet via the print engine's thead/tfoot repetition — the only
     mechanism that needs no script in the print frame. */
  .wdf-print-shell { width: 100%; border-collapse: collapse; }
  .wdf-print-shell > thead > tr > td,
  .wdf-print-shell > tfoot > tr > td,
  .wdf-print-shell > tbody > tr > td { border: none; padding: 0; background: none; }
  .wdf-print-shell > thead { display: table-header-group; }
  .wdf-print-shell > tfoot { display: table-footer-group; }
  .wdf-print-shell > tbody > tr { break-inside: auto; }
  .wdf-print-body > h1:not(:first-child),
  .wdf-print-body > section:not(:first-child) { break-before: page; }
`;

/** Base typography for packages without a stylesheet, plus selection flash. */
export const BASE_CSS = `
  body { margin: 0; padding: 1.25rem; font: 17px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1a1f2b; }
  article { max-width: 42rem; margin: 0 auto; }
  h1 { line-height: 1.25; } h1, h2, h3 { margin: 1.4em 0 0.5em; }
  table { border-collapse: collapse; margin: 1em 0; width: 100%; }
  caption { text-align: left; font-weight: 600; padding: 0.3em 0; }
  th, td { border: 1px solid #d5d9df; padding: 0.4em 0.6em; text-align: left; }
  th { background: #f3f5f8; }
  figure { margin: 1.2em 0; } img { max-width: 100%; height: auto; }
  figcaption { color: #5b6472; font-size: 0.9em; margin-top: 0.4em; }
  blockquote { margin: 1em 0; padding: 0.2em 1em; border-left: 3px solid #c9d2e0; color: #3c4454; }
  pre { background: #f3f5f8; padding: 0.8em 1em; border-radius: 8px; overflow-x: auto; }
  hr { border: none; border-top: 1px solid #d5d9df; margin: 1.6em 0; }
  a { color: #1a56c4; }
  [id] { scroll-margin-top: 1rem; }
  .wdf-flash { outline: 2px solid #1a56c4; outline-offset: 4px; border-radius: 2px; }
`;

export interface PlanUnit {
  /** Rendered height in px, margins included. */
  h: number;
  /** Must open a fresh sheet (top-level section/h1 start, never the first). */
  breakBefore?: boolean;
  /** Never the last unit of a sheet (headings stay with what follows). */
  keepWithNext?: boolean;
}

/**
 * Pure pagination plan (WP17, plan §10.26): assigns measured units to sheets,
 * mirroring the print rules (fresh page before non-first top-level sections,
 * headings kept with their following block). Returns the index of the first
 * unit of every sheet. Single source of truth: unit-tested here and injected
 * into the frame via toString() — keep it fully self-contained.
 */
export function paginatePlan(units: readonly PlanUnit[], bodyH: number): number[] {
  const starts: number[] = [0];
  let pageStart = 0;
  let used = 0;
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u === undefined) continue;
    let fresh = used > 0 && u.breakBefore === true;
    if (!fresh && used > 0 && used + u.h > bodyH) fresh = true;
    if (fresh) {
      // Pull a trailing keep-with-next chain onto the new sheet — unless the
      // chain is the whole sheet, in which case we give up and break here.
      let j = i;
      while (j > pageStart && units[j - 1]?.keepWithNext === true) j--;
      if (j === pageStart) j = i;
      starts.push(j);
      pageStart = j;
      used = 0;
      for (let k = j; k < i; k++) used += units[k]?.h ?? 0;
    }
    used += u.h;
  }
  return starts;
}

/**
 * In-frame paginator (WP17): measures the article at print content width,
 * plans the sheets with paginatePlan, and rebuilds the document as A4 sheets
 * with the page header/footer cloned onto each. The original article leaves
 * the DOM while paged (so ids stay unique for citations) and is restored
 * intact when the toggle goes off.
 */
export const PAGINATE_JS = `
  var wdfPlan = ${paginatePlan.toString()};
  var wdfPagedState = { token: 0, desk: null, article: null, anchor: null };
  var WDF_MM = 96 / 25.4;
  var WDF_CONTENT_H = (297 - 40) * (96 / 25.4);
  var WDF_SAFETY = 3;

  function wdfMeasureH(el) {
    var cs = getComputedStyle(el);
    return (
      el.getBoundingClientRect().height +
      (parseFloat(cs.marginTop) || 0) +
      (parseFloat(cs.marginBottom) || 0)
    );
  }

  function wdfSplitChildren(el) {
    if (el.tagName === 'TABLE') {
      var rows = el.querySelectorAll(':scope > tbody > tr');
      return rows.length > 1 ? Array.prototype.slice.call(rows) : null;
    }
    if (el.tagName === 'UL' || el.tagName === 'OL') {
      var lis = el.querySelectorAll(':scope > li');
      return lis.length > 1 ? Array.prototype.slice.call(lis) : null;
    }
    return null;
  }

  /* Authored page breaks (ext pagination, docs/ext-pagination.md §6): ids
     injected by buildSrcdoc; a unit breaks when it carries or contains one. */
  var WDF_BREAKS = typeof WDF_AUTHORED_BREAKS !== 'undefined' ? WDF_AUTHORED_BREAKS : [];
  function wdfOwnBreak(node) {
    return WDF_BREAKS.length > 0 && node.id !== '' && WDF_BREAKS.indexOf(node.id) !== -1;
  }
  function wdfHasBreak(node) {
    if (WDF_BREAKS.length === 0) return false;
    if (wdfOwnBreak(node)) return true;
    if (typeof node.querySelector !== 'function') return false;
    for (var i = 0; i < WDF_BREAKS.length; i++) {
      if (node.querySelector('[id="' + WDF_BREAKS[i] + '"]') !== null) return true;
    }
    return false;
  }

  function wdfCollectUnits(article, bodyH) {
    var units = [];
    function pushUnit(node, wrappers, breakBefore) {
      units.push({
        node: node,
        wrappers: wrappers,
        h: wdfMeasureH(node),
        breakBefore: breakBefore === true || wdfHasBreak(node),
        keepWithNext: /^H[1-6]$/.test(node.tagName),
      });
    }
    function walk(el, wrappers, breakBefore) {
      var owns = breakBefore || wdfOwnBreak(el);
      if (el.tagName === 'SECTION') {
        var kids = Array.prototype.slice.call(el.children);
        for (var i = 0; i < kids.length; i++) {
          walk(kids[i], wrappers.concat([el]), owns && i === 0);
        }
        return;
      }
      var parts = wdfMeasureH(el) > bodyH ? wdfSplitChildren(el) : null;
      if (parts !== null) {
        for (var j = 0; j < parts.length; j++) {
          pushUnit(parts[j], wrappers.concat([el]), owns && j === 0);
        }
        return;
      }
      pushUnit(el, wrappers, breakBefore);
    }
    var top = Array.prototype.filter.call(article.children, function (el) {
      return el.tagName !== 'HEADER' && el.tagName !== 'FOOTER';
    });
    for (var i = 0; i < top.length; i++) {
      var el = top[i];
      walk(el, [], i > 0 && (el.tagName === 'SECTION' || el.tagName === 'H1'));
    }
    return units;
  }

  /* Clones a structural shell for continuation on a new sheet: tables keep
     caption/colgroup/thead and get an empty tbody; other wrappers clone
     shallow. */
  function wdfCloneShell(el) {
    if (el.tagName === 'TABLE') {
      var t = el.cloneNode(false);
      var kids = el.children;
      for (var i = 0; i < kids.length; i++) {
        var k = kids[i];
        if (k.tagName === 'CAPTION' || k.tagName === 'COLGROUP' || k.tagName === 'THEAD') {
          t.appendChild(k.cloneNode(true));
        }
      }
      var tb = document.createElement('tbody');
      t.appendChild(tb);
      return { outer: t, slot: tb };
    }
    var c = el.cloneNode(false);
    return { outer: c, slot: c };
  }

  function wdfBuildSheets(units, starts, header, footer) {
    var desk = document.createElement('div');
    desk.className = 'wdf-desk';
    for (var p = 0; p < starts.length; p++) {
      var from = starts[p];
      var to = p + 1 < starts.length ? starts[p + 1] : units.length;
      var sheet = document.createElement('div');
      sheet.className = 'wdf-sheet';
      if (header) sheet.appendChild(header.cloneNode(true));
      var bodyBox = document.createElement('div');
      bodyBox.className = 'wdf-sheet-body';
      sheet.appendChild(bodyBox);
      var chain = [];
      for (var i = from; i < to; i++) {
        var u = units[i];
        var common = 0;
        while (
          common < chain.length &&
          common < u.wrappers.length &&
          chain[common].src === u.wrappers[common]
        ) {
          common++;
        }
        chain.length = common;
        for (var w = common; w < u.wrappers.length; w++) {
          var shell = wdfCloneShell(u.wrappers[w]);
          var host = chain.length > 0 ? chain[chain.length - 1].clone.slot : bodyBox;
          host.appendChild(shell.outer);
          chain.push({ src: u.wrappers[w], clone: shell });
        }
        var slot = chain.length > 0 ? chain[chain.length - 1].clone.slot : bodyBox;
        slot.appendChild(u.node.cloneNode(true));
      }
      if (footer) sheet.appendChild(footer.cloneNode(true));
      desk.appendChild(sheet);
      var label = document.createElement('div');
      label.className = 'wdf-page-label';
      label.textContent = 'Pag. ' + (p + 1) + ' di ' + starts.length;
      desk.appendChild(label);
    }
    return desk;
  }

  /* Structural clones (header/footer per sheet, continued shells) would
     duplicate ids: only the first occurrence keeps it, so citations and
     scrolling stay unambiguous. */
  function wdfDedupIds(desk) {
    var seen = {};
    var all = desk.querySelectorAll('[id]');
    for (var i = 0; i < all.length; i++) {
      var id = all[i].id;
      if (seen[id]) all[i].removeAttribute('id');
      else seen[id] = true;
    }
  }

  function wdfImagesReady(scope) {
    var imgs = Array.prototype.slice.call(scope.querySelectorAll('img'));
    return Promise.all(
      imgs.map(function (im) {
        if (im.complete) return null;
        return new Promise(function (res) {
          im.addEventListener('load', res);
          im.addEventListener('error', res);
        });
      })
    );
  }

  function wdfSetPaged(on) {
    var token = ++wdfPagedState.token;
    document.documentElement.classList.toggle('wdf-paged', on);
    if (!on) {
      if (wdfPagedState.desk) {
        wdfPagedState.desk.remove();
        wdfPagedState.desk = null;
      }
      if (wdfPagedState.article && wdfPagedState.anchor) {
        wdfPagedState.anchor.parentNode.insertBefore(wdfPagedState.article, wdfPagedState.anchor);
        wdfPagedState.anchor.remove();
        wdfPagedState.article = null;
        wdfPagedState.anchor = null;
      }
      return;
    }
    var article = document.querySelector('article');
    if (!article || wdfPagedState.desk) return;
    var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    fontsReady
      .then(function () {
        return wdfImagesReady(article);
      })
      .then(function () {
        if (token !== wdfPagedState.token) return;
        article.classList.add('wdf-measure');
        var header = null;
        var footer = null;
        var first = article.firstElementChild;
        var last = article.lastElementChild;
        if (first && first.tagName === 'HEADER') header = first;
        if (last && last.tagName === 'FOOTER') footer = last;
        var bodyH =
          WDF_CONTENT_H -
          (header ? wdfMeasureH(header) : 0) -
          (footer ? wdfMeasureH(footer) : 0) -
          WDF_SAFETY;
        var units = wdfCollectUnits(article, bodyH);
        var starts = wdfPlan(
          units.map(function (u) {
            return { h: u.h, breakBefore: u.breakBefore, keepWithNext: u.keepWithNext };
          }),
          bodyH
        );
        var desk = wdfBuildSheets(units, starts, header, footer);
        article.classList.remove('wdf-measure');
        wdfDedupIds(desk);
        var anchor = document.createComment('wdf-article');
        article.parentNode.insertBefore(anchor, article);
        article.remove();
        wdfPagedState.article = article;
        wdfPagedState.anchor = anchor;
        document.body.appendChild(desk);
        wdfPagedState.desk = desk;
      });
  }
`;

/** Controller injected into the sandboxed frame (the only script its CSP allows). */
export const CONTROLLER_JS = `
  document.addEventListener('click', function (e) {
    var target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    var ext = target.closest('a[href^="http"], a[href^="mailto:"]');
    if (ext) {
      e.preventDefault();
      parent.postMessage({ type: 'wdf-link', href: ext.getAttribute('href') }, '*');
      return;
    }
    var el = target.closest('[id]');
    if (el) parent.postMessage({ type: 'wdf-click', id: el.id }, '*');
  });
  addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type === 'wdf-paged') {
      wdfSetPaged(d.on === true);
      return;
    }
    if (d.type === 'wdf-scroll' && typeof d.id === 'string') {
      var t = document.getElementById(d.id);
      if (t) {
        t.scrollIntoView({ behavior: 'smooth', block: 'start' });
        t.classList.add('wdf-flash');
        setTimeout(function () { t.classList.remove('wdf-flash'); }, 1400);
      }
    }
  });
`;

/**
 * The fonts extension's @font-face sheet (WP9, docs/ext-fonts.md) with the
 * packaged woff2 files inlined as data: URIs, or undefined when absent.
 */
export function fontsCss(files: ReadonlyMap<string, Uint8Array>): string | undefined {
  const sheet = files.get('ext/fonts/fonts.css');
  if (sheet === undefined) return undefined;
  return new TextDecoder()
    .decode(sheet)
    .replace(/url\("(ext\/fonts\/[^"]+)"\)/g, (match, path: string) => {
      const bytes = files.get(path);
      return bytes === undefined ? match : `url("${toDataUri(path, bytes)}")`;
    });
}

/**
 * Builds the sandboxed srcdoc: restrictive CSP (only the nonce'd controller
 * may run — the profile already forbids scripts, this is defense in depth),
 * base styles, inlined resources, embedded fonts, controller (spec §11.1).
 */
export function buildSrcdoc(
  entryHtml: string,
  files: ReadonlyMap<string, Uint8Array>,
  nonce: string,
): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; script-src 'nonce-${nonce}'" />`;
  let out = inlineResources(entryHtml, files);
  const fonts = fontsCss(files);
  const fontStyle = fonts === undefined ? '' : `<style>${fonts}</style>`;
  out = out.replace(
    /<head([^>]*)>/,
    (match) => `${match}${csp}<style>${BASE_CSS}</style><style>${PAGED_CSS}</style>${fontStyle}`,
  );
  // Authored page breaks (ext pagination): the Paper paginator honors them.
  const breaks = parsePaginationExt(files)?.breakBefore ?? [];
  const breaksVar = `var WDF_AUTHORED_BREAKS = ${JSON.stringify(breaks)};`;
  const controller = `<script nonce="${nonce}">${breaksVar}${PAGINATE_JS}${CONTROLLER_JS}</script>`;
  out = out.includes('</body>') ? out.replace('</body>', `${controller}</body>`) : out + controller;
  return out;
}

/**
 * Print shell (T14.2, plan §10.25): when the document carries a page header
 * (first child of <article>) and/or footer (last child) imported by T14.1,
 * the print document wraps the content in a single table whose thead/tfoot
 * the print engine repeats on every sheet. Presentation only, print only:
 * documents without header/footer pass through byte-identical.
 */
export function wrapPrintShell(html: string): string {
  const openTag = '<article>';
  const open = html.indexOf(openTag);
  const close = html.lastIndexOf('</article>');
  if (open === -1 || close === -1) return html;
  let rest = html.slice(open + openTag.length, close);

  let header = '';
  const h = /^\s*<header>[\s\S]*?<\/header>/.exec(rest);
  if (h !== null) {
    header = h[0];
    rest = rest.slice(h[0].length);
  }
  let footer = '';
  const footerAt = rest.lastIndexOf('<footer>');
  if (footerAt !== -1 && /^<footer>[\s\S]*<\/footer>\s*$/.test(rest.slice(footerAt))) {
    footer = rest.slice(footerAt);
    rest = rest.slice(0, footerAt);
  }
  if (header === '' && footer === '') return html;

  const shell =
    '<table class="wdf-print-shell">' +
    (header === '' ? '' : `<thead><tr><td>${header}</td></tr></thead>`) +
    `<tbody><tr><td class="wdf-print-body">${rest}</td></tr></tbody>` +
    (footer === '' ? '' : `<tfoot><tr><td>${footer}</td></tr></tfoot>`) +
    '</table>';
  return html.slice(0, open + openTag.length) + shell + html.slice(close);
}

/**
 * Builds the print/PDF document (WP10, plan §10.20): inlined resources,
 * base styles, embedded fonts, and the paged-media sheet — no controller,
 * and a CSP with no script-src at all. Rendered in a dedicated frame
 * without allow-scripts; the browser's print engine does the pagination.
 */
/**
 * Authored page breaks (extension `pagination` 0.1, docs/ext-pagination.md
 * §6): CSS rules forcing a page before each referenced element. Unknown ids
 * simply match nothing — consumers skip them (§10.3).
 */
export function authoredBreakCss(files: ReadonlyMap<string, Uint8Array>): string {
  const pagination = parsePaginationExt(files);
  if (pagination === undefined || pagination.breakBefore.length === 0) return '';
  return pagination.breakBefore.map((id) => `[id="${id}"] { break-before: page; }`).join('\n');
}

export function buildPrintSrcdoc(
  entryHtml: string,
  files: ReadonlyMap<string, Uint8Array>,
): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:" />`;
  const out = wrapPrintShell(inlineResources(entryHtml, files));
  const fonts = fontsCss(files);
  const fontStyle = fonts === undefined ? '' : `<style>${fonts}</style>`;
  const breaks = authoredBreakCss(files);
  const breakStyle = breaks === '' ? '' : `<style>${breaks}</style>`;
  return out.replace(
    /<head([^>]*)>/,
    (match) =>
      `${match}${csp}<style>${BASE_CSS}</style>${fontStyle}<style>${PRINT_CSS}</style>${breakStyle}`,
  );
}

// ---------------------------------------------------------------------------
// `source` extension (WP13, docs/ext-source.md)

export interface SourceExt {
  /** How the original was obtained (v0.3/0.4): absent means "fetched-html". */
  kind: 'fetched-html' | 'dom-snapshot' | 'binary';
  main: string;
  mainName: string;
  encoding: string;
  /** IANA media type of a binary original, when declared (v0.4). */
  mediaType?: string;
  resources: Record<string, string>;
  /** Original stylesheet href → embedded ext/source/*.css (WP15, v0.2). */
  stylesheets: Record<string, string>;
}

/** Reads ext/source/source.json, or undefined when absent or malformed. */
export function parseSourceExt(files: ReadonlyMap<string, Uint8Array>): SourceExt | undefined {
  const raw = files.get('ext/source/source.json');
  if (raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as {
      kind?: unknown;
      main?: unknown;
      mainName?: unknown;
      encoding?: unknown;
      mediaType?: unknown;
      resources?: unknown;
      stylesheets?: unknown;
    };
    if (typeof parsed.main !== 'string' || !files.has(parsed.main)) return undefined;
    const stringMap = (value: unknown): Record<string, string> => {
      const out: Record<string, string> = {};
      if (typeof value === 'object' && value !== null) {
        for (const [k, v] of Object.entries(value)) {
          if (typeof v === 'string') out[k] = v;
        }
      }
      return out;
    };
    const ext: SourceExt = {
      kind:
        parsed.kind === 'dom-snapshot' || parsed.kind === 'binary' ? parsed.kind : 'fetched-html',
      main: parsed.main,
      mainName: typeof parsed.mainName === 'string' ? parsed.mainName : '',
      encoding: typeof parsed.encoding === 'string' ? parsed.encoding : 'utf-8',
      resources: stringMap(parsed.resources),
      stylesheets: stringMap(parsed.stylesheets),
    };
    if (typeof parsed.mediaType === 'string') ext.mediaType = parsed.mediaType;
    return ext;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// `capture` extension (WP18, docs/ext-capture.md): the viewer states the
// nature of a live-page capture next to the badge, and exposes the full
// provenance in the verification details (§6 of the extension spec).

/** The one-line nature note shown next to the verification badge. */
export function captureNote(c: WdfCapture): string {
  return `captured from live page on ${c.capturedAt}`;
}

/** The verification-panel lines for capture provenance. */
export function captureDetails(c: WdfCapture): string[] {
  const dpr = c.viewport.devicePixelRatio;
  return [
    `Capture: ${c.mode === 'article' ? 'extracted article' : 'full page'} from a live, rendered page — integrity is not authenticity (§11.4)`,
    `Captured URL: ${c.url}`,
    `Captured at: ${c.capturedAt}`,
    `User agent: ${c.userAgent}`,
    `Viewport: ${String(c.viewport.width)}×${String(c.viewport.height)}${dpr === undefined ? '' : ` @${String(dpr)}x`}`,
  ];
}

/**
 * Details of a binary original (ext-source 0.4) for the download-only
 * Original view: there is nothing to render, the viewer presents metadata
 * and offers the embedded bytes (docs/ext-source.md, consumer guidance).
 */
export function binarySourceDetails(
  files: ReadonlyMap<string, Uint8Array>,
  ext: SourceExt,
): { fileName: string; mediaType: string; sizeLabel: string } | undefined {
  const bytes = files.get(ext.main);
  if (bytes === undefined) return undefined;
  const units = ['bytes', 'KB', 'MB'];
  let size = bytes.length;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return {
    fileName: ext.mainName !== '' ? ext.mainName : (ext.main.split('/').pop() ?? 'original'),
    mediaType: ext.mediaType ?? 'unknown type',
    sizeLabel: `${unit === 0 ? String(size) : size.toFixed(1)} ${units[unit] ?? ''}`.trim(),
  };
}

/**
 * Builds the srcdoc for the "Original" view: the embedded source decoded
 * with its declared encoding, mapped resources inlined as data: URIs, the
 * same no-network CSP — and deliberately NO injected styling or controller:
 * the point of the view is the untouched original (docs/ext-source.md).
 */
export function buildOriginalSrcdoc(
  files: ReadonlyMap<string, Uint8Array>,
  ext: SourceExt,
): string {
  const bytes = files.get(ext.main) ?? new Uint8Array();
  let html: string;
  try {
    html = new TextDecoder(ext.encoding).decode(bytes);
  } catch {
    html = new TextDecoder().decode(bytes);
  }
  for (const [original, path] of Object.entries(ext.resources)) {
    const data = files.get(path);
    if (data === undefined) continue;
    // Keys hold the DECODED src; the raw markup may entity-encode "&"
    // (same tolerance as the stylesheet hrefs below).
    const escaped = original
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .split('&')
      .join('&(?:amp;)?');
    html = html.replace(
      new RegExp(`src="${escaped}"`, 'g'),
      () => `src="${toDataUri(path, data)}"`,
    );
  }
  // A srcset would override the inlined src with remote candidates the CSP
  // blocks — drop it (and lazy loading) so the Original renders offline.
  html = html.replace(/\s+srcset="[^"]*"/gi, '').replace(/\s+loading="lazy"/gi, '');
  // WP15 (v0.2): the embedded stylesheets replace their <link> elements.
  // Keys hold the DECODED href; the raw markup may entity-encode "&".
  for (const [href, path] of Object.entries(ext.stylesheets)) {
    const data = files.get(path);
    if (data === undefined) continue;
    const style = `<style>${new TextDecoder().decode(data)}</style>`;
    const escaped = href
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .split('&')
      .join('&(?:amp;)?');
    html = html.replace(new RegExp(`<link\\b[^>]*href=["']${escaped}["'][^>]*>`, 'g'), () => style);
  }
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'" />`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, (match) => `${match}${csp}`);
  }
  return csp + html;
}

export interface AgentBlock {
  text: string;
  ids: string[];
}

/** Splits ai/content.md into its blocks, each tagged with the anchor ids it carries. */
export function agentBlocks(markdown: string): AgentBlock[] {
  const body = markdown.endsWith('\n') ? markdown.slice(0, -1) : markdown;
  if (body === '') return [];
  return body.split('\n\n').map((text) => ({
    text,
    ids: [...text.matchAll(/\{#([a-z]+-[a-z0-9-]*)\}/g)].map((m) => m[1] ?? ''),
  }));
}

export interface OutlineTreeNode {
  node: WdfOutlineNode;
  children: OutlineTreeNode[];
}

/** Rebuilds the tree from the flat parent-linked outline (spec §7.8). */
export function outlineTree(outline: WdfOutline): OutlineTreeNode[] {
  const byId = new Map<string, OutlineTreeNode>();
  const roots: OutlineTreeNode[] = [];
  for (const node of outline) {
    const treeNode: OutlineTreeNode = { node, children: [] };
    byId.set(node.id, treeNode);
    const parent = node.parent === null ? undefined : byId.get(node.parent);
    if (parent === undefined) roots.push(treeNode);
    else parent.children.push(treeNode);
  }
  return roots;
}

/** Citation URI per spec §7.10. */
export function citation(documentId: string, elementId: string): string {
  return `wdf:${documentId}#${elementId}`;
}
