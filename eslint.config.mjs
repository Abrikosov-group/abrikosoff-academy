import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-e2e/**",
    ".next-e2e-disabled/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Exported design handoff is a read-only browser artifact.
    "docs/design/handoff/**",
  ]),
]);

export default eslintConfig;
