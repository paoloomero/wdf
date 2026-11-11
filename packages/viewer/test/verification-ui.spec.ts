import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// Contract of the verification UI (plan §10.70): the Reader reports the one
// verdict of validatePackage() — badge, popover and status bar never hold
// different opinions — and "tampered" is not a word it uses for anything
// but a digest mismatch.

const mainTs = readFileSync(join(resolve(import.meta.dirname, '../src'), 'main.ts'), 'utf8');
// Texts live in i18n.ts (plan §10.81); English verdicts are core's own.
const i18nTs = readFileSync(join(resolve(import.meta.dirname, '../src'), 'i18n.ts'), 'utf8');

describe('Reader verification UI', () => {
  it('consumes the single validation pipeline', () => {
    expect(mainTs).toContain('validatePackage(doc.pkg)');
    expect(mainTs).not.toContain('verifyPackage(');
    expect(mainTs).not.toContain('validateProfile(');
  });

  it('labels come from the shared status vocabulary and never say "Tampered"', () => {
    expect(mainTs).toContain('m.status[result.status]');
    expect(i18nTs).toContain('status: STATUS_TEXT,');
    for (const src of [mainTs, i18nTs]) {
      expect(src).not.toContain("'Tampered'");
      expect(src).not.toContain("'Profile errors'");
      expect(src).not.toMatch(/'Manomess/);
    }
  });

  it('shows that integrity is not authenticity (§8.3, §11.4)', () => {
    expect(mainTs).toContain('add(m.notAuthenticity');
    expect(i18nTs).toContain('notAuthenticity: INTEGRITY_NOT_AUTHENTICITY');
    expect(i18nTs).toContain('Integrità non è autenticità');
  });

  it('status bar verdict is derived from the same result as the badge', () => {
    expect(mainTs).toContain('result.verified ? m.verifiedLocally : text.label.toUpperCase()');
  });
});

describe('Plain view, typed-data mark and conversion report (plan §10.70)', () => {
  const shell = readFileSync(join(resolve(import.meta.dirname, '../src'), 'shell.html'), 'utf8');

  it('the toolbar has a Plain toggle wired to a re-render without the author stylesheet', () => {
    expect(shell).toContain('id="plain-toggle"');
    expect(mainTs).toContain("$('plain-toggle').addEventListener('click'");
    expect(mainTs).toContain('buildSrcdoc(entry, doc.pkg.files, nonce, { plain })');
  });

  it('bound tables are marked only once the package verified, and after every frame reload', () => {
    expect(mainTs).toContain('datasetsOk = result.verified');
    expect(mainTs).toContain("postToHuman({ type: 'wdf-datasets', ok: datasetsOk })");
    expect(mainTs).toContain("if (datasetsOk) postToHuman({ type: 'wdf-datasets', ok: true })");
  });

  it('the Original view carries the conversion report and says the original is not compared', () => {
    expect(shell).toContain('id="original-report"');
    expect(i18nTs).toContain('Original included as-is, not compared with the canonical content');
    expect(i18nTs).toContain(
      'Originale incluso così com’è, non confrontato con il contenuto canonico',
    );
    expect(shell).toContain('not that it matches the canonical content');
  });
});

// Plan §10.97: two findings on the published Reader.
describe('Reader: file picker and status bar hash', () => {
  const main = readFileSync(join(import.meta.dirname, '../src/main.ts'), 'utf8');

  it('copies the picked files before clearing the input (a live list empties)', () => {
    const handler = main.slice(main.indexOf("input.addEventListener('change'"));
    const copy = handler.indexOf('const files = pickedFiles(input);');
    const clear = handler.indexOf("input.value = '';");
    const read = handler.indexOf('fileListToMap(files)');
    expect(copy).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(copy);
    expect(read).toBeGreaterThan(clear);
    expect(main).toContain('Array.from(input.files)');
  });

  it('the status bar shows the hash `wdf cite` prints, and names it', () => {
    expect(main).toContain("hashes.files?.['ai/content.md']");
    expect(main).toContain('content.md sha-256');
    expect(main).not.toContain('hashes.files?.[doc.pkg.manifest.entry]');
  });
});
