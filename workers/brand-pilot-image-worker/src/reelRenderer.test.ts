import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseWorkerManifest } from "./manifest.js";
import { createReelRenderer, type ReelProbe } from "./reelRenderer.js";
import type { ReelRenderInput, RenderedImage } from "./worker.js";

const hashtags = ["#one", "#two", "#three", "#four", "#five"];

function scene(index: number): RenderedImage {
  return {
    index,
    bytes: Buffer.from(`png-${index}`),
    mimeType: "image/png",
    width: 1080,
    height: 1920
  };
}

function inputFor(count = 3): ReelRenderInput {
  const scenes = Array.from({ length: count }, (_, index) => scene(index + 1));
  return {
    job: {
      id: "job-1",
      leaseToken: "lease-1",
      brandId: "brand-1",
      channelOutputId: "output-1",
      payload: {}
    },
    scenes,
    manifest: parseWorkerManifest({
      deliveryFormat: "instagram_reel",
      promptVersion: "worker-reel.v1",
      selectedAssetCount: count,
      caption: "first paragraph\n\nsecond paragraph",
      hashtags,
      scenes: scenes.map(({ index, width, height }) => ({
        index,
        role: `role-${index}`,
        embeddedText: `message-${index}`,
        width,
        height
      }))
    }) as ReelRenderInput["manifest"]
  };
}

function validProbe(sceneCount = 3): ReelProbe {
  return {
    width: 1080,
    height: 1920,
    videoCodec: "h264",
    audioCodec: "aac",
    fps: 30,
    duration: 3 * sceneCount - 0.25 * (sceneCount - 1)
  };
}

function rendererFixture({
  probeResult = validProbe(),
  coverBytes = Buffer.from("cover"),
  videoBytes = Buffer.from("video")
}: {
  probeResult?: ReelProbe;
  coverBytes?: Buffer;
  videoBytes?: Buffer;
} = {}) {
  const runPython = vi.fn(async (_executable: string, args: readonly string[]) => {
    const valueAfter = (flag: string) => args[args.indexOf(flag) + 1];
    await writeFile(valueAfter("--cover"), coverBytes);
    await writeFile(valueAfter("--output"), videoBytes);
  });
  const probe = vi.fn(async () => probeResult);
  return { renderer: createReelRenderer({ runPython, probe }), runPython, probe };
}

describe("Reel renderer", () => {
  it("writes ordered scenes and a manifest, invokes safe argument arrays, and returns validated media", async () => {
    const scriptPath = "C:\\renderer dir\\render-reel.py;&echo unsafe";
    let writtenManifest: unknown;
    const runPython = vi.fn(async (_executable: string, args: readonly string[]) => {
      const valueAfter = (flag: string) => args[args.indexOf(flag) + 1];
      writtenManifest = JSON.parse(await readFile(valueAfter("--manifest"), "utf8"));
      await expect(readFile(path.join(valueAfter("--input-dir"), "scene-01.png"))).resolves.toEqual(Buffer.from("png-1"));
      await expect(readFile(path.join(valueAfter("--input-dir"), "scene-03.png"))).resolves.toEqual(Buffer.from("png-3"));
      await writeFile(valueAfter("--cover"), Buffer.from("cover"));
      await writeFile(valueAfter("--output"), Buffer.from("video"));
    });
    const probe = vi.fn(async () => validProbe());
    const renderer = createReelRenderer({
      pythonExecutable: "python-custom",
      ffprobeExecutable: "ffprobe-custom",
      scriptPath,
      runPython,
      probe
    });

    const result = await renderer.render(inputFor());

    expect(writtenManifest).toMatchObject({
      deliveryFormat: "instagram_reel",
      selectedAssetCount: 3,
      scenes: [{ index: 1 }, { index: 2 }, { index: 3 }]
    });
    expect(runPython).toHaveBeenCalledWith("python-custom", [
      scriptPath,
      "--input-dir", expect.any(String),
      "--manifest", expect.stringMatching(/content\.json$/),
      "--output", expect.stringMatching(/reel\.mp4$/),
      "--cover", expect.stringMatching(/cover\.png$/),
      "--seconds-per-scene", "3",
      "--fade-seconds", "0.25",
      "--fps", "30"
    ]);
    expect(probe).toHaveBeenCalledWith("ffprobe-custom", [
      "-v", "error", "-show_streams", "-show_format", "-of", "json", expect.stringMatching(/reel\.mp4$/)
    ]);
    expect(result).toEqual({
      cover: { bytes: Buffer.from("cover"), mimeType: "image/png", width: 1080, height: 1920 },
      video: {
        bytes: Buffer.from("video"),
        mimeType: "video/mp4",
        width: 1080,
        height: 1920,
        videoCodec: "h264",
        audioCodec: "aac",
        fps: 30
      }
    });
  });

  it.each([0, 6])("rejects %i scenes before starting Python", async (count) => {
    const { renderer, runPython } = rendererFixture({ probeResult: validProbe(count) });
    const input = inputFor(count === 0 ? 1 : 5);
    input.scenes = count === 0 ? [] : [...input.scenes, scene(6)];

    await expect(renderer.render(input)).rejects.toThrow("invalid_reel_scene_count");
    expect(runPython).not.toHaveBeenCalled();
  });

  it.each([
    ["codec", { videoCodec: "vp9", audioCodec: null }, "invalid_reel_codec"],
    ["dimensions", { width: 1920, height: 1080 }, "invalid_reel_dimensions"],
    ["fps", { fps: 29.97 }, "invalid_reel_fps"],
    ["duration", { duration: 8.71 }, "invalid_reel_duration"]
  ])("rejects invalid %s probe output", async (_name, override, error) => {
    const { renderer } = rendererFixture({ probeResult: { ...validProbe(), ...override } });

    await expect(renderer.render(inputFor())).rejects.toThrow(error as string);
  });

  it.each([
    ["cover", Buffer.alloc(0), Buffer.from("video"), "invalid_reel_cover_empty"],
    ["MP4", Buffer.from("cover"), Buffer.alloc(0), "invalid_reel_output_empty"]
  ])("rejects an empty %s output", async (_name, coverBytes, videoBytes, error) => {
    const { renderer, probe } = rendererFixture({ coverBytes, videoBytes });

    await expect(renderer.render(inputFor())).rejects.toThrow(error);
    expect(probe).not.toHaveBeenCalled();
  });
});
