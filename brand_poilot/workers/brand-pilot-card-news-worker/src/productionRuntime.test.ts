import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createCommandRunner } from "./worker.js";

const read = (relativePath: string) => readFile(
  new URL(relativePath, import.meta.url),
  "utf8",
);

async function expectFailedWorkspaceCleanup(
  mode: "failure" | "timeout",
) {
  const probeDir = await mkdtemp(path.join(os.tmpdir(), "card-news-cleanup-probe-"));
  const probeFile = path.join(probeDir, "probe.mjs");
  const markerFile = path.join(probeDir, "output-dir.txt");
  await writeFile(probeFile, [
    'import { writeFile } from "node:fs/promises";',
    "const [outputDir, markerFile, mode] = process.argv.slice(2);",
    "await writeFile(markerFile, outputDir, 'utf8');",
    "if (mode === 'failure') process.exit(7);",
    "setInterval(() => undefined, 1_000);",
  ].join("\n"), "utf8");
  const command = [
    JSON.stringify(process.execPath),
    JSON.stringify(probeFile),
    '"{{outputDir}}"',
    JSON.stringify(markerFile),
    mode,
  ].join(" ");
  try {
    const runner = createCommandRunner(command, mode === "timeout" ? 500 : 5_000);
    await expect(runner.run({ id: "cleanup-job" } as never, "prompt"))
      .rejects.toThrow(mode === "timeout"
        ? /codex_card_news_(timeout|failed)/
        : "codex_card_news_failed:7");
    const outputDir = await readFile(markerFile, "utf8");
    await expect(access(path.dirname(outputDir))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(markerFile)).resolves.toBeUndefined();
  } finally {
    await rm(probeDir, { recursive: true, force: true });
  }
}

describe("card-news production runtime", () => {
  it("emits production JavaScript and imports the shared runtime package", async () => {
    const [packageJson, tsconfig, promptBuilder, worker] = await Promise.all([
      read("../package.json"),
      read("../tsconfig.json"),
      read("./promptBuilder.ts"),
      read("./worker.ts"),
    ]);

    const packageScripts = JSON.parse(packageJson).scripts as Record<string, string>;
    const buildScript = packageScripts.build;
    expect(packageScripts.pretest).toBe("npm run build --workspace @brand-pilot/worker-runtime");
    expect(buildScript).toContain("npm run build --workspace @brand-pilot/worker-runtime");
    expect(buildScript).toMatch(/\btsc\b/);
    expect(buildScript).not.toContain("--noEmit");
    expect(JSON.parse(tsconfig).compilerOptions).toMatchObject({
      rootDir: "src",
      outDir: "dist",
    });
    expect(JSON.parse(tsconfig).exclude).toContain("src/**/*.test.ts");
    expect(promptBuilder).toContain('from "@brand-pilot/worker-runtime"');
    expect(promptBuilder).not.toContain("brand-pilot-worker-runtime/src");
    expect(worker).toMatch(/path\.join\(os\.tmpdir\(\),\s*"brand-pilot-card-news-"/);
  });

  it.each([
    "run-codex-card-news.mjs",
    "run-codex-card-news-plan.mjs",
    "run-codex-card-news-v2-plan.mjs",
  ])("runs %s in the job workspace with a secret-free environment", async (script) => {
    const runnerUrl = new URL(`../scripts/${script}`, import.meta.url).href;
    const runner = await import(runnerUrl) as {
      buildCodexArgs(outputDir: string): string[];
      codexChildEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
      codexSpawnOptions(outputDir: string, source: NodeJS.ProcessEnv): {
        cwd: string;
        env: NodeJS.ProcessEnv;
        shell: boolean;
      };
    };
    const planner = script !== "run-codex-card-news.mjs";
    const v3Planner = script === "run-codex-card-news-v2-plan.mjs";
    const outputDir = path.resolve("job-output");
    const source = {
      PATH: "/usr/bin",
      CODEX_HOME: "/codex",
      HOME: "/home/node",
      LANG: "C.UTF-8",
      WORKER_API_TOKEN: "worker-secret",
      DATABASE_URL: "database-secret",
      BLOB_READ_WRITE_TOKEN: "blob-secret",
      OPENAI_API_KEY: "api-secret",
    };

    const args = runner.buildCodexArgs(outputDir);
    expect(args.slice(0, 3)).toEqual(["--model", "gpt-5.6-terra", "--strict-config"]);
    expect(args.indexOf("gpt-5.6-terra")).toBeLessThan(args.indexOf("exec"));
    expect(args).toEqual(expect.arrayContaining(["--strict-config", "-C", outputDir]));
    expect(args).toContain("--ignore-user-config");
    expect(args).not.toContain("--sandbox");
    expect(args).not.toContain("danger-full-access");
    expect(args).toEqual(expect.arrayContaining([
      "-c",
      planner
        ? 'default_permissions="planner"'
        : 'default_permissions="worker"',
    ]));
    expect(args).toEqual(expect.arrayContaining([
      "-c",
      v3Planner
        ? 'permissions.planner.filesystem={":minimal"="read","/codex"="deny",":workspace_roots"={"."="deny"}}'
        : planner
        ? 'permissions.planner.filesystem={":minimal"="read","/codex"="deny",":workspace_roots"={"."="read"}}'
        : 'permissions.worker.filesystem={":minimal"="read","/codex"="deny","/codex/generated_images"="read",":workspace_roots"={"."="write"}}',
    ]));
    expect(args.join(" ")).not.toMatch(/permissions\.(?:planner|worker)\.filesystem\.":workspace_roots"/);
    expect(args).toEqual(expect.arrayContaining([
      "-c",
      planner
        ? "permissions.planner.network.enabled=false"
        : "permissions.worker.network.enabled=false",
    ]));
    expect(args.join(" ")).toContain('"/codex"="deny"');
    if (script === "run-codex-card-news.mjs") {
      expect(args.join(" ")).toContain('"/codex/generated_images"="read"');
      expect(args.join(" ")).toContain("--enable image_generation");
      expect(args.join(" ")).toContain("--enable shell_tool");
    }
    expect(runner.codexChildEnv(source)).toEqual({
      PATH: "/usr/bin",
      CODEX_HOME: "/codex",
      HOME: "/home/node",
      LANG: "C.UTF-8",
    });
    expect(runner.codexSpawnOptions(outputDir, source)).toMatchObject({
      cwd: outputDir,
      shell: false,
      env: runner.codexChildEnv(source),
    });
  });

  it("keeps the editorial planner grounded in the provided JSON-only input", async () => {
    const runnerUrl = new URL(
      "../scripts/run-codex-card-news-plan.mjs",
      import.meta.url,
    ).href;
    const runner = await import(runnerUrl) as {
      buildCodexPrompt(prompt: string): string;
      buildCodexArgs(outputDir: string): string[];
    };

    expect(runner.buildCodexPrompt("기획 입력")).toContain("기획 입력");
    expect(runner.buildCodexPrompt("기획 입력")).toContain(
      "도구를 호출하거나 파일을 읽지 말고 제공된 입력만 판단하세요.",
    );
    expect(runner.buildCodexPrompt("기획 입력")).toContain(
      "JSON 외의 설명을 포함하지 마세요.",
    );
    const plannerArgs = runner.buildCodexArgs(path.resolve("planner-output"));
    expect(plannerArgs.join(" ")).toContain("--disable shell_tool");
    expect(plannerArgs.join(" ")).toContain("--disable image_generation");
    expect(plannerArgs.join(" ")).toContain("--disable shell_snapshot");
  });

  it("runs the v3 card-news planner with an exact schema and no file, web, shell, or image tools", async () => {
    const runnerUrl = new URL("../scripts/run-codex-card-news-v2-plan.mjs", import.meta.url).href;
    const runner = await import(runnerUrl) as {
      buildCodexPrompt(prompt: string): string;
      buildCodexArgs(outputDir: string): string[];
    };
    const args = runner.buildCodexArgs(path.resolve("v3-plan-output"));
    const prompt = runner.buildCodexPrompt("상세 기획 입력");
    const schema = JSON.parse(await read("../scripts/card-news-plan-v2.schema.json")) as Record<string, unknown>;

    expect(args.join(" ")).toContain("permissions.planner.network.enabled=false");
    expect(args.join(" ")).toContain('permissions.planner.filesystem={":minimal"="read","/codex"="deny",":workspace_roots"={"."="deny"}}');
    for (const feature of ["shell_tool", "image_generation", "shell_snapshot"]) {
      expect(args).toEqual(expect.arrayContaining(["--disable", feature]));
    }
    expect(args.join(" ")).not.toContain("--search");
    expect(prompt).toContain("파일이나 웹을 조회하지 마세요");
    expect(prompt).toContain("JSON 외의 설명을 포함하지 마세요");
    expect(schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["contractVersion", "content", "imagePackage"],
    });
    expect(JSON.stringify(schema)).not.toContain('"oneOf"');
    expect(JSON.stringify(schema)).not.toContain('"uniqueItems"');
    const constSchemasWithoutType: Record<string, unknown>[] = [];
    const visitSchema = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach(visitSchema);
        return;
      }
      const entry = value as Record<string, unknown>;
      if (Object.hasOwn(entry, "const") && !Object.hasOwn(entry, "type")) {
        constSchemasWithoutType.push(entry);
      }
      Object.values(entry).forEach(visitSchema);
    };
    visitSchema(schema);
    expect(constSchemasWithoutType).toEqual([]);
    const defs = schema.$defs as Record<string, Record<string, unknown>>;
    const styleProperties = defs.styleImage?.properties as Record<string, Record<string, unknown>>;
    expect(styleProperties.description).toMatchObject({ type: "string" });
    expect(styleProperties.description).not.toHaveProperty("minLength");
    expect(styleProperties.tags).toMatchObject({ type: "array", maxItems: 20 });
    expect(styleProperties.tags).not.toHaveProperty("minItems");
    expect(defs.asset?.required).toContain("evidenceIds");
    expect((defs.asset?.properties as Record<string, unknown>).evidenceIds).toMatchObject({
      type: "array", maxItems: 8,
    });
  });

  it.each([
    "run-codex-card-news-plan.mjs",
    "run-codex-card-news-v2-plan.mjs",
  ])("routes a v3 planning job through only the v3 planner when configured with %s", async (configuredRunner) => {
    const probeRoot = await mkdtemp(path.join(os.tmpdir(), "card-v3-command-probe-"));
    const probeFile = path.join(probeRoot, "probe.mjs");
    const markerFile = path.join(probeRoot, "runner.txt");
    await writeFile(probeFile, [
      'import { writeFile } from "node:fs/promises";',
      "const [runnerName, markerFile] = process.argv.slice(2);",
      "await writeFile(markerFile, runnerName, 'utf8');",
    ].join("\n"), "utf8");
    const command = [
      JSON.stringify(process.execPath), JSON.stringify(probeFile),
      configuredRunner, JSON.stringify(markerFile),
      '"{{outputDir}}"',
    ].join(" ");
    const runner = createCommandRunner(command, 5_000);
    try {
      const output = await runner.run({ payload: { contentGenerationInput: { contractVersion: "content-generation-input.v3" } } } as never, "prompt");
      expect(await readFile(markerFile, "utf8")).toBe("run-codex-card-news-v2-plan.mjs");
      await output.cleanup();
    } finally {
      await rm(probeRoot, { recursive: true, force: true });
    }
  });

  it("stages the card skill in the job workspace and removes only new image sessions after cleanup", async () => {
    const probeRoot = await mkdtemp(path.join(os.tmpdir(), "card-runtime-probe-"));
    const generatedImagesDirectory = path.join(probeRoot, "generated_images");
    const existingSession = path.join(generatedImagesDirectory, "existing-session");
    const unrelatedFile = path.join(generatedImagesDirectory, "auth.json");
    const probeFile = path.join(probeRoot, "probe.mjs");
    await mkdir(existingSession, { recursive: true });
    await writeFile(unrelatedFile, "keep", "utf8");
    await writeFile(probeFile, [
      'import { access, mkdir, writeFile } from "node:fs/promises";',
      "const [outputDir, generatedRoot] = process.argv.slice(2);",
      "await access(new URL('./.agents/skills/card-news-creator/SKILL.md', `file://${outputDir}/`));",
      "await mkdir(`${generatedRoot}/owned-session`, { recursive: true });",
      "await writeFile(`${generatedRoot}/owned-session/card.png`, 'owned', 'utf8');",
    ].join("\n"), "utf8");
    const command = [
      JSON.stringify(process.execPath),
      JSON.stringify(probeFile),
      '"{{outputDir}}"',
      JSON.stringify(generatedImagesDirectory),
    ].join(" ");
    const runner = createCommandRunner(command, 5_000, { generatedImagesDirectory });
    try {
      const output = await runner.run({ id: "session-job" } as never, "prompt");
      await expect(access(path.join(output.outputDir, ".agents", "skills", "card-news-creator", "SKILL.md")))
        .resolves.toBeUndefined();
      await expect(access(path.join(generatedImagesDirectory, "owned-session"))).resolves.toBeUndefined();
      await output.cleanup();
      await expect(access(path.join(generatedImagesDirectory, "owned-session")))
        .rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(existingSession)).resolves.toBeUndefined();
      await expect(readFile(unrelatedFile, "utf8")).resolves.toBe("keep");
    } finally {
      await rm(probeRoot, { recursive: true, force: true });
    }
  });

  it("builds a non-root pinned Codex image with only production assets", async () => {
    const dockerfile = await read("../Dockerfile");

    expect(dockerfile).toMatch(/^FROM node:22-bookworm-slim AS build$/m);
    expect(dockerfile).toMatch(/^FROM node:22-bookworm-slim AS runtime$/m);
    expect(dockerfile).toContain("ca-certificates");
    expect(dockerfile).toContain("bubblewrap");
    expect(dockerfile).toContain("@openai/codex@0.145.0");
    expect(dockerfile).toContain("CODEX_HOME=/codex");
    expect(dockerfile).toContain("run-codex-card-news.mjs");
    expect(dockerfile).toContain("run-codex-card-news-plan.mjs");
    expect(dockerfile).toContain("run-codex-card-news-v2-plan.mjs");
    expect(dockerfile).toContain("editorial-plan.schema.json");
    expect(dockerfile).toContain("card-news-plan-v2.schema.json");
    expect(dockerfile).toContain("card-news-creator/SKILL.md");
    expect(dockerfile).toContain("workers/brand-pilot-card-news-worker/dist/index.js");
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).not.toMatch(/OPENAI_API_KEY|docker\.sock|tsx\/esm\/api/);
  });

  it("documents the v3 plan-only responsibility while retaining legacy v2 rendering", async () => {
    const skill = await read("../.agents/skills/card-news-creator/SKILL.md");
    expect(skill).toContain("content-generation-input.v3");
    expect(skill).toContain("ImageGenerationPackageV1");
    expect(skill).toContain("이미지 파일을 생성하지 않습니다");
    expect(skill).toContain("1~5장");
    expect(skill).toContain("장수와 순서");
    expect(skill).toContain("로고");
    expect(skill).toContain("부실하지 않게");
    expect(skill).toContain("content-generation-input.v2");
    expect(skill).toContain("slide-01.png");
  });

  it.each(["failure", "timeout"] as const)(
    "removes only its job workspace after a command %s",
    expectFailedWorkspaceCleanup,
  );
});
