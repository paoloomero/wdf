import {
  elementChildren,
  findChild,
  getAttr,
  isElement,
  normalizedText,
  type WdfElement,
  type WdfNode,
} from '@wdf/core';

/**
 * Word page headers/footers (T14.1, plan §10.21): the full "Web Page"
 * export stores them in `<name>.fld/header.html`, marked with
 * `mso-element:header` / `mso-element:footer` divs. Their content (logo,
 * title, references) is real information and is imported ONCE as
 * `<header>`/`<footer>` of the article; page-number fields are page
 * artifacts and are dropped — WDF is page-agnostic by design.
 */

/**
 * Prepares raw header.html for parsing: reveals VML conditional comments
 * (header images have no revealed `<img>` fallback, unlike the main
 * document) and removes PAGE/NUMPAGES fields entirely — markers, code and
 * rendered result. Other fields keep their visible result untouched.
 */
export function preprocessHeaderHtml(html: string): string {
  let out = html.replace(
    /<!--\[if supportFields\]>[\s\S]*?field-begin[\s\S]*?<!\[endif\]-->([\s\S]*?)<!--\[if supportFields\]>[\s\S]*?field-end[\s\S]*?<!\[endif\]-->/g,
    (segment) => (/\b(?:PAGE|NUMPAGES)\b/.test(segment) ? '' : segment),
  );
  out = out.replace(/<!--\[if gte vml 1\]>([\s\S]*?)<!\[endif\]-->/g, '$1');
  return out;
}

/** Directory of the Word support folder, from the main file's File-List link. */
export function findFileListDir(root: WdfElement): string | undefined {
  const head = findChild(root, 'head');
  if (head === undefined) return undefined;
  for (const child of elementChildren(head)) {
    if (child.tag !== 'link') continue;
    if ((getAttr(child, 'rel') ?? '').toLowerCase() !== 'file-list') continue;
    const href = getAttr(child, 'href') ?? '';
    const slash = href.lastIndexOf('/');
    if (slash > 0) return href.slice(0, slash);
  }
  return undefined;
}

function hasImagery(el: WdfElement): boolean {
  if (el.tag === 'img' || el.tag === 'v:imagedata') return true;
  return el.children.some((c) => isElement(c) && hasImagery(c));
}

function isMeaningful(el: WdfElement): boolean {
  return normalizedText(el).replace(/[\s ]/g, '') !== '' || hasImagery(el);
}

/**
 * Picks the header and footer divs to import. Word emits per-section
 * variants (`h1` default, `fh1` first page, `eh1` even pages); the
 * first-page variant is preferred — for letters and reports it carries
 * the letterhead — falling back to the default, then to the first
 * meaningful div of the kind.
 */
export function selectPageParts(headerRoot: WdfElement): {
  header: WdfElement | undefined;
  footer: WdfElement | undefined;
} {
  const divs: { kind: 'header' | 'footer'; id: string; el: WdfElement }[] = [];
  const walk = (el: WdfElement): void => {
    const style = getAttr(el, 'style') ?? '';
    const m = /mso-element:\s*(header|footer)\s*(?:;|$|')/.exec(style);
    if (m !== null && isMeaningful(el)) {
      divs.push({ kind: m[1] as 'header' | 'footer', id: getAttr(el, 'id') ?? '', el });
    }
    for (const child of elementChildren(el)) walk(child);
  };
  walk(headerRoot);

  const pick = (kind: 'header' | 'footer'): WdfElement | undefined => {
    const ofKind = divs.filter((d) => d.kind === kind);
    const firstPage = ofKind.find((d) => /^f?[hf]\d/.test(d.id) && d.id.startsWith('f'));
    const dflt = ofKind.find((d) => !d.id.startsWith('e') && !d.id.startsWith('f'));
    return (firstPage ?? dflt ?? ofKind[0])?.el;
  };
  return { header: pick('header'), footer: pick('footer') };
}

/**
 * True for text that is only page-counter residue once the fields are
 * gone — connector words ("di", "of", "Pag."), digits, slashes, dashes.
 */
export function isPageResidue(text: string): boolean {
  const stripped = text
    .replace(/\b(?:pagina|pag|page|di|of)\b\.?/gi, '')
    .replace(/[\s 0-9/.\-–—]/g, '');
  return stripped === '';
}

/** Every WdfNode of the tree, for asset-source rewriting by the caller. */
export function walkElements(root: WdfNode, visit: (el: WdfElement) => void): void {
  if (!isElement(root)) return;
  visit(root);
  for (const child of root.children) walkElements(child, visit);
}
