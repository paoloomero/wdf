import { describe, expect, it } from 'vitest';

import { buildPrintSrcdoc, wrapPrintShell } from '../src/prepare.js';

// T14.2 (plan §10.25): the print document repeats the imported page header
// and footer on every sheet via a thead/tfoot shell. Documents without them
// must pass through byte-identical.

const doc = (inner: string): string => `<!DOCTYPE html>
<html lang="it">
  <head>
    <meta charset="utf-8" />
    <title>T</title>
  </head>
  <body>
    <article>${inner}</article>
  </body>
</html>
`;

const HEADER = `
      <header>
        <p id="p-0001">Ente di Prova</p>
      </header>`;
const FOOTER = `
      <footer>
        <p id="p-0009">P.IVA 01234567890</p>
      </footer>`;
const BODY = `
      <p id="p-0002">Corpo.</p>
      <section id="sec-a">
        <h1 id="h-a">A</h1>
      </section>
    `;

describe('wrapPrintShell', () => {
  it('leaves a document without header/footer byte-identical', () => {
    const html = doc(BODY);
    expect(wrapPrintShell(html)).toBe(html);
  });

  it('wraps header and footer into thead and tfoot around the body', () => {
    const out = wrapPrintShell(doc(HEADER + BODY + FOOTER));
    expect(out).toContain('<table class="wdf-print-shell"><thead><tr><td>');
    expect(out).toMatch(/<thead><tr><td>\s*<header>[\s\S]*<\/header><\/td><\/tr><\/thead>/);
    expect(out).toMatch(/<tfoot><tr><td>\s*<footer>[\s\S]*<\/footer>\s*<\/td><\/tr><\/tfoot>/);
    expect(out).toMatch(/<td class="wdf-print-body">[\s\S]*<section id="sec-a">/);
    // HTML5 order: thead, tbody, tfoot.
    expect(out.indexOf('<thead>')).toBeLessThan(out.indexOf('<tbody>'));
    expect(out.indexOf('<tbody>')).toBeLessThan(out.indexOf('<tfoot>'));
  });

  it('handles a header without footer and vice versa', () => {
    const onlyHeader = wrapPrintShell(doc(HEADER + BODY));
    expect(onlyHeader).toContain('<thead>');
    expect(onlyHeader).not.toContain('<tfoot>');
    const onlyFooter = wrapPrintShell(doc(BODY + FOOTER));
    expect(onlyFooter).not.toContain('<thead>');
    expect(onlyFooter).toContain('<tfoot>');
  });

  it('does not mistake a trailing section for a footer', () => {
    const html = doc(HEADER + BODY);
    const out = wrapPrintShell(html);
    expect(out).toMatch(/<\/section>\s*<\/td><\/tr><\/tbody>/);
  });

  it('keeps content tables inside the body cell intact', () => {
    const table = `
      <table id="t-1">
        <caption id="cap-1">C</caption>
        <thead><tr><th>x</th></tr></thead>
        <tbody><tr><td>1</td></tr></tbody>
      </table>
    `;
    const out = wrapPrintShell(doc(HEADER + table));
    expect(out).toContain('<table id="t-1">');
    expect(out.indexOf('wdf-print-body')).toBeLessThan(out.indexOf('<table id="t-1">'));
  });
});

describe('buildPrintSrcdoc with the shell', () => {
  it('applies the shell only when header/footer exist', () => {
    const files = new Map<string, Uint8Array>();
    expect(buildPrintSrcdoc(doc(BODY), files)).not.toContain('<table class="wdf-print-shell">');
    const out = buildPrintSrcdoc(doc(HEADER + BODY + FOOTER), files);
    expect(out).toContain('<table class="wdf-print-shell">');
    expect(out).toContain('@page');
  });
});
