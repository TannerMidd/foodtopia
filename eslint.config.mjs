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
    ".vercel/**",
    "out/**",
    "build/**",
    "public/sw.js",
    "public/swe-worker-*.js",
    "next-env.d.ts",
    // Gitignored local tool caches that CI never checks out. ESLint's flat
    // config does not read .gitignore, and linting these exhausts the heap.
    ".npm-cache/**",
    ".pnpm-store/**",
    "test-results/**",
    "playwright-report/**",
  ]),
]);

export default eslintConfig;
