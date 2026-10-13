import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Session text is untrusted input and renders as text only, never as HTML.
    rules: { "react/no-danger": "error" },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local tool state, including other checkouts of this repo; not part of the project.
    ".claude/**",
  ]),
]);

export default eslintConfig;
