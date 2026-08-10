import type { WdfPackage } from './package.js';
import type { Violation } from './profile.js';
import { getSchemaValidators } from './schemas.js';
import type { WdfCapture } from './types.js';

// The `capture` extension (docs/ext-capture.md): provenance metadata of a
// live-page capture. Unlike `source` and `fonts`, its payload is
// machine-validated — a declared capture that does not conform is an error.

export const CAPTURE_PATH = 'ext/capture/capture.json';

const dec = new TextDecoder('utf-8', { fatal: true });

/**
 * Validates the `capture` extension of a package, when declared. Returns
 * no violations for a package that does not use the extension; the
 * dir/manifest bijection itself is enforced structurally (§10.2).
 */
export function validateCaptureExt(pkg: WdfPackage): Violation[] {
  const declared = pkg.manifest.extensions?.some((e) => e.name === 'capture') ?? false;
  const raw = pkg.files.get(CAPTURE_PATH);
  if (raw === undefined) {
    if (!declared) return [];
    return [
      {
        spec: 'ext-capture §3',
        path: CAPTURE_PATH,
        message: 'the capture extension requires ext/capture/capture.json',
        severity: 'error',
      },
    ];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(dec.decode(raw));
  } catch (e) {
    return [
      {
        spec: 'ext-capture §4',
        path: CAPTURE_PATH,
        message: `capture.json is not valid JSON (${String(e)})`,
        severity: 'error',
      },
    ];
  }
  const validate = getSchemaValidators().capture;
  if (validate(parsed)) return [];
  const detail = (validate.errors ?? [])
    .map((e) => `${e.instancePath === '' ? '/' : e.instancePath} ${e.message ?? ''}`)
    .join('; ');
  return [
    {
      spec: 'ext-capture §4',
      path: CAPTURE_PATH,
      message: `does not conform to the capture schema (${detail})`,
      severity: 'error',
    },
  ];
}

/**
 * Reads the capture metadata of a package, tolerantly: undefined when the
 * extension is absent or its payload does not conform (consumers MAY
 * ignore extensions entirely, §10.3 — a viewer shows what validates and
 * nothing else).
 */
export function parseCaptureExt(files: ReadonlyMap<string, Uint8Array>): WdfCapture | undefined {
  const raw = files.get(CAPTURE_PATH);
  if (raw === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(dec.decode(raw));
    return getSchemaValidators().capture(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
