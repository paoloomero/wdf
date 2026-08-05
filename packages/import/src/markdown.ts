import { el, type MEl, type MNode } from './ast.js';

/**
 * Best-effort Markdown → WDF-HTML conversion (plan T3.4). Supports a
 * CommonMark/GFM subset: ATX headings, paragraphs (with hard breaks), fenced
 * code blocks, blockquotes, flat + one-level-nested lists, GFM tables,
 * thematic breaks; inline code/strong/em/links. Everything else degrades to
 * text and is reported.
 */

const HREF_OK = /^(https?:\/\/[^\s<>]+|mailto:[^\s<>]+|#.+)$/;

// ---------------------------------------------------------------------------
// Inline parsing

function parseInline(text: string, report: string[]): MNode[] {
  const out: MNode[] = [];
  let buf = '';
  const flush = (): void => {
    if (buf !== '') out.push(buf);
    buf = '';
  };
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);

    const escape = /^\\([!-/:-@[-`{-~])/.exec(rest);
    if (escape !== null) {
      buf += escape[1] ?? '';
      i += 2;
      continue;
    }

    const code = /^(`+)([\s\S]*?)\1(?!`)/.exec(rest);
    if (code !== null && rest.startsWith('`')) {
      flush();
      const content = (code[2] ?? '').replace(/\n/g, ' ');
      out.push(
        el('code', {}, [
          content.startsWith(' ') && content.endsWith(' ') && content.trim() !== ''
            ? content.slice(1, -1)
            : content,
        ]),
      );
      i += code[0].length;
      continue;
    }

    const image = /^!\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/.exec(rest);
    if (image !== null) {
      report.push(
        `dropped Markdown image "${image[2] ?? ''}" (images must live under content/assets/)`,
      );
      buf += image[1] ?? '';
      i += image[0].length;
      continue;
    }

    const link = /^\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/.exec(rest);
    if (link !== null) {
      const href = link[2] ?? '';
      const label = parseInline(link[1] ?? '', report);
      flush();
      if (HREF_OK.test(href)) {
        out.push(el('a', { href }, label));
      } else {
        report.push(`unwrapped link "${href}" (scheme not permitted)`);
        out.push(...label);
      }
      i += link[0].length;
      continue;
    }

    const strong = /^\*\*(?!\s)([\s\S]+?)(?<!\s)\*\*/.exec(rest);
    if (strong !== null) {
      flush();
      out.push(el('strong', {}, parseInline(strong[1] ?? '', report)));
      i += strong[0].length;
      continue;
    }

    const em = /^([*_])(?!\s)([^*_]+?)(?<!\s)\1/.exec(rest);
    if (em !== null) {
      flush();
      out.push(el('em', {}, parseInline(em[2] ?? '', report)));
      i += em[0].length;
      continue;
    }

    buf += text[i] ?? '';
    i += 1;
  }
  flush();
  return out;
}

/** Paragraph text: lines ending with two spaces or a backslash hard-break. */
function paragraphInline(lines: string[], report: string[]): MNode[] {
  const out: MNode[] = [];
  lines.forEach((line, index) => {
    const hard = /( {2}|\\)$/.test(line);
    const cleaned = line.replace(/( {2}|\\)$/, '');
    out.push(...parseInline(cleaned, report));
    if (index < lines.length - 1) {
      out.push(hard ? el('br') : ' ');
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Block parsing

const ITEM_RE = /^([-*+]|\d+[.)])\s+(.*)$/;
const NESTED_RE = /^\s{2,}([-*+]|\d+[.)])\s+(.*)$/;
const DELIM_ROW_RE = /^\s*\|?[\s:|-]+\|?\s*$/;

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

export function importMarkdown(md: string): { blocks: MEl[]; report: string[] } {
  const report: string[] = [];
  const blocks: MEl[] = [];
  const lines = md.split(/\r\n?|\n/);
  let i = 0;

  const isBlank = (line: string | undefined): boolean => line === undefined || line.trim() === '';

  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (isBlank(line)) {
      i += 1;
      continue;
    }

    const fence = /^```(\S*)\s*$/.exec(line);
    if (fence !== null) {
      const info = fence[1] ?? '';
      const content: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? '')) {
        content.push(lines[i] ?? '');
        i += 1;
      }
      i += 1; // closing fence
      const attrs = info === '' ? {} : { class: `language-${info}` };
      blocks.push(el('pre', {}, [el('code', attrs, [content.join('\n')])]));
      continue;
    }

    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading !== null) {
      const level = (heading[1] ?? '#').length;
      blocks.push(el(`h${String(level)}`, {}, parseInline(heading[2] ?? '', report)));
      i += 1;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(el('hr'));
      i += 1;
      continue;
    }

    if (line.startsWith('>')) {
      const quoted: string[] = [];
      while (i < lines.length && (lines[i] ?? '').startsWith('>')) {
        quoted.push((lines[i] ?? '').replace(/^> ?/, ''));
        i += 1;
      }
      const paragraphs: MEl[] = [];
      let current: string[] = [];
      const flushPara = (): void => {
        if (current.length > 0) paragraphs.push(el('p', {}, paragraphInline(current, report)));
        current = [];
      };
      for (const q of quoted) {
        if (q.trim() === '') flushPara();
        else current.push(q);
      }
      flushPara();
      if (paragraphs.length > 0) blocks.push(el('blockquote', {}, paragraphs));
      continue;
    }

    const item = ITEM_RE.exec(line);
    if (item !== null) {
      const ordered = /\d/.test((item[1] ?? '')[0] ?? '');
      const listTag = ordered ? 'ol' : 'ul';
      const items: MEl[] = [];
      while (i < lines.length) {
        const current = lines[i] ?? '';
        const top = ITEM_RE.exec(current);
        const nested = NESTED_RE.exec(current);
        if (top !== null && !NESTED_RE.test(current)) {
          items.push(el('li', {}, parseInline(top[2] ?? '', report)));
          i += 1;
        } else if (nested !== null && items.length > 0) {
          const parent = items[items.length - 1] as MEl;
          const nestedOrdered = /\d/.test((nested[1] ?? '')[0] ?? '');
          const nestedTag = nestedOrdered ? 'ol' : 'ul';
          let list = parent.children.find(
            (c): c is MEl => typeof c !== 'string' && (c.tag === 'ul' || c.tag === 'ol'),
          );
          if (list === undefined) {
            list = el(nestedTag);
            parent.children.push(list);
          }
          list.children.push(el('li', {}, parseInline(nested[2] ?? '', report)));
          i += 1;
        } else {
          break;
        }
      }
      blocks.push(el(listTag, {}, items));
      continue;
    }

    if (
      line.includes('|') &&
      DELIM_ROW_RE.test(lines[i + 1] ?? '') &&
      (lines[i + 1] ?? '').includes('-')
    ) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? '').includes('|') && !isBlank(lines[i])) {
        rows.push(splitRow(lines[i] ?? ''));
        i += 1;
      }
      report.push('synthesized empty <caption> for a Markdown table');
      const width = header.length;
      const cellRow = (cells: string[], tag: 'th' | 'td'): MEl =>
        el(
          'tr',
          {},
          Array.from({ length: width }, (_, c) => el(tag, {}, parseInline(cells[c] ?? '', report))),
        );
      blocks.push(
        el('table', {}, [
          el('caption'),
          el('thead', {}, [cellRow(header, 'th')]),
          el(
            'tbody',
            {},
            rows.map((r) => cellRow(r, 'td')),
          ),
        ]),
      );
      continue;
    }

    // Paragraph: collect until blank line or a new block opener.
    const para: string[] = [];
    while (i < lines.length && !isBlank(lines[i])) {
      const current = lines[i] ?? '';
      if (
        /^(#{1,6})\s/.test(current) ||
        /^```/.test(current) ||
        current.startsWith('>') ||
        ITEM_RE.test(current)
      ) {
        break;
      }
      para.push(current.trim());
      i += 1;
    }
    if (para.length > 0) blocks.push(el('p', {}, paragraphInline(para, report)));
    else i += 1;
  }

  return { blocks, report };
}
