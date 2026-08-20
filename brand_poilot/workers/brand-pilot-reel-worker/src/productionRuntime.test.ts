import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("reel production runtime", () => {
  it("writes and uses the Reel Storyboard v1 output schema", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "reel-draft-schema-"));
    try {
      const runner = await import(new URL("../scripts/run-codex-reel-plan.mjs", import.meta.url).href) as {
        buildCodexArgs(outputDir: string): string[];
        writeReelStoryboardSchema(outputDir: string): Promise<string>;
      };
      const schemaPath = await runner.writeReelStoryboardSchema(outputDir);
      const args = runner.buildCodexArgs(outputDir);
      const schema = JSON.parse(await readFile(schemaPath, "utf8")) as {
        additionalProperties: boolean;
        required: string[];
        properties: {
          assets: { items: { additionalProperties: boolean; properties: Record<string, unknown> } };
        } & Record<string, unknown>;
      };

      expect(schema.additionalProperties).toBe(false);
      expect(schema.required).toEqual(["contractVersion", "content", "storyNarrative", "visualSystem", "scenes"]);
      expect(Object.keys(schema.properties)).toEqual(["contractVersion", "content", "storyNarrative", "visualSystem", "scenes"]);
      expect(schema.properties.scenes.items.additionalProperties).toBe(false);
      expect(Object.keys(schema.properties.scenes.items.properties)).toEqual([
        "index", "editorialRole", "purpose", "coreMessage", "headline", "keyVisual", "supportingTexts", "footnote",
        "visualThesis", "layoutArchetype", "evidenceIds", "productImageAssetIds",
      ]);
      expect(args[args.indexOf("--output-schema") + 1]).toBe(schemaPath);
      expect(args).toEqual(expect.arrayContaining(["--model", "gpt-5.6-sol"]));
      expect(args).toEqual(expect.arrayContaining(["-c", 'model_reasoning_effort="high"']));
      expect(schemaPath).toContain("reel-storyboard-v1.schema.json");
      expect(args.join(" ")).not.toContain("reel-plan-v2.schema.json");
      expect(args.join(" ")).not.toContain("reel-plan-draft-v2.schema.json");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 15_000);

  it("does not package the obsolete canonical planner schema", async () => {
    const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
    expect(dockerfile).not.toContain("generated/reel-plan-v2.schema.json");
  });
});
