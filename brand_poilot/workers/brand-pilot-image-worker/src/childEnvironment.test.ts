import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  buildImageWorkerChildEnvironment,
  resolveGeneratedImagesDirectory
} from "./childEnvironment.mjs";

describe("image worker child environment", () => {
  it("passes only runtime and Codex authentication paths to child processes", () => {
    expect(buildImageWorkerChildEnvironment({
      PATH: "/usr/bin",
      CODEX_HOME: "/codex",
      LANG: "ko_KR.UTF-8",
      TEMP: "/tmp",
      CODEX_COMMAND: "/usr/local/bin/codex",
      OPENAI_API_KEY: "openai-secret",
      WORKER_API_TOKEN: "worker-secret",
      BRAND_PILOT_API_URL: "https://api.internal",
      BLOB_READ_WRITE_TOKEN: "blob-secret",
      DATABASE_URL: "postgres://secret",
      ALL_PROXY: "http://proxy-secret",
      HTTP_PROXY: "http://proxy-secret",
      HTTPS_PROXY: "http://proxy-secret"
    })).toEqual({
      PATH: "/usr/bin",
      CODEX_HOME: "/codex",
      LANG: "ko_KR.UTF-8",
      TEMP: "/tmp",
      CODEX_COMMAND: "/usr/local/bin/codex"
    });
  });

  it("keeps generated images in the dedicated Codex image subtree", () => {
    expect(resolveGeneratedImagesDirectory({
      CODEX_HOME: "/codex",
      CODEX_GENERATED_IMAGES_DIR: "/codex/generated_images"
    })).toBe(path.resolve("/codex/generated_images"));
    expect(resolveGeneratedImagesDirectory({ CODEX_HOME: "/codex" }))
      .toBe(path.resolve("/codex/generated_images"));
    expect(() => resolveGeneratedImagesDirectory({
      CODEX_HOME: "/codex",
      CODEX_GENERATED_IMAGES_DIR: "/tmp/unsupported-images"
    })).toThrow("codex_generated_images_directory_invalid");
  });
});
