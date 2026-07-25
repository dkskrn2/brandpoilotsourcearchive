import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Vercel Fastify entrypoint", () => {
  it("exposes only src/index.ts as an auto-detected server entrypoint", async () => {
    const files = await readdir(path.resolve("src"));
    const detectedEntrypoints = files
      .filter((file) => /^(?:app|index|server)\.(?:js|mjs|cjs|ts|cts|mts)$/.test(file))
      .sort();

    expect(detectedEntrypoints).toEqual(["index.ts"]);
    const indexSource = await readFile(path.join(path.resolve("src"), "index.ts"), "utf8");
    expect(indexSource).toMatch(/from ["']fastify["']/);
  });
});
