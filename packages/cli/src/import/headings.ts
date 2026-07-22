import { isEl, textOf, type MEl, type MNode } from './ast.js';
import { STYLE_TMP_ATTR } from './styles.js';

/**
 * Styled-paragraph → heading heuristic (plan §10.14/§10.15, T7.7): word
 * processors export titles as styled paragraphs, never h1..h6, leaving the
 * AI outline flat. When the imported document has no heading at all,
 * paragraphs whose uniform font size clearly exceeds the body text are
 * promoted to headings, largest size first. Best-effort, deterministic,
 * every promotion reported; no spec change (import behavior only).
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
}

/**
 * Promotes styled title paragraphs to h1..h6 in place. Runs only when the
 * document contains no heading (real or MsoTitle-mapped): the heuristic
 * fixes the flat-outline case, it never reorganizes structured documents.
 */
export function promoteHeadings(blocks: MEl[], report: string[]): void {
  let hasHeading = false;
  const paragraphs: Candidate[] = [];
  const candidates: Candidate[] = [];

  // Paragraphs everywhere feed the body-size statistics; only paragraphs in
  // block lists (article/sectioning) may be promoted — blockquote admits
  // nothing but <p> (§6.2.6).
  const scan = (list: MEl[], promotable: boolean): void => {
    for (const block of list) {
      if (HEADINGS.has(block.tag)) hasHeading = true;
      if (SECTIONING.has(block.tag)) {
        scan(block.children.filter(isEl), promotable);
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
      const candidate = { el: block, size, text };
      paragraphs.push(candidate);
      if (promotable && text.length <= MAX_HEADING_CHARS) candidates.push(candidate);
    }
  };
  scan(blocks, true);
  if (hasHeading || paragraphs.length === 0) return;

  // Body size = the size covering the most text (tie → smaller size).
  const weights = new Map<number, number>();
  for (const { size, text } of paragraphs) {
    weights.set(size, (weights.get(size) ?? 0) + text.length);
  }
  const body = [...weights.entries()].sort(([sa, wa], [sb, wb]) =>
    wa !== wb ? wb - wa : sa - sb,
  )[0] as [number, number];
  const bodySize = body[0];

  const promotable = candidates.filter(({ size }) => size >= bodySize * SIZE_RATIO);
  if (promotable.length === 0) return;

  const levels = new Map<number, number>();
  for (const size of [...new Set(promotable.map((c) => c.size))].sort((a, b) => b - a)) {
    if (levels.size < MAX_LEVEL) levels.set(size, levels.size + 1);
  }

  for (const { el, size, text } of promotable) {
    const level = levels.get(size);
    if (level === undefined) {
      report.push(`kept styled paragraph (${String(size)}pt) as <p>: more than 6 heading sizes`);
      continue;
    }
    el.tag = `h${String(level)}`;
    const excerpt = text.length > 40 ? `${text.slice(0, 40)}…` : text;
    report.push(
      `promoted styled paragraph (${String(size)}pt) to <h${String(level)}>: "${excerpt}"`,
    );
  }
}
