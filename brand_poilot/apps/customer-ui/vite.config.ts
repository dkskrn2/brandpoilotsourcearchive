import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

import { assertCustomerBuildEnv } from "./buildEnv";

export default defineConfig(({ mode }) => {
  assertCustomerBuildEnv({
    ...loadEnv(mode, process.cwd(), ""),
    ...process.env
  });

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: false
    }
  };
});
