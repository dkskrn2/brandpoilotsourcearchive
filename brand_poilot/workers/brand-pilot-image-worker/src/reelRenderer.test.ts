import { EventEmitter } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { parseWorkerManifest } from "./manifest.js";
import type { PreparedReelMusic } from "./reelMusic.js";
import { createAiContentReelRenderer, createReelRenderer, runReelProcess, type ReelProbe } from "./reelRenderer.js";
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

function inputFor(count = 1): ReelRenderInput {
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
      promptVersion: "worker-reel.v3",
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

function validProbe(sceneCount = 1): ReelProbe {
  return {
    width: 1080,
    height: 1920,
    videoCodec: "h264",
    audioCodec: "aac",
    fps: 30,
    duration: 7 * sceneCount - 0.25 * (sceneCount - 1)
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
  const prepareMusic = vi.fn(async (_jobId: string, workDir: string): Promise<PreparedReelMusic> => ({
    track: { id: "mixkit-curiosity", title: "Curiosity", url: "https://assets.mixkit.co/music/480/480.mp3" },
    filePath: path.join(workDir, "mixkit-curiosity.mp3")
  }));
  const runPython = vi.fn(async (_executable: string, args: readonly string[]) => {
    const valueAfter = (flag: string) => args[args.indexOf(flag) + 1];
    await writeFile(valueAfter("--cover"), coverBytes);
    await writeFile(valueAfter("--output"), videoBytes);
  });
  const probe = vi.fn(async () => probeResult);
  return { renderer: createReelRenderer({ runPython, probe, prepareMusic }), runPython, probe, prepareMusic };
}

describe("Reel renderer", () => {
  it("writes ordered scenes and a manifest, invokes safe argument arrays, and returns validated media", async () => {
    const scriptPath = "C:\\renderer dir\\render-reel.py;&echo unsafe";
    let writtenManifest: unknown;
    const runPython = vi.fn(async (_executable: string, args: readonly string[]) => {
      const valueAfter = (flag: string) => args[args.indexOf(flag) + 1];
      writtenManifest = JSON.parse(await readFile(valueAfter("--manifest"), "utf8"));
      await expect(readFile(path.join(valueAfter("--input-dir"), "scene-01.png"))).resolves.toEqual(Buffer.from("png-1"));
      await writeFile(valueAfter("--cover"), Buffer.from("cover"));
      await writeFile(valueAfter("--output"), Buffer.from("video"));
    });
    const probe = vi.fn(async () => validProbe());
    const prepareMusic = vi.fn(async (_jobId: string, workDir: string): Promise<PreparedReelMusic> => ({
      track: { id: "mixkit-relaxation-05", title: "Relaxation 05", url: "https://assets.mixkit.co/music/749/749.mp3" },
      filePath: path.join(workDir, "music.mp3")
    }));
    const renderer = createReelRenderer({
      pythonExecutable: "python-custom",
      ffprobeExecutable: "ffprobe-custom",
      scriptPath,
      runPython,
      probe,
      prepareMusic
    });

    const result = await renderer.render(inputFor());

    expect(writtenManifest).toMatchObject({
      deliveryFormat: "instagram_reel",
      selectedAssetCount: 1,
      scenes: [{ index: 1 }]
    });
    expect(prepareMusic).toHaveBeenCalledWith("job-1", expect.stringMatching(/brand-pilot-reel-/));
    expect(runPython).toHaveBeenCalledWith("python-custom", [
      scriptPath,
      "--input-dir", expect.any(String),
      "--manifest", expect.stringMatching(/content\.json$/),
      "--output", expect.stringMatching(/reel\.mp4$/),
      "--cover", expect.stringMatching(/cover\.png$/),
      "--audio", expect.stringMatching(/music\.mp3$/),
      "--seconds-per-scene", "7",
      "--fade-seconds", "0.25",
      "--audio-volume", "0.12",
      "--audio-fade-seconds", "0.5",
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

  it.each([0, 2])("rejects %i scenes before downloading music or starting Python", async (count) => {
    const { renderer, runPython } = rendererFixture({ probeResult: validProbe(count) });
    const input = inputFor(1);
    input.scenes = count === 0 ? [] : [...input.scenes, scene(2)];

    await expect(renderer.render(input)).rejects.toThrow("invalid_reel_scene_count");
    expect(runPython).not.toHaveBeenCalled();
  });

  it("fails before Python when BGM preparation fails", async () => {
    const runPython = vi.fn();
    const prepareMusic = vi.fn(async () => {
      throw new Error("invalid_reel_music_file");
    });
    const renderer = createReelRenderer({ runPython, prepareMusic });

    await expect(renderer.render(inputFor(1))).rejects.toThrow("invalid_reel_music_file");
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

describe("ai-content.v2 Reel renderer", () => {
  function aiContentFixture(count: number, probeResult: ReelProbe = {
    width: 1080,
    height: 1920,
    videoCodec: "h264",
    audioCodec: null,
    videoStreamCount: 1,
    audioStreamCount: 0,
    fps: 30,
    duration: count * 4
  }) {
    const runPython = vi.fn(async (_executable: string, args: readonly string[]) => {
      const valueAfter = (flag: string) => args[args.indexOf(flag) + 1];
      await writeFile(valueAfter("--cover"), Buffer.from("png-1"));
      await writeFile(valueAfter("--output"), Buffer.from("silent-video"));
    });
    const probe = vi.fn(async () => probeResult);
    return { renderer: createAiContentReelRenderer({ runPython, probe }), runPython, probe };
  }

  it.each([1, 5])("renders %i ordered scenes as silent four-second slots without music arguments", async (count) => {
    const { renderer, runPython } = aiContentFixture(count);
    const scenes = Array.from({ length: count }, (_, offset) => scene(offset + 1));

    const result = await renderer.render({ jobId: "finalizer-1", scenes });

    expect(runPython).toHaveBeenCalledTimes(1);
    const args = runPython.mock.calls[0]![1];
    expect(args).toEqual(expect.arrayContaining([
      "--contract-version", "ai-content.v2",
      "--seconds-per-scene", "4",
      "--fade-seconds", "0.25",
      "--fps", "30"
    ]));
    expect(args).not.toContain("--audio");
    expect(args).not.toContain("--audio-volume");
    expect(args).not.toContain("--audio-fade-seconds");
    expect(result.cover.bytes).toEqual(scenes[0]!.bytes);
    expect(result.video).toMatchObject({
      width: 1080,
      height: 1920,
      videoCodec: "h264",
      audioCodec: null,
      fps: 30,
      durationSeconds: count * 4
    });
  });

  it.each([0, 6])("rejects %i scenes before starting Python", async (count) => {
    const { renderer, runPython } = aiContentFixture(Math.max(1, count));
    const scenes = Array.from({ length: count }, (_, offset) => scene(offset + 1));
    await expect(renderer.render({ jobId: "finalizer-1", scenes })).rejects.toThrow("invalid_ai_content_reel_scene_count");
    expect(runPython).not.toHaveBeenCalled();
  });

  it("rejects a discontinuous scene index", async () => {
    const { renderer, runPython } = aiContentFixture(2);
    await expect(renderer.render({ jobId: "finalizer-1", scenes: [scene(1), scene(3)] })).rejects.toThrow("invalid_ai_content_reel_scene");
    expect(runPython).not.toHaveBeenCalled();
  });

  it.each([
    ["extra video", { videoStreamCount: 2 }, "invalid_ai_content_reel_streams"],
    ["audio", { audioCodec: "aac", audioStreamCount: 1 }, "invalid_ai_content_reel_streams"],
    ["duration over one frame", { duration: 4 + 1 / 30 + 0.001 }, "invalid_ai_content_reel_duration"]
  ])("rejects %s probe output", async (_name, override, error) => {
    const { renderer } = aiContentFixture(1, {
      width: 1080, height: 1920, videoCodec: "h264", audioCodec: null,
      videoStreamCount: 1, audioStreamCount: 0, fps: 30, duration: 4,
      ...override
    });
    await expect(renderer.render({ jobId: "finalizer-1", scenes: [scene(1)] })).rejects.toThrow(error as string);
  });

  it.each([["python", "lease_lost"], ["ffprobe", "ai_content_worker_shutdown"]] as const)("forwards cancellation during %s and does not advance the pipeline", async (phase, reason) => {
    const controller = new AbortController();
    const waitForAbort = (_executable: string, _args: readonly string[], options?: { signal?: AbortSignal }) => new Promise<never>((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
    });
    const runPython = phase === "python"
      ? vi.fn(waitForAbort)
      : vi.fn(async (_executable: string, args: readonly string[]) => {
        const valueAfter = (flag: string) => args[args.indexOf(flag) + 1];
        await writeFile(valueAfter("--cover"), Buffer.from("png-1"));
        await writeFile(valueAfter("--output"), Buffer.from("silent-video"));
      });
    const probe = phase === "ffprobe" ? vi.fn(waitForAbort) : vi.fn();
    const renderer = createAiContentReelRenderer({ runPython, probe, processTimeoutMs: 50 });
    const running = renderer.render({ jobId: "finalizer-1", scenes: [scene(1)] }, controller.signal);

    await vi.waitFor(() => expect(phase === "python" ? runPython : probe).toHaveBeenCalled());
    controller.abort(new Error(reason));

    await expect(running).rejects.toThrow(reason);
    if (phase === "python") expect(probe).not.toHaveBeenCalled();
  });

  it("terminates the detached process group gracefully and settles after hard-kill completion", async () => {
    class FakeChild extends EventEmitter {
      pid = 321;
      stdout = new PassThrough();
      stderr = new PassThrough();
      kill = vi.fn(() => true);
    }
    const child = new FakeChild();
    const spawnProcess = vi.fn(() => child);
    const signalTree = vi.fn(async () => undefined);
    const controller = new AbortController();
    const running = runReelProcess("python", ["render-reel.py"], {
      signal: controller.signal, timeoutMs: 60_000, platform: "linux", terminationGraceMs: 5,
      spawnProcess: spawnProcess as never, signalTree: signalTree as never
    });
    const rejection = expect(running).rejects.toThrow("lease_lost");
    controller.abort(new Error("lease_lost"));
    await vi.waitFor(() => expect(signalTree).toHaveBeenNthCalledWith(1, child, "SIGTERM", { platform: "linux" }));
    expect(spawnProcess).toHaveBeenCalledWith("python", ["render-reel.py"], expect.objectContaining({ detached: true, shell: false }));
    await vi.waitFor(() => expect(signalTree).toHaveBeenNthCalledWith(2, child, "SIGKILL", { platform: "linux" }));
    await rejection;
  });

  it("applies a bounded process timeout", async () => {
    class FakeChild extends EventEmitter {
      pid = 322;
      stdout = new PassThrough();
      stderr = new PassThrough();
      kill = vi.fn(() => true);
    }
    const child = new FakeChild();
    const signalTree = vi.fn(async () => undefined);
    const running = runReelProcess("ffprobe", [], { timeoutMs: 5, platform: "linux", terminationGraceMs: 50, spawnProcess: vi.fn(() => child) as never, signalTree: signalTree as never });
    const rejection = expect(running).rejects.toThrow("ai_content_reel_process_timeout");
    await vi.waitFor(() => expect(signalTree).toHaveBeenCalledWith(child, "SIGTERM", { platform: "linux" }));
    child.emit("close", null);
    await rejection;
  });

  it("keeps Windows abort pending after child close until taskkill tree completion", async () => {
    class FakeChild extends EventEmitter {
      pid = 323;
      stdout = new PassThrough();
      stderr = new PassThrough();
      kill = vi.fn(() => true);
    }
    const child = new FakeChild();
    let completeTree!: () => void;
    const treeCompletion = new Promise<void>((resolve) => { completeTree = resolve; });
    const signalTree = vi.fn(() => treeCompletion);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const running = runReelProcess("python", [], { signal: controller.signal, timeoutMs: 60_000, platform: "win32", spawnProcess: vi.fn(() => child) as never, signalTree: signalTree as never });
    let settled = false;
    void running.catch(() => undefined).finally(() => { settled = true; });

    controller.abort(new Error("shutdown"));
    await vi.waitFor(() => expect(signalTree).toHaveBeenCalledWith(child, "SIGKILL", { platform: "win32" }));
    child.emit("close", null);
    child.emit("error", new Error("late"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    expect(child.kill).not.toHaveBeenCalled();

    completeTree();
    await expect(running).rejects.toThrow("shutdown");
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("keeps POSIX abort pending after child close through grace and hard-kill completion", async () => {
    class FakeChild extends EventEmitter {
      pid = 324;
      stdout = new PassThrough();
      stderr = new PassThrough();
      kill = vi.fn(() => true);
    }
    const child = new FakeChild();
    let completeKill!: () => void;
    const killCompletion = new Promise<void>((resolve) => { completeKill = resolve; });
    const signalTree = vi.fn((_child: unknown, signal: NodeJS.Signals) => signal === "SIGTERM" ? Promise.resolve() : killCompletion);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const running = runReelProcess("python", [], { signal: controller.signal, timeoutMs: 60_000, platform: "linux", terminationGraceMs: 5, spawnProcess: vi.fn(() => child) as never, signalTree: signalTree as never });
    let settled = false;
    void running.catch(() => undefined).finally(() => { settled = true; });

    controller.abort(new Error("lease_lost"));
    await vi.waitFor(() => expect(signalTree).toHaveBeenNthCalledWith(1, child, "SIGTERM", { platform: "linux" }));
    child.emit("close", null);
    await vi.waitFor(() => expect(signalTree).toHaveBeenNthCalledWith(2, child, "SIGKILL", { platform: "linux" }));
    expect(settled).toBe(false);

    completeKill();
    await expect(running).rejects.toThrow("lease_lost");
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
