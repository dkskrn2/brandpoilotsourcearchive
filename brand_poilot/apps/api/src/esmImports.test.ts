import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("production ESM imports", () => {
  it("uses explicit JavaScript extensions for every relative import", async () => {
    const sourceDirectory = path.resolve("src");
    const sourceFiles = (await readdir(sourceDirectory))
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
    const invalidImports: string[] = [];

    for (const file of sourceFiles) {
      const source = await readFile(path.join(sourceDirectory, file), "utf8");
      for (const match of source.matchAll(/(?:from\s+|import\s*)["'](\.\.?\/[^"']+)["']/g)) {
        if (!/\.(?:js|json)$/.test(match[1])) invalidImports.push(`${file}:${match[1]}`);
      }
    }

    expect(invalidImports).toEqual([]);
  });
});
