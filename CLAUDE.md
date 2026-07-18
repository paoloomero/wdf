# WDF — Web Document Format

Open, web-native, AI-ready document format. Monorepo: pnpm workspaces, TypeScript strict, ESM, vitest.

## Ground rules

- The spec (`spec/wdf-core-0.1.md`) is the source of truth. Code follows spec, never the reverse. If a change requires a spec change, update the spec in the same PR and flag it in the PR description.
- `@wdf/core` must stay isomorphic (Node + browser). No Node-only APIs outside `platform/` adapters.
- Determinism is the product. `extract()` must be byte-deterministic: same input → identical output, on any platform. Never introduce locale-, time- or order-dependent behavior in core.
- Golden files under `fixtures/golden/` are contracts. If your change modifies them, regenerate explicitly (`pnpm golden:update`) and explain why in the PR.
- Whitelist thinking: WDF-HTML profile is a closed whitelist. When in doubt, reject. Adding an element/attribute to the profile is a spec decision, not a code decision.
- No new runtime dependencies without discussion. Current budget: fflate, ajv, parse5, commander.
- Viewer builds to ONE self-contained HTML file. No external requests at runtime, ever.
- Every violation reported by the validator must cite the spec section it enforces.

## Commands

- `pnpm test` / `pnpm lint` / `pnpm build`
- `pnpm golden:update` — regenerate golden files (review diff carefully)
- `pnpm demo` — build viewer + examples + site locally

## Definition of done for any task

Tests pass, lint passes, golden files unchanged (or intentionally updated), spec references present in error messages, no browser/Node divergence.
