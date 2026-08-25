import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("reel production runtime", () => {
  it("writes and uses the Reel Storyboard v2 output schema", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "reel-draft-schema-"));
    try {
      const runner = await import(new URL("../scripts/run-codex-reel-plan.mjs", import.meta.url).href) as {
        buildCodexArgs(outputDir: string, allowBrowserUse?: boolean): string[];
        buildCodexPrompt(prompt: string, allowBrowserUse?: boolean): string;
        writeReelStoryboardSchema(outputDir: string): Promise<string>;
      };
      const schemaPath = await runner.writeReelStoryboardSchema(outputDir);
      const args = runner.buildCodexArgs(outputDir, false);
      const urlArgs = runner.buildCodexArgs(outputDir, true);
      const schema = JSON.parse(await readFile(schemaPath, "utf8")) as {
        additionalProperties: boolean;
        required: string[];
        properties: {
          assets: { items: { additionalProperties: boolean; properties: Record<string, unknown> } };
        } & Record<string, unknown>;
      };

      expect(schema.additionalProperties).toBe(false);
      expect(schema.required).toEqual(["contractVersion", "content", "storyNarrative", "evidenceSelection", "scenes"]);
      expect(Object.keys(schema.properties)).toEqual(["contractVersion", "content", "storyNarrative", "evidenceSelection", "scenes"]);
      expect(schema.properties.scenes.items.additionalProperties).toBe(false);
      expect(Object.keys(schema.properties.scenes.items.properties)).toEqual([
        "index", "editorialRole", "purpose", "coreMessage", "headline", "informationRelation", "supportingTexts", "footnote",
        "evidenceIds", "productImageAssetIds", "avatarImageAssetIds",
      ]);
      expect(args[args.indexOf("--output-schema") + 1]).toBe(schemaPath);
      expect(args).toEqual(expect.arrayContaining(["--model", "gpt-5.6-sol"]));
      expect(args).toEqual(expect.arrayContaining(["-c", 'model_reasoning_effort="high"']));
      expect(args.join(" ")).toContain("permissions.planner.network.enabled=false");
      expect(args.some((value, index) => value === "--disable" && args[index + 1] === "browser_use")).toBe(true);
      expect(urlArgs.join(" ")).toContain("permissions.planner.network.enabled=true");
      expect(urlArgs.some((value, index) => value === "--enable" && urlArgs[index + 1] === "browser_use")).toBe(true);
      expect(urlArgs.some((value, index) => value === "--disable" && urlArgs[index + 1] === "browser_use")).toBe(false);
      expect(runner.buildCodexPrompt("fixed input", false)).toContain("웹을 조회하지 마세요");
      expect(runner.buildCodexPrompt("fixed input", true)).toContain("prompt에 지정된 topic_url 원문만 브라우저로 직접 확인");
      expect(schemaPath).toContain("reel-storyboard-v2.schema.json");
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
