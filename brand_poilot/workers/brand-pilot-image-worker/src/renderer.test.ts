import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCommandRenderer,
  createConfiguredRenderer,
  loadRenderedPackage,
  normalizeRenderedPng,
  parseRenderCommandTemplate
} from "./renderer.js";
import type { ClaimedImageJob } from "./worker.js";

const temporaryDirectories: string[] = [];
const hashtags = ["#one", "#two", "#three", "#four", "#five"];

function jobFor(
  deliveryFormat: "instagram_feed_carousel" | "instagram_story" | "instagram_reel"
): ClaimedImageJob {
  const promptVersion = deliveryFormat === "instagram_feed_carousel"
    ? "worker-card.v4"
    : deliveryFormat === "instagram_story"
      ? "worker-story.v1"
      : "worker-reel.v3";
  return {
    id: "job-1",
    leaseToken: "lease-1",
    brandId: "brand-1",
    channelOutputId: "output-1",
    payload: { deliveryFormat, promptVersion, maxImages: 5 }
  };
}

function asset(index: number, height: 1080 | 1920) {
  return {
    index,
    role: `role-${index}`,
    embeddedText: `message-${index}`,
    width: 1080,
    height
  };
}

async function outputDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "brand-pilot-renderer-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function png(width: number, height: number) {
  return sharp({
    create: { width, height, channels: 4, background: "#ffffff" }
  }).png().toBuffer();
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("configured image renderer", () => {
  it("parses quoted command paths before substituting placeholder paths with spaces", () => {
    expect(parseRenderCommandTemplate(
      '"C:\\Program Files\\nodejs\\node.exe" "C:\\worker scripts\\runner.mjs" --job "{{jobFile}}" --output={{outputDir}} --workspace "{{workspaceDir}}"',
      {
        jobFile: "C:\\render jobs\\job.json",
        outputDir: "C:\\render jobs\\output files",
        workspaceDir: "C:\\render jobs\\codex workspace"
      }
    )).toEqual({
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: [
        "C:\\worker scripts\\runner.mjs",
        "--job",
        "C:\\render jobs\\job.json",
        "--output=C:\\render jobs\\output files",
        "--workspace",
        "C:\\render jobs\\codex workspace"
      ]
    });
  });

  it("stages an isolated Codex workspace and passes it to the direct renderer process", async () => {
    const codexHome = await outputDirectory();
    const assetRoot = await outputDirectory();
    await mkdir(path.join(assetRoot, ".codex", "skills", "image-render"), { recursive: true });
    await Promise.all([
      writeFile(path.join(assetRoot, "AGENTS.md"), "isolated agents"),
      writeFile(path.join(assetRoot, ".codex", "skills", "image-render", "SKILL.md"), "isolated image skill")
    ]);
    const spawnProcess = vi.fn((command: string, args: string[], options: Record<string, unknown>) => {
      const child = new EventEmitter() as EventEmitter & { kill: () => boolean };
      child.kill = vi.fn(() => true);
      const outputDir = args[args.indexOf("--output") + 1];
      const workspaceDir = args[args.indexOf("--workspace") + 1];
      expect(workspaceDir).toMatch(/brand-pilot-image-job-.+[\\/]workspace$/);
      expect(workspaceDir).not.toBe(assetRoot);
      expect(readFileSync(path.join(workspaceDir, "AGENTS.md"), "utf8")).toBe("isolated agents");
      expect(readFileSync(path.join(workspaceDir, ".codex", "skills", "image-render", "SKILL.md"), "utf8"))
        .toBe("isolated image skill");
      void (async () => {
        await Promise.all([
          writeFile(path.join(outputDir, "card-01.png"), await png(1, 1)),
          writeFile(path.join(outputDir, "content.json"), JSON.stringify({
          deliveryFormat: "instagram_feed_carousel",
          promptVersion: "worker-card.v4",
          selectedAssetCount: 1,
          caption: "first paragraph\n\nsecond paragraph",
          hashtags,
          cards: [{ ...asset(1, 1080), width: 1, height: 1 }]
          }))
        ]);
        child.emit("exit", 0);
      })();
      return child;
    });
    const renderer = createCommandRenderer(
      'node "runner script.mjs" --job "{{jobFile}}" --output "{{outputDir}}" --workspace "{{workspaceDir}}"',
      10_000,
      {
        spawnProcess,
        assetRoot,
        env: {
          PATH: "/usr/bin",
          CODEX_HOME: codexHome,
          WORKER_API_TOKEN: "worker-secret",
          DATABASE_URL: "postgres://secret",
          BLOB_READ_WRITE_TOKEN: "blob-secret"
        }
      }
    );

    await expect(renderer.renderJob(jobFor("instagram_feed_carousel")))
      .resolves.toMatchObject({ images: [{ width: 1, height: 1 }] });

    expect(spawnProcess).toHaveBeenCalledWith(
      "node",
      [
        "runner script.mjs",
        "--job",
        expect.stringMatching(/job\.json$/),
        "--output",
        expect.stringMatching(/output$/),
        "--workspace",
        expect.stringMatching(/[\\/]workspace$/)
      ],
      expect.objectContaining({
        shell: false,
        windowsHide: true,
        cwd: expect.stringMatching(/brand-pilot-image-job-/),
        env: expect.objectContaining({ PATH: "/usr/bin", CODEX_HOME: codexHome })
      })
    );
    const childEnv = spawnProcess.mock.calls[0]?.[2]?.env as Record<string, string>;
    expect(childEnv).not.toHaveProperty("WORKER_API_TOKEN");
    expect(childEnv).not.toHaveProperty("DATABASE_URL");
    expect(childEnv).not.toHaveProperty("BLOB_READ_WRITE_TOKEN");
  });

  it("terminates the detached Linux render process group before reporting timeout", async () => {
    vi.useFakeTimers();
    try {
      const codexHome = await outputDirectory();
      const assetRoot = await outputDirectory();
      await mkdir(path.join(assetRoot, ".codex", "skills", "image-render"), { recursive: true });
      await Promise.all([
        writeFile(path.join(assetRoot, "AGENTS.md"), "isolated agents"),
        writeFile(path.join(assetRoot, ".codex", "skills", "image-render", "SKILL.md"), "isolated image skill")
      ]);
      const child = new EventEmitter() as EventEmitter & {
        pid: number;
        kill: ReturnType<typeof vi.fn>;
      };
      child.pid = 4321;
      child.kill = vi.fn();
      let notifySpawned = () => undefined;
      const spawned = new Promise<void>((resolve) => {
        notifySpawned = resolve;
      });
      const spawnProcess = vi.fn((_command: string, _args: string[], options: Record<string, unknown>) => {
        expect(options).toMatchObject({ detached: true, shell: false });
        notifySpawned();
        return child;
      });
      const killProcess = vi.fn();
      const renderer = createCommandRenderer(
        'node runner.mjs --job "{{jobFile}}" --output "{{outputDir}}" --workspace "{{workspaceDir}}"',
        100,
        {
          spawnProcess,
          assetRoot,
          env: { PATH: "/usr/bin", CODEX_HOME: codexHome },
          platform: "linux",
          killProcess,
          terminationGraceMs: 50
        }
      );

      const rendering = renderer.renderJob(jobFor("instagram_feed_carousel"));
      await spawned;
      await vi.advanceTimersByTimeAsync(100);
      expect(killProcess).toHaveBeenCalledWith(-4321, "SIGTERM");
      await vi.advanceTimersByTimeAsync(50);
      expect(killProcess).toHaveBeenCalledWith(-4321, "SIGKILL");
      child.emit("exit", null);

      await expect(rendering).rejects.toThrow("image_render_command_timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects the fixture renderer outside automated tests", () => {
    expect(() => createConfiguredRenderer({ provider: "fixture", nodeEnv: "development" })).toThrow("fixture_renderer_test_only");
  });

  it("keeps the feed fixture compatible in the test environment", async () => {
    const renderer = createConfiguredRenderer({ provider: "fixture", nodeEnv: "test" });

    const rendered = await renderer.renderJob(jobFor("instagram_feed_carousel"));

    expect(rendered.manifest.deliveryFormat).toBe("instagram_feed_carousel");
    expect(rendered.manifest.hashtags).toHaveLength(5);
    expect(rendered.images).toEqual([
      expect.objectContaining({ index: 1, mimeType: "image/png", width: 1080, height: 1080 })
    ]);
  });

  it.each([
    ["instagram_feed_carousel", 1080] as const,
    ["instagram_story", 1920] as const,
    ["instagram_reel", 1920] as const
  ])("normalizes %s PNGs to 1080 by %i", async (deliveryFormat, height) => {
    const source = await png(deliveryFormat === "instagram_feed_carousel" ? 1254 : 1125, deliveryFormat === "instagram_feed_carousel" ? 1254 : 2000);

    const normalized = await normalizeRenderedPng(source, { width: 1080, height });
    const metadata = await sharp(normalized).metadata();

    expect(metadata).toMatchObject({ format: "png", width: 1080, height });
  });

  it("rejects a feed card with a non-square source instead of cropping text", async () => {
    const source = await png(1200, 900);

    await expect(normalizeRenderedPng(source, { width: 1080, height: 1080 }))
      .rejects.toThrow("image_render_output_aspect_ratio_invalid");
  });

  it("preserves a square feed image without resizing", async () => {
    const directory = await outputDirectory();
    await Promise.all([
      writeFile(path.join(directory, "card-01.png"), await png(1254, 1254)),
      writeFile(path.join(directory, "content.json"), JSON.stringify({
        deliveryFormat: "instagram_feed_carousel",
        promptVersion: "worker-card.v4",
        selectedAssetCount: 1,
        caption: "first paragraph\n\nsecond paragraph",
        hashtags,
        cards: [{ ...asset(1, 1080), width: 1254, height: 1254 }]
      }))
    ]);

    const rendered = await loadRenderedPackage(jobFor("instagram_feed_carousel"), directory);

    expect(rendered.images[0]).toMatchObject({ width: 1254, height: 1254 });
    await expect(sharp(rendered.images[0].bytes).metadata()).resolves.toMatchObject({ width: 1254, height: 1254 });
  });

  it("loads the actual Story asset count and deterministic story.png name from the validated manifest", async () => {
    const directory = await outputDirectory();
    await writeFile(path.join(directory, "story.png"), await png(1024, 1536));
    await writeFile(path.join(directory, "content.json"), JSON.stringify({
      deliveryFormat: "instagram_story",
      promptVersion: "worker-story.v1",
      selectedAssetCount: 1,
      story: [asset(1, 1920)]
    }));

    const rendered = await loadRenderedPackage(jobFor("instagram_story"), directory);

    expect(rendered.manifest).toMatchObject({
      deliveryFormat: "instagram_story",
      selectedAssetCount: 1,
      validation: { passed: true }
    });
    expect(rendered.images).toEqual([
      expect.objectContaining({ index: 1, width: 1024, height: 1536 })
    ]);
  });

  it("loads one to five Reel scenes by scene-NN.png while maxImages remains only an upper bound", async () => {
    const directory = await outputDirectory();
    await Promise.all([
      writeFile(path.join(directory, "scene-01.png"), await png(1024, 1536)),
      writeFile(path.join(directory, "content.json"), JSON.stringify({
        deliveryFormat: "instagram_reel",
        promptVersion: "worker-reel.v3",
        selectedAssetCount: 1,
        caption: "first paragraph\n\nsecond paragraph",
        hashtags,
        scenes: [asset(1, 1920)]
      }))
    ]);

    const rendered = await loadRenderedPackage(jobFor("instagram_reel"), directory);

    expect(rendered.manifest.selectedAssetCount).toBe(1);
    expect(rendered.images).toHaveLength(1);
    expect(rendered.images.every((image) => image.width === 1024 && image.height === 1536)).toBe(true);
  });

  it("rejects generated file counts that disagree with the validated manifest", async () => {
    const directory = await outputDirectory();
    await Promise.all([
      writeFile(path.join(directory, "card-01.png"), await png(1080, 1080)),
      writeFile(path.join(directory, "card-02.png"), await png(1080, 1080)),
      writeFile(path.join(directory, "content.json"), JSON.stringify({
        deliveryFormat: "instagram_feed_carousel",
        promptVersion: "worker-card.v4",
        selectedAssetCount: 1,
        caption: "first paragraph\n\nsecond paragraph",
        hashtags,
        cards: [asset(1, 1080)]
      }))
    ]);

    await expect(loadRenderedPackage(jobFor("instagram_feed_carousel"), directory))
      .rejects.toThrow("image_render_output_count_mismatch");
  });
});
