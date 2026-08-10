import { parseHtml } from '@wdf/core';
import { describe, expect, it } from 'vitest';

import { replaceEmbeds } from '../src/embeds.js';

// T18.4 (ext-capture §5): embed placeholders that preserve the embed URL —
// figure when a poster is available, paragraph otherwise; nothing the
// whitelist forbids survives, nothing is dropped silently.

const BASE = 'https://example.com/articles/post';

const run = (
  html: string,
  hasPoster: (url: string) => boolean = () => false,
): { out: string; report: string[] } => {
  const report: string[] = [];
  const doc = replaceEmbeds(parseHtml(html), { baseUrl: BASE, hasPoster }, report);
  return { out: JSON.stringify(doc), report };
};

describe('replaceEmbeds', () => {
  it('turns a cross-origin iframe into a paragraph with the embed link', () => {
    const { out, report } = run(
      '<body><div><iframe src="https://www.youtube.com/embed/abc123" allow="autoplay"></iframe></div></body>',
    );
    expect(out).not.toContain('iframe');
    expect(out).toContain('Embedded content — ');
    expect(out).toContain('Open on www.youtube.com');
    expect(out).toContain('https://www.youtube.com/embed/abc123');
    expect(report).toEqual([
      'embedded content replaced with a placeholder link (ext-capture §5): https://www.youtube.com/embed/abc123',
    ]);
  });

  it('gives a video with a captured poster a figure per §6.2.6', () => {
    const { out } = run(
      '<body><video src="/media/talk.mp4" poster="/media/talk.jpg"></video></body>',
      (url) => url === 'https://example.com/media/talk.jpg',
    );
    expect(out).toContain('figure');
    expect(out).toContain('https://example.com/media/talk.jpg');
    expect(out).toContain('Video preview');
    expect(out).toContain('figcaption');
    expect(out).toContain('Open on example.com');
    expect(out).toContain('https://example.com/media/talk.mp4');
  });

  it('falls back to a paragraph when the poster was not captured', () => {
    const { out } = run(
      '<body><video src="/media/talk.mp4" poster="/media/talk.jpg"></video></body>',
      () => false,
    );
    expect(out).not.toContain('figure');
    expect(out).toContain('Video — ');
  });

  it('reads the URL from <source> children and resolves relative URLs', () => {
    const { out } = run('<body><video><source src="clip.webm" type="video/webm"></video></body>');
    expect(out).toContain('https://example.com/articles/clip.webm');
  });

  it('drops embeds without a linkable http(s) URL, with a report line', () => {
    const { out, report } = run(
      '<body><iframe src="about:blank"></iframe><iframe></iframe><embed src="data:x"></body>',
    );
    expect(out).not.toContain('iframe');
    expect(out).not.toContain('Open on');
    expect(report).toEqual([
      'dropped <iframe> embed (no linkable URL)',
      'dropped <iframe> embed (no linkable URL)',
      'dropped <embed> embed (no linkable URL)',
    ]);
  });
});
