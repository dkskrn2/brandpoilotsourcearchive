import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("production image worker runtime", () => {
  it("emits runnable JavaScript and loads only compiled runtime modules", async () => {
    const [packageSource, runnerSource, textRunnerSource, rendererSource] = await Promise.all([
      readFile(path.join(workerRoot, "package.json"), "utf8"),
      readFile(path.join(workerRoot, "scripts", "run-codex-image-render.mjs"), "utf8"),
      readFile(path.join(workerRoot, "src", "codexTextRunner.ts"), "utf8"),
      readFile(path.join(workerRoot, "src", "renderer.ts"), "utf8")
    ]);
    const packageJson = JSON.parse(packageSource) as { scripts: Record<string, string> };

    expect(packageJson.scripts.build).toBe("tsc -p tsconfig.build.json");
    expect(packageJson.scripts.start).toBe("node dist/index.js watch");
    expect(runnerSource).not.toContain("tsx/esm/api");
    expect(runnerSource).not.toMatch(/\.\.\/src\/.+\.ts/);
    expect(runnerSource).toContain("../dist/manifest.js");
    expect(runnerSource).toContain("../dist/codexCommand.mjs");
    expect(runnerSource).toContain("../dist/codexImageOutput.mjs");
    expect(runnerSource).toContain("../dist/processTermination.mjs");
    for (const childSource of [runnerSource, textRunnerSource, rendererSource]) {
      expect(childSource).toContain("buildImageWorkerChildEnvironment");
      expect(childSource).not.toMatch(/env:\s*process\.env/);
    }
    expect(textRunnerSource).toMatch(/shell:\s*false/);
    expect(textRunnerSource).toMatch(/cwd:\s*rootDir/);
    expect(runnerSource).toContain('argument("--workspace")');
    expect(runnerSource).toMatch(/buildCodexExecArguments\(\{\s*rootDir:\s*workspaceDir\s*\}\)/);
    expect(runnerSource).toMatch(/cwd:\s*workspaceDir/);
    expect(runnerSource).toContain("forwardParentTermination");
    expect(rendererSource).toContain(".codex");
    expect(rendererSource).toContain("image-render");
    expect(rendererSource).toMatch(/detached:\s*platform\s*!==\s*"win32"/);
    expect(rendererSource).not.toMatch(/shell:\s*true/);
    expect(runnerSource).toContain("rm(path.join(imagegenOutputDir, ownedSessionId)");
  });

  it("packages the pinned Codex CLI and native render dependencies as a non-root image", async () => {
    const dockerfile = await readFile(path.join(workerRoot, "Dockerfile"), "utf8");

    expect(dockerfile).toContain("FROM node:22-bookworm-slim AS build");
    expect(dockerfile).toContain("FROM node:22-bookworm-slim AS runtime");
    expect(dockerfile).toContain("@openai/codex@0.145.0");
    expect(dockerfile).toContain("bubblewrap");
    expect(dockerfile).toMatch(/ca-certificates/);
    expect(dockerfile).toMatch(/python3/);
    expect(dockerfile).toMatch(/ffmpeg/);
    expect(dockerfile).toContain("CODEX_HOME=/codex");
    expect(dockerfile).toContain("CODEX_GENERATED_IMAGES_DIR=/codex/generated_images");
    expect(dockerfile).toContain("PYTHON=python3");
    expect(dockerfile).toContain("IMAGE_RENDER_COMMAND=");
    expect(dockerfile).toContain('--workspace \\"{{workspaceDir}}\\"');
    expect(dockerfile).toContain("render-reel.py");
    expect(dockerfile).toContain("run-codex-image-render.mjs");
    expect(dockerfile).toContain("AGENTS.md");
    expect(dockerfile).toContain("image-render/SKILL.md");
    expect(dockerfile).toContain("threads-text/SKILL.md");
    expect(dockerfile).toContain("USER node");
    expect(dockerfile).toContain('CMD ["node", "workers/brand-pilot-image-worker/dist/index.js", "watch"]');
  });
});
