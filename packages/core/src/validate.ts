import { validateCaptureExt } from './capture.js';
import { validateDatasets } from './dataset.js';
import { UnsupportedVersionError, WdfError } from './errors.js';
import { verifyPackage } from './integrity.js';
import { readPackage, type WdfPackage } from './package.js';
import { validatePaginationExt } from './pagination.js';
import { validateProfile, validateStylesheet, type Violation } from './profile.js';

/**
 * The one verdict every consumer reports (spec §8.2, errata of 15 Sep 2026;
 * plan §10.70). A package is *verified* only when it is structurally valid,
 * conforms to §5–§6 and §10, every file matches its digest, and the AI layer
 * is the canonical extraction of the content. The other states say which of
 * those failed — "tampered" is reserved for a digest mismatch.
 */
export type PackageStatus =
  | 'verified'
  | 'not-conforming'
  | 'integrity-failed'
  | 'derivation-failed'
  | 'unsupported-version'
  | 'not-verifiable';

export interface ValidationResult {
  readonly status: PackageStatus;
  /** `status === 'verified'`. */
  readonly verified: boolean;
  /** §3–§6, §10: structure, profile, stylesheet, datasets, declared extensions (no errors). */
  readonly conformance: boolean;
  /** §8.2 hashes: every file matches its digest. */
  readonly integrity: boolean;
  /** §8.2 determinism: the AI layer is the canonical extraction. */
  readonly determinism: boolean;
  /** Every violation found, errors and warnings, each citing its spec section. */
  readonly violations: readonly Violation[];
}

/** Human-readable label and one-line explanation of each status, shared by CLI, Reader and MCP. */
export const STATUS_TEXT: Readonly<Record<PackageStatus, { label: string; detail: string }>> = {
  verified: {
    label: 'Verified',
    detail:
      'conforming package, every file matches its digest, AI layer is the canonical derivation of the content (§5–§8)',
  },
  'not-conforming': {
    label: 'Not conforming',
    detail: 'the package violates the WDF-HTML profile, dataset or structure rules (§3–§6, §10)',
  },
  'integrity-failed': {
    label: 'Integrity failed',
    detail:
      'a file does not match its SHA-256 digest: the package was tampered with or corrupted (§8.2)',
  },
  'derivation-failed': {
    label: 'Derivation failed',
    detail: 'the AI layer is not the canonical extraction of the content (§7.1)',
  },
  'unsupported-version': {
    label: 'Unsupported version',
    detail:
      'the package declares a WDF version this validator does not implement; nothing was checked (§4.1)',
  },
  'not-verifiable': {
    label: 'Not verifiable',
    detail: 'a verification step could not run',
  },
};

/** The caveat every consumer SHOULD show next to a verified verdict (spec §8.3, §11.4). */
export const INTEGRITY_NOT_AUTHENTICITY =
  'Integrity is not authenticity: hashes prove the package is consistent, not who authored it (§8.3, §11.4)';

function violationOf(e: WdfError): Violation {
  return { spec: e.spec, path: e.path ?? '(package)', message: e.message, severity: 'error' };
}

/**
 * Runs every machine-checkable requirement of the specification on a package
 * and returns the single verdict all consumers must agree on: CLI, Reader and
 * MCP call this and nothing else. Accepts raw `.wdf` bytes (structure and
 * version failures become a status) or an already-read package.
 */
export async function validatePackage(input: Uint8Array | WdfPackage): Promise<ValidationResult> {
  const violations: Violation[] = [];
  const failed = (
    status: PackageStatus,
    conformance = false,
    integrity = false,
    determinism = false,
  ): ValidationResult => ({
    status,
    verified: false,
    conformance,
    integrity,
    determinism,
    violations,
  });

  let pkg: WdfPackage;
  if (input instanceof Uint8Array) {
    try {
      pkg = readPackage(input);
    } catch (e) {
      if (e instanceof UnsupportedVersionError) {
        violations.push(violationOf(e));
        return failed('unsupported-version');
      }
      if (e instanceof WdfError) {
        violations.push(violationOf(e));
        return failed('not-conforming');
      }
      violations.push({
        spec: '§3.1',
        path: '(package)',
        message: `cannot read the package (${String(e)})`,
        severity: 'error',
      });
      return failed('not-verifiable');
    }
  } else {
    pkg = input;
  }

  // Conformance: §5–§6 (profile, stylesheet, dataset binding) and the
  // published extensions (§10). Structure (§3–§4) was enforced by readPackage.
  try {
    const dec = new TextDecoder('utf-8', { fatal: true });
    const entry = dec.decode(pkg.files.get(pkg.manifest.entry) ?? new Uint8Array());
    violations.push(...validateProfile(entry));
    const styles = pkg.files.get('content/styles.css');
    if (styles !== undefined) violations.push(...validateStylesheet(dec.decode(styles)));
    violations.push(...validateDatasets(pkg));
    violations.push(...validateCaptureExt(pkg));
    violations.push(...validatePaginationExt(pkg));
  } catch (e) {
    violations.push({
      spec: '§6',
      path: pkg.manifest.entry,
      message: `conformance checks could not run (${String(e)})`,
      severity: 'error',
    });
    return failed('not-verifiable');
  }
  const conformance = !violations.some((v) => v.severity === 'error');

  // §8.2 hashes and determinism.
  let integrity: boolean;
  let determinism: boolean;
  try {
    const verify = await verifyPackage(pkg);
    integrity = verify.integrity;
    determinism = verify.determinism;
    violations.push(...verify.problems);
  } catch (e) {
    violations.push({
      spec: '§8.2',
      path: '(package)',
      message: `integrity checks could not run (${String(e)})`,
      severity: 'error',
    });
    return failed('not-verifiable', conformance);
  }

  // Precedence follows §8.2: a digest mismatch makes every other reading
  // suspect; a derivation failure is next; conformance errors last.
  let status: PackageStatus = 'verified';
  if (!integrity) status = 'integrity-failed';
  else if (!determinism) status = 'derivation-failed';
  else if (!conformance) status = 'not-conforming';

  return {
    status,
    verified: status === 'verified',
    conformance,
    integrity,
    determinism,
    violations,
  };
}
