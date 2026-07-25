import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    ".next/**",
    ".runtime/**",
    "node_modules/**",
    "public/vendor/**",
    "ouput/**",
    "api/**",
    "lib/**",
    "tests/**",
    "brand_poilot/**",
    "*.html",
    "service/**"
  ])
]);
