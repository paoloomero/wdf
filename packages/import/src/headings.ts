import { isEl, textOf, type MEl, type MNode } from './ast.js';
import { STYLE_TMP_ATTR } from './styles.js';

/**
 * Styled-paragraph → heading heuristic (plan §10.14/§10.15 T7.7, §10.17
 * T7.8): word processors export titles as styled paragraphs, never h1..h6,
 * leaving the AI outline flat. A document with no heading at all gets the
 * full ladder from its font sizes; a document with headings but no h1 gets
 * exactly one title promoted. Best-effort, deterministic, every promotion
 * reported; no spec change (import behavior only).
 */

/** Promotion threshold: candidate size ≥ body size × this factor (§10.15). */
const SIZE_RATIO = 1.15;
/** Headings are short: longer candidates are body text in a big font. */
const MAX_HEADING_CHARS = 200;
const MAX_LEVEL = 6;

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const SECTIONING = new Set(['section', 'header', 'footer', 'nav']);

const FONT_SIZE = /(?:^|;)font-size:(\d+(?:\.\d+)?)(pt|px)(?:;|$)/;

/** font-size from a style signature, normalized to pt (px × 0.75). */
function fontSizePt(el: MEl): number | undefined {
  const signature = el.attrs[STYLE_TMP_ATTR];
  if (signature === undefined) return undefined;
  const m = FONT_SIZE.exec(signature);
  if (m === null) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return m[2] === 'px' ? n * 0.75 : n;
}

/**
 * The single font size covering all text of a paragraph (own style or
 * inherited through inline elements), or undefined when the size is
 * unknown, mixed, or the paragraph carries an image or line break —
 * only whole, uniform paragraphs qualify (§10.15).
 */
function uniformSizePt(p: MEl): number | undefined {
  let size: number | undefined;
  let disqualified = false;
  const walk = (nodes: MNode[], inherited: number | undefined): void => {
    for (const node of nodes) {
      if (disqualified) return;
      if (!isEl(node)) {
        if (node.trim() === '') continue;
        if (inherited === undefined || (size !== undefined && size !== inherited)) {
          disqualified = true;
        } else {
          size = inherited;
        }
        continue;
      }
      if (node.tag === 'img' || node.tag === 'br') {
        disqualified = true;
        continue;
      }
      walk(node.children, fontSizePt(node) ?? inherited);
    }
  };
  walk(p.children, fontSizePt(p));
  return disqualified ? undefined : size;
}

interface Candidate {
  el: MEl;
  size: number;
  text: string;
  /** Appears before the first existing heading in document order (T7.8). */
  preHeading: boolean;
}

function promote(candidate: Candidate, level: number, report: string[]): void {
  candidate.el.tag = `h${String(level)}`;
  const excerpt = candidate.text.length > 40 ? `${candidate.text.slice(0, 40)}…` : candidate.text;
  report.push(
    `promoted styled paragraph (${String(candidate.size)}pt) to <h${String(level)}>: "${excerpt}"`,
  );
}

/**
 * Promotes styled title paragraphs to headings in place. Two modes:
 * no heading at all (real or MsoTitle-mapped) → full ladder h1..h6 (T7.7);
 * headings present but no h1 → exactly one title paragraph becomes h1
 * (T7.8). Documents that already have an h1 are never touched.
 */
export function promoteHeadings(blocks: MEl[], report: string[]): void {
  let hasHeading = false;
  let hasH1 = false;
  const headingSizes: number[] = [];
  const paragraphs: Candidate[] = [];
  const candidates: Candidate[] = [];

  // Paragraphs everywhere feed the body-size statistics; only paragraphs in
  // block lists (article/sectioning) may be promoted — blockquote admits
  // nothing but <p> (§6.2.6).
  const scan = (list: MEl[], promotable: boolean): void => {
    for (const block of list) {
      if (HEADINGS.has(block.tag)) {
        hasHeading = true;
        if (block.tag === 'h1') hasH1 = true;
        const size = uniformSizePt(block);
        if (size !== undefined) headingSizes.push(size);
      }
      if (SECTIONING.has(block.tag)) {
        // Page headers/footers never hold the document title (T14.1):
        // a big-font letterhead line must not become a heading.
        scan(block.children.filter(isEl), promotable && block.tag === 'section');
        continue;
      }
      if (block.tag === 'blockquote') {
        scan(block.children.filter(isEl), false);
        continue;
      }
      if (block.tag !== 'p') continue;
      const size = uniformSizePt(block);
      if (size === undefined) continue;
      const text = textOf(block).replace(/\s+/g, ' ').trim();
      if (text === '') continue;
      const candidate = { el: block, size, text, preHeading: !hasHeading };
      paragraphs.push(candidate);
      if (promotable && text.length <= MAX_HEADING_CHARS) candidates.push(candidate);
    }
  };
  scan(blocks, true);
  if (hasH1 || paragraphs.length === 0) return;

  // Body size = the size covering the most text (tie → smaller size).
  const weights = new Map<number, number>();
  for (const { size, text } of paragraphs) {
    weights.set(size, (weights.get(size) ?? 0) + text.length);
  }
  const body = [...weights.entries()].sort(([sa, wa], [sb, wb]) =>
    wa !== wb ? wb - wa : sa - sb,
  )[0] as [number, number];
  const bodySize = body[0];

  if (hasHeading) {
    // T7.8 — the document is structured but lacks its title: promote the
    // first paragraph of the largest qualifying size found before the
    // first heading, provided it outranks every measurable heading.
    const maxHeading = headingSizes.length > 0 ? Math.max(...headingSizes) : undefined;
    const titles = candidates.filter(
      (c) =>
        c.preHeading &&
        c.size >= bodySize * SIZE_RATIO &&
        (maxHeading === undefined || c.size >= maxHeading),
    );
    if (titles.length === 0) return;
    const top = Math.max(...titles.map((c) => c.size));
    const first = titles.find((c) => c.size === top);
    if (first !== undefined) promote(first, 1, report);
    return;
  }

  // T7.7 — flat document: full ladder, largest size first.
  const promotable = candidates.filter(({ size }) => size >= bodySize * SIZE_RATIO);
  if (promotable.length === 0) return;

  const levels = new Map<number, number>();
  for (const size of [...new Set(promotable.map((c) => c.size))].sort((a, b) => b - a)) {
    if (levels.size < MAX_LEVEL) levels.set(size, levels.size + 1);
  }

  for (const candidate of promotable) {
    const level = levels.get(candidate.size);
    if (level === undefined) {
      report.push(
        `kept styled paragraph (${String(candidate.size)}pt) as <p>: more than 6 heading sizes`,
      );
      continue;
    }
    promote(candidate, level, report);
  }
}
