/**
 * Error raised for structural violations of WDF Core 0.1. `spec` cites the
 * section of spec/wdf-core-0.1.md that defines the violated rule (CLAUDE.md:
 * every violation must cite the spec section it enforces).
 */
export class WdfError extends Error {
  readonly spec: string;
  readonly path: string | undefined;

  constructor(message: string, spec: string, path?: string) {
    super(
      path === undefined
        ? `${message} [WDF Core ${spec}]`
        : `${message}: ${path} [WDF Core ${spec}]`,
    );
    this.name = 'WdfError';
    this.spec = spec;
    this.path = path;
  }
}

/**
 * The manifest declares a `wdf` version this implementation does not
 * implement (§4.1). Consumers report it as *unsupported version* — never as
 * tampering: nothing about the package was checked.
 */
export class UnsupportedVersionError extends WdfError {
  readonly version: string;

  constructor(version: string) {
    super(`unsupported WDF version "${version}" (this implementation validates 0.1 only)`, '§4.1');
    this.name = 'UnsupportedVersionError';
    this.version = version;
  }
}
