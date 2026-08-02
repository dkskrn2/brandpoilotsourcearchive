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
  const probeDir = await mkdtemp(path.join(os.tmpdir(), "blog-cleanup-probe-"));
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
        ? /codex_blog_(timeout|failed)/
        : "codex_blog_failed:7");
    const outputDir = await readFile(markerFile, "utf8");
    await expect(access(path.dirname(outputDir))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(markerFile)).resolves.toBeUndefined();
  } finally {
    await rm(probeDir, { recursive: true, force: true });
  }
}

describe("blog production runtime", () => {
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
    expect(worker).toMatch(/path\.join\(os\.tmpdir\(\),\s*"brand-pilot-blog-"/);
  });

  it("runs Codex in the job workspace with a secret-free environment", async () => {
    const runnerUrl = new URL("../scripts/run-codex-blog.mjs", import.meta.url).href;
    const runner = await import(runnerUrl) as {
      buildCodexArgs(outputDir: string): string[];
      codexChildEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
      codexSpawnOptions(outputDir: string, source: NodeJS.ProcessEnv): {
        cwd: string;
        env: NodeJS.ProcessEnv;
        shell: boolean;
      };
    };
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
    expect(args).toEqual(expect.arrayContaining(["--strict-config", "-C", outputDir]));
    expect(args).toContain("--ignore-user-config");
    expect(args).not.toContain("--sandbox");
    expect(args).not.toContain("danger-full-access");
    expect(args).toEqual(expect.arrayContaining(["-c", 'default_permissions="worker"']));
    expect(args).toEqual(expect.arrayContaining([
      "-c",
      'permissions.worker.filesystem={":minimal"="read","/codex"="deny","/codex/generated_images"="read",":workspace_roots"={"."="write"}}',
    ]));
    expect(args.join(" ")).not.toContain('permissions.worker.filesystem.":workspace_roots"');
    expect(args).toEqual(expect.arrayContaining([
      "-c",
      "permissions.worker.network.enabled=false",
    ]));
    expect(args.join(" ")).toContain('":minimal"="read"');
    expect(args.join(" ")).toContain('"/codex"="deny"');
    expect(args.join(" ")).toContain('"/codex/generated_images"="read"');
    expect(args.join(" ")).toContain("--enable image_generation");
    expect(args.join(" ")).toContain("--enable shell_tool");
    expect(args.join(" ")).toContain("--disable shell_snapshot");
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

  it("runs the v3 HTML planner with an exact schema and no network, file, shell, or image tools", async () => {
    const runnerUrl = new URL("../scripts/run-codex-blog-v2-plan.mjs", import.meta.url).href;
    const runner = await import(runnerUrl) as { buildCodexArgs(outputDir: string): string[]; buildCodexPrompt(prompt: string): string };
    const args = runner.buildCodexArgs(path.resolve("v3-blog-output"));
    const prompt = runner.buildCodexPrompt("writer input");
    const schema = JSON.parse(await read("../scripts/blog-plan-v2.schema.json")) as Record<string, unknown>;
    expect(args.join(" ")).toContain("permissions.writer.network.enabled=false");
    expect(args.join(" ")).toContain('permissions.writer.filesystem={":minimal"="read","/codex"="deny",":workspace_roots"={"."="deny"}}');
    for (const feature of ["shell_tool", "image_generation", "shell_snapshot"]) expect(args).toEqual(expect.arrayContaining(["--disable", feature]));
    expect(args.join(" ")).not.toContain("--search");
    expect(prompt).toContain("파일이나 웹을 조회하지 마세요");
    expect(schema).toMatchObject({ type: "object", additionalProperties: false, required: ["contractVersion", "content", "imagePackage"] });
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    expect(properties.imagePackage.oneOf).toBeTruthy();
    const contentProperties = (properties.content.properties as Record<string, Record<string, unknown>>);
    expect(contentProperties.title.maxLength).toBe(500);
    expect(contentProperties.metaTitle.maxLength).toBe(500);
    expect(contentProperties.metaDescription.maxLength).toBe(2_000);
  });

  it("stages the blog skill and removes only image sessions created by that job", async () => {
    const probeRoot = await mkdtemp(path.join(os.tmpdir(), "blog-runtime-probe-"));
    const generatedImagesDirectory = path.join(probeRoot, "generated_images");
    const existingSession = path.join(generatedImagesDirectory, "existing-session");
    const unrelatedFile = path.join(generatedImagesDirectory, "auth.json");
    const probeFile = path.join(probeRoot, "probe.mjs");
    await mkdir(existingSession, { recursive: true });
    await writeFile(unrelatedFile, "keep", "utf8");
    await writeFile(probeFile, [
      'import { access, mkdir, writeFile } from "node:fs/promises";',
      "const [outputDir, generatedRoot] = process.argv.slice(2);",
      "await access(new URL('./.agents/skills/blog-writer/SKILL.md', `file://${outputDir}/`));",
      "await mkdir(`${generatedRoot}/owned-session`, { recursive: true });",
      "await writeFile(`${generatedRoot}/owned-session/image.png`, 'owned', 'utf8');",
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
      await expect(access(path.join(output.outputDir, ".agents", "skills", "blog-writer", "SKILL.md")))
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
    expect(dockerfile).toContain("run-codex-blog.mjs");
    expect(dockerfile).toContain("run-codex-blog-v2-plan.mjs");
    expect(dockerfile).toContain("blog-plan-v2.schema.json");
    expect(dockerfile).toContain("blog-writer/SKILL.md");
    expect(dockerfile).toContain("workers/brand-pilot-blog-worker/dist/index.js");
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).not.toMatch(/OPENAI_API_KEY|docker\.sock|tsx\/esm\/api/);
  });

  it.each(["failure", "timeout"] as const)(
    "removes only its job workspace after a command %s",
    expectFailedWorkspaceCleanup,
  );
});
