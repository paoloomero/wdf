import type { WdfCapture } from '@wdf-dev/core';
import { describe, expect, it } from 'vitest';

import { captureDetails, captureNote } from '../src/prepare.js';

// WP18/T18.0 (plan §10.32): the viewer states the nature of a live-page
// capture next to the badge and exposes the provenance metadata in the
// verification details (docs/ext-capture.md §6).

const capture: WdfCapture = {
  capture: '0.1',
  url: 'https://example.com/2026/some-article',
  capturedAt: '2026-08-10T15:04:05Z',
  userAgent: 'Mozilla/5.0 (Macintosh)',
  viewport: { width: 1440, height: 900, devicePixelRatio: 2 },
  mode: 'article',
};

describe('captureNote', () => {
  it('states the capture nature with its instant', () => {
    expect(captureNote(capture)).toBe('captured from live page on 2026-08-10T15:04:05Z');
  });
});

describe('captureDetails', () => {
  it('lists mode, URL, instant, user agent and viewport', () => {
    const lines = captureDetails(capture);
    expect(lines[0]).toContain('extracted article');
    expect(lines[0]).toContain('integrity is not authenticity (§11.4)');
    expect(lines).toContain('Captured URL: https://example.com/2026/some-article');
    expect(lines).toContain('Captured at: 2026-08-10T15:04:05Z');
    expect(lines).toContain('User agent: Mozilla/5.0 (Macintosh)');
    expect(lines).toContain('Viewport: 1440×900 @2x');
  });

  it('handles full-page mode and an absent devicePixelRatio', () => {
    const lines = captureDetails({
      ...capture,
      mode: 'full-page',
      viewport: { width: 375, height: 812 },
    });
    expect(lines[0]).toContain('full page');
    expect(lines).toContain('Viewport: 375×812');
  });
});
