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
