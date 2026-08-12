import { describe, expect, it } from 'vitest';

import { authoredBreakCss, buildPrintSrcdoc, buildSrcdoc } from '../src/prepare.js';

// T20.6 (plan §10.47): the viewer honors the `pagination` extension —
// authored breaks become break-before rules in the print sheet and reach
// the Paper paginator as an injected id list. Ignoring consumers stay
// conforming (§10.3); a package without the extension is untouched.

const enc = new TextEncoder();

const ENTRY =
  '<!DOCTYPE html><html lang="en"><head><title>t</title></head>' +
  '<body><article><h1 id="h-uno">Uno</h1><p id="p-0001">a</p>' +
  '<p id="p-0002">b</p></article></body></html>';

function files(breakBefore?: string[]): Map<string, Uint8Array> {
  const map = new Map<string, Uint8Array>();
  if (breakBefore !== undefined) {
    map.set(
      'ext/pagination/pagination.json',
      enc.encode(JSON.stringify({ pagination: '0.1', breakBefore })),
    );
  }
  return map;
}

describe('authored page breaks in the viewer (ext pagination)', () => {
  it('emits a break-before rule per id in the print sheet', () => {
    const srcdoc = buildPrintSrcdoc(ENTRY, files(['p-0002']));
    expect(srcdoc).toContain('[id="p-0002"] { break-before: page; }');
  });

  it('injects the id list for the Paper paginator', () => {
    const srcdoc = buildSrcdoc(ENTRY, files(['h-uno', 'p-0002']), 'nonce1');
    expect(srcdoc).toContain('var WDF_AUTHORED_BREAKS = ["h-uno","p-0002"];');
  });

  it('stays inert without the extension', () => {
    expect(authoredBreakCss(files())).toBe('');
    const srcdoc = buildSrcdoc(ENTRY, files(), 'nonce1');
    expect(srcdoc).toContain('var WDF_AUTHORED_BREAKS = [];');
    expect(buildPrintSrcdoc(ENTRY, files())).not.toContain('[id="');
  });

  it('ignores a malformed extension payload (§10.3 tolerance)', () => {
    const map = files();
    map.set('ext/pagination/pagination.json', enc.encode('{"pagination":"0.1"}'));
    expect(authoredBreakCss(map)).toBe('');
  });
});
