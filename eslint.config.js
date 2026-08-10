// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // schemas.compiled.ts is GENERATED (ajv standalone, pnpm sync:schemas).
    ignores: ['**/dist/**', '**/node_modules/**', 'packages/core/src/schemas.compiled.ts'],
  },
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
);
