import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
    globals: true,
    testTimeout: 15000,
    setupFiles: ["./src/test/setup.ts"]
  }
});
