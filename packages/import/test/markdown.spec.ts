import { describe, expect, it } from 'vitest';

import { ensureIds, fixDanglingFragments, serializeDocument } from '../src/ast.js';
import { importMarkdown } from '../src/markdown.js';

// Plan §10.74: three defects found by importing the spec itself (§10.72).

const html = (md: string): { body: string; report: string[] } => {
  const { blocks, report } = importMarkdown(md);
  ensureIds(blocks, report);
  fixDanglingFragments(blocks, report);
  return { body: serializeDocument('en', 't', blocks), report };
};

describe('importMarkdown — inline runs across line breaks', () => {
  it('parses strong emphasis spanning a soft break inside a blockquote', () => {
    const { body } = html('> **What the human reads\n> is the same thing.** The rest.\n');
    expect(body).toContain('<strong>What the human reads is the same thing.</strong> The rest.');
    expect(body).not.toContain('**');
  });

  it('keeps backslash hard breaks', () => {
    const { body } = html('first\\\nsecond\n');
    expect(body).toMatch(/first<br \/>\s*second/);
  });
});

describe('importMarkdown — list item continuation lines', () => {
  it('joins indented and lazy continuation lines into their item', () => {
    const { body } = html(
      '- **Small core.** Everything not needed\n  is out of the core.\n- second\nlazy tail\n\nAfter.\n',
    );
    expect(body).toContain(
      '<strong>Small core.</strong> Everything not needed is out of the core.',
    );
    expect(body).toContain('second lazy tail');
    expect(body.match(/<li /g)).toHaveLength(2);
    expect(body).toMatch(/<p id="p-0001">After\.<\/p>/);
  });

  it('attaches a continuation after a nested item to the nested item', () => {
    const { body } = html('- top\n  - nested starts\n    and continues\n');
    expect(body).toContain('nested starts and continues');
  });

  it('still ends the list at a heading', () => {
    const { body } = html('- one\n## Next\n');
    expect(body).toMatch(/<\/ul>\s*<h2 /);
  });
});

describe('fixDanglingFragments — GitHub-style heading anchors', () => {
  it('retargets a table-of-contents link to the imported heading id', () => {
    const { body, report } = html(
      '1. [Conformance](#2-conformance-and-terminology)\n2. [Gone](#nowhere)\n\n## 2. Conformance and terminology\n',
    );
    expect(body).toContain('<a href="#h-2-conformance-and-terminology">Conformance</a>');
    expect(body).not.toContain('#nowhere');
    expect(report).toContain('unwrapped link to missing fragment "#nowhere"');
  });

  it('matches the double hyphen left by removed punctuation', () => {
    const { body } = html(
      '[A](#appendix-a--minimal-document)\n\n## Appendix A — Minimal document\n',
    );
    expect(body).toContain('href="#h-appendix-a-minimal-document"');
  });
});
