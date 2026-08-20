import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createCommandRunner } from "./worker.js";

const read = (relativePath: string) => readFile(new URL(relativePath, import.meta.url), "utf8");

describe("card-news V3 production runtime", () => {
  it("packages only the V3 planner entry and canonical contract dependency", async () => {
    const [packageJson, dockerfile, skill] = await Promise.all([
      read("../package.json"), read("../Dockerfile"), read("../.agents/skills/card-news-creator/SKILL.md"),
    ]);
    expect(JSON.parse(packageJson).dependencies).toHaveProperty("@brand-pilot/content-contracts", "0.1.0");
    expect(dockerfile).toContain("run-codex-card-manuscript-plan.mjs");
    expect(dockerfile).not.toContain("run-codex-card-news.mjs");
    expect(dockerfile).not.toContain("run-codex-card-news-plan.mjs");
    expect(dockerfile).toContain("card-manuscript-plan-v1.schema.json");
    expect(dockerfile).not.toContain("card-news-plan-draft-v1.schema.json");
    expect(skill).toContain("card-manuscript-plan.v1");
    expect(skill).not.toContain("ImageGenerationPackageV1");
    expect(skill).not.toContain("content-generation-input.v2");
  });

  it("uses the pinned network-disabled Sol planner with high reasoning", async () => {
    const runner = await import(new URL("../scripts/run-codex-card-manuscript-plan.mjs", import.meta.url).href) as {
      buildCodexArgs(outputDir: string): string[];
      buildCodexPrompt(prompt: string): string;
    };
    const args = runner.buildCodexArgs(path.resolve("plan-output"));
    expect(args.slice(0, 3)).toEqual(["--model", "gpt-5.6-sol", "--strict-config"]);
    expect(args).toEqual(expect.arrayContaining(["-c", 'model_reasoning_effort="high"']));
    expect(args.join(" ")).toContain("permissions.planner.network.enabled=false");
    const schemaPath = args[args.indexOf("--output-schema") + 1];
    expect(schemaPath).toMatch(/card-manuscript-plan-v1\.schema\.json$/);
    const schema = await readFile(schemaPath!, "utf8");
    const parsedSchema = JSON.parse(schema) as {
      properties: { contractVersion: Record<string, unknown> };
    };
    expect(parsedSchema.properties.contractVersion).toEqual({
      type: "string",
      const: "card-manuscript-plan.v1",
    });
    expect(parsedSchema).toMatchObject({
      properties: {
        contractVersion: { const: "card-manuscript-plan.v1" },
      },
    });
    expect(schema).toContain('"deckNarrative"');
    expect(schema).toContain('"evidenceSelection"');
    expect(schema).toContain('"coreMessage"');
    expect(schema).toContain('"informationRelation"');
    expect(schema).toContain('"related_facts"');
    expect(schema).not.toContain('"visualSystem"');
    expect(schema).not.toContain('"visualThesis"');
    expect(schema).not.toContain('"layoutArchetype"');
    expect(schema).not.toContain('"uniqueItems"');
    expect(schema).not.toContain("imagePackage");
    expect(schema).not.toContain("attachmentIds");
    expect(args).toEqual(expect.arrayContaining(["--disable", "shell_tool", "--disable", "image_generation"]));
    expect(runner.buildCodexPrompt("fixed input")).toContain("fixed input");
  });

  it("cleans its workspace after a command failure", async () => {
    const probe = await mkdtemp(path.join(os.tmpdir(), "card-v3-runtime-"));
    const script = path.join(probe, "probe.mjs");
    const marker = path.join(probe, "output.txt");
    await writeFile(script, 'import { writeFile } from "node:fs/promises"; await writeFile(process.argv[3], process.argv[2]); process.exit(7);');
    const runner = createCommandRunner(`${JSON.stringify(process.execPath)} ${JSON.stringify(script)} "{{outputDir}}" ${JSON.stringify(marker)}`, 5_000);
    try {
      await expect(runner.run({ id: "job" } as never, "prompt")).rejects.toThrow("codex_card_news_failed:7");
      const outputDir = await readFile(marker, "utf8");
      await expect(access(path.dirname(outputDir))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(probe, { recursive: true, force: true });
    }
  });
});
