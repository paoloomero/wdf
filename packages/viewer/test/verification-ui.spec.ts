import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// Contract of the verification UI (plan §10.70): the Reader reports the one
// verdict of validatePackage() — badge, popover and status bar never hold
// different opinions — and "tampered" is not a word it uses for anything
// but a digest mismatch.

const mainTs = readFileSync(join(resolve(import.meta.dirname, '../src'), 'main.ts'), 'utf8');

describe('Reader verification UI', () => {
  it('consumes the single validation pipeline', () => {
    expect(mainTs).toContain('validatePackage(doc.pkg)');
    expect(mainTs).not.toContain('verifyPackage(');
    expect(mainTs).not.toContain('validateProfile(');
  });

  it('labels come from the shared status vocabulary and never say "Tampered"', () => {
    expect(mainTs).toContain('STATUS_TEXT[result.status]');
    expect(mainTs).not.toContain("'Tampered'");
    expect(mainTs).not.toContain("'Profile errors'");
  });

  it('shows that integrity is not authenticity (§8.3, §11.4)', () => {
    expect(mainTs).toContain('add(INTEGRITY_NOT_AUTHENTICITY');
  });

  it('status bar verdict is derived from the same result as the badge', () => {
    expect(mainTs).toContain("result.verified ? 'verified locally' : text.label.toUpperCase()");
  });
});
