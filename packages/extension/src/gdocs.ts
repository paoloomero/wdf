// Site-aware capture: Google Docs (T18.9, plan §10.43). The Docs editor
// renders on canvas — the DOM does not contain the document — so on
// docs.google.com the extension uses the OFFICIAL export endpoint with
// the user's own session instead of a DOM snapshot: one same-origin fetch
// of the "web page, zipped" export (HTML + images), zero new permissions,
// no reverse engineering of Google's internal model.
import { unzipSync } from 'fflate';

/** True when the URL is a Google Docs document page (popup detection). */
export function isGoogleDocsUrl(pageUrl: string): boolean {
  try {
    const url = new URL(pageUrl);
    return url.hostname === 'docs.google.com' && /^\/document\/d\/[^/]+/.test(url.pathname);
  } catch {
    return false;
  }
}

/**
 * Export-ZIP URL for a document path. Host-agnostic on purpose: the
 * content script builds it from its own location (the e2e fixture serves
 * the same path shape on localhost), while the popup gates on
 * isGoogleDocsUrl above.
 */
export function exportUrlFromLocation(origin: string, pathname: string): string | undefined {
  const match = /^\/document\/d\/([^/]+)/.exec(pathname);
  return match === null ? undefined : `${origin}/document/d/${match[1] ?? ''}/export?format=zip`;
}

export interface GdocsExport {
  /** The exported HTML, decoded (the export is UTF-8). */
  html: string;
  /** Bytes of the HTML file, verbatim — the `source` original. */
  htmlBytes: Uint8Array;
  /** Original file name inside the export zip. */
  htmlName: string;
  /** Every other entry (images/...), keyed by its zip path. */
  files: Map<string, Uint8Array>;
}

/** Unpacks the "web page, zipped" export: one HTML plus its images. */
export function prepareGdocsExport(zipBytes: Uint8Array): GdocsExport {
  const entries = unzipSync(zipBytes);
  let htmlName: string | undefined;
  const files = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(entries)) {
    if (name.endsWith('/')) continue;
    if (htmlName === undefined && name.toLowerCase().endsWith('.html')) {
      htmlName = name;
    } else {
      files.set(name, bytes);
    }
  }
  if (htmlName === undefined) throw new Error('no HTML file in the Google Docs export zip');
  const htmlBytes = entries[htmlName] ?? new Uint8Array();
  return {
    html: new TextDecoder('utf-8').decode(htmlBytes),
    htmlBytes,
    htmlName,
    files,
  };
}
