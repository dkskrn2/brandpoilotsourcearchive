import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("production image worker runtime", () => {
  it("ships syntactically valid ai-content asset runner JavaScript", () => {
    const runner = path.join(workerRoot, "scripts", "run-codex-ai-content-asset.mjs");
    const result = spawnSync(process.execPath, ["--check", runner], { encoding: "utf8" });

    expect(result.status, result.stderr).toBe(0);
  });

  it("emits runnable JavaScript and loads only compiled runtime modules", async () => {
    const [packageSource, runnerSource, textRunnerSource, rendererSource, indexSource, shutdownSource] = await Promise.all([
      readFile(path.join(workerRoot, "package.json"), "utf8"),
      readFile(path.join(workerRoot, "scripts", "run-codex-image-render.mjs"), "utf8"),
      readFile(path.join(workerRoot, "src", "codexTextRunner.ts"), "utf8"),
      readFile(path.join(workerRoot, "src", "renderer.ts"), "utf8"),
      readFile(path.join(workerRoot, "src", "index.ts"), "utf8"),
      readFile(path.join(workerRoot, "src", "aiContentShutdown.ts"), "utf8")
    ]);
    const packageJson = JSON.parse(packageSource) as { scripts: Record<string, string> };

    expect(packageJson.scripts.pretest).toBe("npm run build --workspace @brand-pilot/worker-runtime");
    expect(packageJson.scripts.build).toBe("npm run build --workspace @brand-pilot/worker-runtime && tsc -p tsconfig.build.json");
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
    expect(shutdownSource).toContain("new AbortController()");
    expect(indexSource).toMatch(/process\.once\("SIGTERM"/);
    expect(indexSource).toMatch(/process\.once\("SIGINT"/);
    expect(indexSource).toContain("signal: shutdown.signal");
    expect(indexSource).toContain("onAiContentActivityChange");
    expect(indexSource).toContain("createAiContentShutdownCoordinator");
    expect(indexSource).toContain("process.kill(process.pid, signal)");
    expect(indexSource).toContain("waitForShutdownOrTimeout");
    expect(indexSource).toContain('process.env.IMAGE_MODEL ?? "gpt-image-2"');
    expect(indexSource).toMatch(/process\.removeListener\("SIGTERM"/);
    expect(indexSource).toMatch(/process\.removeListener\("SIGINT"/);
  });

  it("ships a single-asset built-in image_generation runner with no network or fixture fallback", async () => {
    const [packageSource, runnerSource, skillSource, dockerfile] = await Promise.all([
      readFile(path.join(workerRoot, "package.json"), "utf8"),
      readFile(path.join(workerRoot, "scripts", "run-codex-ai-content-asset.mjs"), "utf8"),
      readFile(path.join(workerRoot, ".codex", "skills", "image-render", "SKILL.md"), "utf8"),
      readFile(path.join(workerRoot, "Dockerfile"), "utf8"),
    ]);
    const packageJson = JSON.parse(packageSource) as { dependencies: Record<string, string> };
    expect(packageJson.dependencies["@brand-pilot/worker-runtime"]).toBe("0.1.0");
    expect(runnerSource).toContain("../dist/codexCommand.mjs");
    expect(runnerSource).toContain("../dist/codexImageOutput.mjs");
    expect(runnerSource).toContain('readFile(path.join(workspaceDir, "AGENTS.md"');
    expect(runnerSource).toContain('image-render", "SKILL.md"');
    expect(runnerSource).toMatch(/selectedAssetCount:\s*1/);
    expect(runnerSource).toContain("image_generation");
    expect(runnerSource).toContain("permissions.worker.network.enabled=false");
    expect(runnerSource).not.toMatch(/fixture|OPENAI_API_KEY|external image api/i);
    expect(runnerSource).toContain("rm(path.join(imagegenOutputDir, ownedSessionId)");
    expect(skillSource).toContain("작업 하나당 정확히 PNG 한 장");
    expect(skillSource).toContain("gpt-image-2");
    expect(skillSource).toContain("1:1");
    expect(skillSource).toContain("4:5");
    expect(skillSource).toContain("16:9");
    expect(skillSource).toContain("9:16");
    expect(skillSource).toContain("콜라주");
    expect(skillSource).toContain("ai-content-render-job.v2");
    expect(skillSource).toMatch(/최종 픽셀/);
    expect(skillSource).toMatch(/배경.*이미지만.*만들지/);
    expect(skillSource).toMatch(/서버.*텍스트.*합성.*없/);
    expect(skillSource).toContain("ai-content-asset-render.v2");
    expect(dockerfile).toContain("run-codex-ai-content-asset.mjs");
  });

  it("packages the pinned Codex CLI and native render dependencies as a non-root image", async () => {
    const [dockerfile, lockSource] = await Promise.all([
      readFile(path.join(workerRoot, "Dockerfile"), "utf8"),
      readFile(path.resolve(workerRoot, "..", "..", "package-lock.json"), "utf8"),
    ]);
    const lock = JSON.parse(lockSource) as { packages: Record<string, { resolved?: string; link?: boolean }> };

    expect(dockerfile).toContain("FROM node:22-bookworm-slim AS build");
    expect(dockerfile).toContain("FROM node:22-bookworm-slim AS runtime");
    expect(dockerfile).toContain("@openai/codex@0.145.0");
    expect(dockerfile).toContain("bubblewrap");
    expect(dockerfile).toMatch(/ca-certificates/);
    expect(dockerfile).toMatch(/python3/);
    expect(dockerfile).toMatch(/ffmpeg/);
    expect(dockerfile).toContain("CODEX_HOME=/codex-accounts/primary");
    expect(dockerfile).toContain("CODEX_ACCOUNT_PROFILES=primary,secondary");
    expect(dockerfile).toContain("CODEX_GENERATED_IMAGES_DIR=/codex-accounts/primary/generated_images");
    expect(dockerfile).toContain("PYTHON=python3");
    expect(dockerfile).toContain("IMAGE_RENDER_COMMAND=");
    expect(dockerfile).toContain('--workspace \\"{{workspaceDir}}\\"');
    expect(dockerfile).toContain("render-reel.py");
    expect(dockerfile).toContain("run-codex-image-render.mjs");
    expect(lock.packages["node_modules/@brand-pilot/worker-runtime"]).toEqual({ resolved: "workers/brand-pilot-worker-runtime", link: true });
    expect(lock.packages["node_modules/@brand-pilot/content-contracts"]).toEqual({ resolved: "packages/brand-pilot-content-contracts", link: true });
    expect(dockerfile).toContain("/app/workers/brand-pilot-worker-runtime/package.json ./workers/brand-pilot-worker-runtime/package.json");
    expect(dockerfile).toContain("/app/workers/brand-pilot-worker-runtime/dist ./workers/brand-pilot-worker-runtime/dist");
    expect(dockerfile).toContain("/app/packages/brand-pilot-content-contracts/package.json ./packages/brand-pilot-content-contracts/package.json");
    expect(dockerfile).toContain("/app/packages/brand-pilot-content-contracts/dist ./packages/brand-pilot-content-contracts/dist");
    expect(dockerfile).toContain("AGENTS.md");
    expect(dockerfile).toContain("image-render/SKILL.md");
    expect(dockerfile).toContain("threads-text/SKILL.md");
    expect(dockerfile).toContain("USER node");
    expect(dockerfile).toContain('CMD ["node", "workers/brand-pilot-image-worker/dist/index.js", "watch"]');
  });

  it("retains the legacy CTA bans while documenting the V3 one-asset contract", async () => {
    const skill = await readFile(path.join(workerRoot, ".codex", "skills", "image-render", "SKILL.md"), "utf8");
    for (const forbidden of ["문의하기", "상담 신청", "지금 확인", "더 알아보기"]) {
      expect(skill).toContain(forbidden);
    }
  });
});
