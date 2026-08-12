import { getAttr, isElement, type WdfDocument, type WdfElement, type WdfNode } from '@wdf-dev/core';

/**
 * Embed placeholders for dom-snapshot conversions (T18.4, ext-capture §5):
 * a live page may embed content the profile forbids by design (iframe,
 * video, audio — a cross-origin player's inner document is inaccessible to
 * the capturing context anyway). Each embed becomes a placeholder that
 * PRESERVES the embed URL — a figure when a poster image is available, a
 * paragraph with the same link otherwise (§6.2.6 requires an img inside
 * figure). In-place loading is deliberately not offered: the no-network
 * rule is foundational (core §11.3).
 */

export interface EmbedPlaceholderOptions {
  /** Base for resolving relative embed/poster URLs (the page's baseURI). */
  baseUrl: string;
  /** Whether a poster URL has captured bytes (the conversion's image map). */
  hasPoster: (url: string) => boolean;
}

const EMBED_TAGS = new Set(['iframe', 'video', 'audio', 'embed', 'object']);

const LABELS: Record<string, string> = {
  video: 'Video',
  audio: 'Audio',
};

/** Resolves a raw attribute URL; only http(s) is linkable (§6.3.2). */
function linkable(raw: string | undefined, baseUrl: string): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  try {
    const url = new URL(raw, baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function embedUrl(el: WdfElement, baseUrl: string): string | undefined {
  const own = linkable(getAttr(el, 'src') ?? getAttr(el, 'data'), baseUrl);
  if (own !== undefined) return own;
  for (const child of el.children) {
    if (isElement(child) && child.tag === 'source') {
      const src = linkable(getAttr(child, 'src'), baseUrl);
      if (src !== undefined) return src;
    }
  }
  return undefined;
}

const text = (t: string): WdfNode => ({ kind: 'text', text: t });

const element = (tag: string, attrs: [string, string][], children: WdfNode[]): WdfElement => ({
  kind: 'element',
  tag,
  attrs: attrs.map(([name, value]) => ({ name, value })),
  children,
});

function placeholder(el: WdfElement, url: string, opts: EmbedPlaceholderOptions): WdfElement {
  const label = LABELS[el.tag] ?? 'Embedded content';
  const host = new URL(url).host;
  const link = element('a', [['href', url]], [text(`Open on ${host}`)]);
  const poster = el.tag === 'video' ? linkable(getAttr(el, 'poster'), opts.baseUrl) : undefined;
  if (poster !== undefined && opts.hasPoster(poster)) {
    return element(
      'figure',
      [],
      [
        element(
          'img',
          [
            ['src', poster],
            ['alt', `${label} preview`],
          ],
          [],
        ),
        element('figcaption', [], [text(`${label} — `), link]),
      ],
    );
  }
  return element('p', [], [text(`${label} — `), link]);
}

/**
 * Replaces every embed element with its placeholder (or drops it when no
 * linkable URL exists). Pure — returns a new tree; each replacement and
 * drop is reported, never silent (§10.31 "Rete e caps").
 */
export function replaceEmbeds(
  doc: WdfDocument,
  opts: EmbedPlaceholderOptions,
  report: string[],
): WdfDocument {
  const rebuild = (el: WdfElement): WdfElement | null => {
    if (EMBED_TAGS.has(el.tag)) {
      const url = embedUrl(el, opts.baseUrl);
      if (url === undefined) {
        report.push(`dropped <${el.tag}> embed (no linkable URL)`);
        return null;
      }
      report.push(`embedded content replaced with a placeholder link (ext-capture §5): ${url}`);
      return placeholder(el, url, opts);
    }
    return {
      kind: 'element',
      tag: el.tag,
      attrs: el.attrs,
      children: el.children
        .map((c) => (isElement(c) ? rebuild(c) : c))
        .filter((c): c is NonNullable<typeof c> => c !== null),
    };
  };
  const html = doc.html === null ? null : rebuild(doc.html);
  return { doctype: doc.doctype, html };
}
