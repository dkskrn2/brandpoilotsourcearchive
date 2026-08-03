import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchReelMusic, type PreparedReelMusic } from "./reelMusic.js";
import { signalProcessTree } from "./processTermination.mjs";
import type { ReelRenderer, RenderedReelMedia } from "./worker.js";

const secondsPerScene = 7;
const fadeSeconds = 0.25;
const audioVolume = 0.12;
const audioFadeSeconds = 0.5;
const reelFps = 30;
const durationTolerance = 0.20;

export interface ReelProbe {
  width: number;
  height: number;
  videoCodec: string | null;
  audioCodec: string | null;
  fps: number;
  duration: number;
  videoStreamCount?: number;
  audioStreamCount?: number;
}

export interface AiContentReelRenderInput {
  jobId: string;
  scenes: Array<{
    index: number;
    bytes: Buffer;
    mimeType: "image/png";
    width: number;
    height: number;
  }>;
}

export interface AiContentRenderedReelMedia {
  cover: { bytes: Buffer; mimeType: "image/png"; width: number; height: number };
  video: {
    bytes: Buffer;
    mimeType: "video/mp4";
    width: number;
    height: number;
    videoCodec: "h264";
    audioCodec: null;
    fps: 30;
    durationSeconds: number;
  };
}

export interface AiContentReelRenderer {
  render(input: AiContentReelRenderInput, signal?: AbortSignal): Promise<AiContentRenderedReelMedia>;
}

interface ReelProcessOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  platform?: NodeJS.Platform;
  terminationGraceMs?: number;
  spawnProcess?: typeof spawn;
  signalTree?: typeof signalProcessTree;
}

type RunPython = (executable: string, args: readonly string[], options?: ReelProcessOptions) => Promise<void>;
type Probe = (executable: string, args: readonly string[], options?: ReelProcessOptions) => Promise<ReelProbe>;
type PrepareMusic = (jobId: string, workDir: string) => Promise<PreparedReelMusic>;

interface ProcessOutput {
  stdout: string;
  stderr: string;
}

export function runReelProcess(executable: string, args: readonly string[], options: ReelProcessOptions = {}): Promise<ProcessOutput> {
  if (options.signal?.aborted) return Promise.reject(options.signal.reason instanceof Error ? options.signal.reason : new Error("ai_content_reel_aborted"));
  return new Promise((resolve, reject) => {
    const platform = options.platform ?? process.platform;
    const managed = options.signal !== undefined || options.timeoutMs !== undefined;
    const child = (options.spawnProcess ?? spawn)(executable, [...args], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: managed && platform !== "win32"
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let stopError: Error | null = null;
    let gracefulTimer: ReturnType<typeof setTimeout> | undefined;
    const commandTimer = options.timeoutMs === undefined ? undefined : setTimeout(() => requestStop(new Error("ai_content_reel_process_timeout")), options.timeoutMs);
    const cleanup = () => {
      if (commandTimer) clearTimeout(commandTimer);
      if (gracefulTimer) clearTimeout(gracefulTimer);
      options.signal?.removeEventListener("abort", abort);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      error ? reject(error) : resolve({ stdout, stderr });
    };
    const signalTree = options.signalTree ?? signalProcessTree;
    const waitForGrace = () => new Promise<void>((resolve) => {
      gracefulTimer = setTimeout(resolve, options.terminationGraceMs ?? 1_000);
    });
    const completeStopSequence = async () => {
      if (platform === "win32") {
        await signalTree(child, "SIGKILL", { platform }).catch(() => undefined);
      } else {
        await signalTree(child, "SIGTERM", { platform }).catch(() => undefined);
        await waitForGrace();
        await signalTree(child, "SIGKILL", { platform }).catch(() => undefined);
      }
      finish(stopError ?? new Error("ai_content_reel_aborted"));
    };
    function requestStop(error: Error) {
      if (settled || stopError) return;
      stopError = error;
      if (commandTimer) clearTimeout(commandTimer);
      void completeStopSequence();
    }
    const abort = () => requestStop(options.signal?.reason instanceof Error ? options.signal.reason : new Error("ai_content_reel_aborted"));
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    options.signal?.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => {
      if (!stopError) finish(error);
    });
    child.once("close", (code) => {
      if (stopError) return;
      if (code === 0) finish();
      else finish(new Error(`${executable}_failed:${code ?? "unknown"}:${stderr.trim()}`));
    });
    if (options.signal?.aborted) abort();
  });
}

const defaultRunPython: RunPython = async (executable, args, options) => {
  await runReelProcess(executable, args, options);
};

function frameRate(value: unknown) {
  if (typeof value !== "string") return Number.NaN;
  const [numerator, denominator = "1"] = value.split("/");
  return Number(numerator) / Number(denominator);
}

const defaultProbe: Probe = async (executable, args, options) => {
  let raw: unknown;
  try {
    raw = JSON.parse((await runReelProcess(executable, args, options)).stdout);
  } catch (error) {
    if (options?.signal?.aborted) throw options.signal.reason instanceof Error ? options.signal.reason : new Error("ai_content_reel_aborted");
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ffprobe_failed:${message}`);
  }
  const record = raw as {
    streams?: Array<Record<string, unknown>>;
    format?: Record<string, unknown>;
  };
  const videos = record.streams?.filter((stream) => stream.codec_type === "video") ?? [];
  const audios = record.streams?.filter((stream) => stream.codec_type === "audio") ?? [];
  const video = videos[0];
  const audio = audios[0];
  if (!video) throw new Error("ffprobe_failed:missing_video_stream");
  return {
    width: Number(video.width),
    height: Number(video.height),
    videoCodec: typeof video.codec_name === "string" ? video.codec_name : null,
    audioCodec: typeof audio?.codec_name === "string" ? audio.codec_name : null,
    fps: frameRate(video.avg_frame_rate ?? video.r_frame_rate),
    duration: Number(record.format?.duration ?? video.duration),
    videoStreamCount: videos.length,
    audioStreamCount: audios.length
  };
};

function validateScenes(input: Parameters<ReelRenderer["render"]>[0]) {
  if (input.scenes.length !== 1) {
    throw new Error("invalid_reel_scene_count");
  }
  if (
    input.manifest.selectedAssetCount !== input.scenes.length
    || input.manifest.scenes.length !== input.scenes.length
  ) {
    throw new Error("invalid_reel_scene_count");
  }
  input.scenes.forEach((scene, offset) => {
    if (
      scene.index !== offset + 1
      || scene.mimeType !== "image/png"
      || scene.bytes.length === 0
      || !Number.isInteger(scene.width)
      || scene.width <= 0
      || !Number.isInteger(scene.height)
      || scene.height <= 0
    ) {
      throw new Error("invalid_reel_scene");
    }
  });
}

function validateAiContentScenes(input: AiContentReelRenderInput) {
  if (input.scenes.length < 1 || input.scenes.length > 5) throw new Error("invalid_ai_content_reel_scene_count");
  input.scenes.forEach((scene, offset) => {
    if (
      scene.index !== offset + 1 || scene.mimeType !== "image/png" || scene.bytes.length === 0
      || !Number.isSafeInteger(scene.width) || !Number.isSafeInteger(scene.height)
      || scene.width < 1 || scene.height < 1 || scene.width * 16 !== scene.height * 9
    ) throw new Error("invalid_ai_content_reel_scene");
  });
}

function validateAiContentProbe(probe: ReelProbe, sceneCount: number, width: number, height: number) {
  if (probe.videoStreamCount !== 1 || probe.audioStreamCount !== 0) throw new Error("invalid_ai_content_reel_streams");
  if (probe.videoCodec !== "h264" || probe.audioCodec !== null) throw new Error("invalid_ai_content_reel_codec");
  if (probe.width !== width || probe.height !== height || probe.width * 16 !== probe.height * 9) throw new Error("invalid_ai_content_reel_dimensions");
  if (!Number.isFinite(probe.fps) || Math.abs(probe.fps - reelFps) > 0.001) throw new Error("invalid_ai_content_reel_fps");
  const expectedDuration = sceneCount * 4;
  if (!Number.isFinite(probe.duration) || Math.abs(probe.duration - expectedDuration) > 1 / reelFps) {
    throw new Error("invalid_ai_content_reel_duration");
  }
}

export function createAiContentReelRenderer({
  pythonExecutable = process.env.PYTHON ?? "python",
  ffprobeExecutable = "ffprobe",
  scriptPath = fileURLToPath(new URL("../scripts/render-reel.py", import.meta.url)),
  runPython = defaultRunPython,
  probe = defaultProbe,
  processTimeoutMs = 5 * 60_000
}: {
  pythonExecutable?: string;
  ffprobeExecutable?: string;
  scriptPath?: string;
  runPython?: RunPython;
  probe?: Probe;
  processTimeoutMs?: number;
} = {}): AiContentReelRenderer {
  return {
    async render(input, signal = new AbortController().signal) {
      if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("ai_content_reel_aborted");
      validateAiContentScenes(input);
      const workDir = await mkdtemp(path.join(os.tmpdir(), "brand-pilot-ai-content-reel-"));
      const inputDir = path.join(workDir, "scenes");
      const manifestPath = path.join(workDir, "content.json");
      const outputPath = path.join(workDir, "reel.mp4");
      const coverPath = path.join(workDir, "cover.png");
      const width = input.scenes[0]!.width;
      const height = input.scenes[0]!.height;
      try {
        await mkdir(inputDir);
        await Promise.all(input.scenes.map((scene) => writeFile(path.join(inputDir, `scene-${String(scene.index).padStart(2, "0")}.png`), scene.bytes)));
        await writeFile(manifestPath, JSON.stringify({ contractVersion: "ai-content.v2", scenes: input.scenes.map(({ index }) => ({ index })) }), "utf8");
        try {
          await runPython(pythonExecutable, [
            scriptPath,
            "--contract-version", "ai-content.v2",
            "--input-dir", inputDir,
            "--manifest", manifestPath,
            "--output", outputPath,
            "--cover", coverPath,
            "--seconds-per-scene", "4",
            "--fade-seconds", String(fadeSeconds),
            "--fps", String(reelFps),
            "--width", String(width),
            "--height", String(height)
          ], { signal, timeoutMs: processTimeoutMs });
        } catch (error) {
          if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("ai_content_reel_aborted");
          throw new Error(`ai_content_reel_render_failed:${error instanceof Error ? error.message : String(error)}`);
        }
        const [coverBytes, videoBytes] = await Promise.all([readFile(coverPath), readFile(outputPath)]);
        if (!coverBytes.equals(input.scenes[0]!.bytes)) throw new Error("invalid_ai_content_reel_cover");
        if (videoBytes.length === 0) throw new Error("invalid_ai_content_reel_output_empty");
        const probeResult = await probe(ffprobeExecutable, ["-v", "error", "-show_streams", "-show_format", "-of", "json", outputPath], { signal, timeoutMs: processTimeoutMs });
        if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("ai_content_reel_aborted");
        validateAiContentProbe(probeResult, input.scenes.length, width, height);
        return {
          cover: { bytes: coverBytes, mimeType: "image/png", width, height },
          video: { bytes: videoBytes, mimeType: "video/mp4", width, height, videoCodec: "h264", audioCodec: null, fps: 30, durationSeconds: probeResult.duration }
        };
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    }
  };
}

function validateProbe(probe: ReelProbe, sceneCount: number) {
  if (probe.videoCodec !== "h264" || probe.audioCodec !== "aac") {
    throw new Error("invalid_reel_codec");
  }
  if (probe.width !== 1080 || probe.height !== 1920) {
    throw new Error("invalid_reel_dimensions");
  }
  if (!Number.isFinite(probe.fps) || Math.abs(probe.fps - reelFps) > 0.001) {
    throw new Error("invalid_reel_fps");
  }
  const expectedDuration = secondsPerScene * sceneCount - fadeSeconds * (sceneCount - 1);
  if (!Number.isFinite(probe.duration) || Math.abs(probe.duration - expectedDuration) > durationTolerance) {
    throw new Error("invalid_reel_duration");
  }
}

export function createReelRenderer({
  pythonExecutable = process.env.PYTHON ?? "python",
  ffprobeExecutable = "ffprobe",
  scriptPath = fileURLToPath(new URL("../scripts/render-reel.py", import.meta.url)),
  runPython = defaultRunPython,
  probe = defaultProbe,
  prepareMusic = fetchReelMusic
}: {
  pythonExecutable?: string;
  ffprobeExecutable?: string;
  scriptPath?: string;
  runPython?: RunPython;
  probe?: Probe;
  prepareMusic?: PrepareMusic;
} = {}): ReelRenderer {
  return {
    async render(input): Promise<RenderedReelMedia> {
      validateScenes(input);
      const workDir = await mkdtemp(path.join(os.tmpdir(), "brand-pilot-reel-"));
      const inputDir = path.join(workDir, "scenes");
      const manifestPath = path.join(workDir, "content.json");
      const outputPath = path.join(workDir, "reel.mp4");
      const coverPath = path.join(workDir, "cover.png");
      try {
        await mkdir(inputDir);
        await Promise.all(input.scenes.map((scene) => writeFile(
          path.join(inputDir, `scene-${String(scene.index).padStart(2, "0")}.png`),
          scene.bytes
        )));
        await writeFile(manifestPath, JSON.stringify(input.manifest, null, 2), "utf8");
        const music = await prepareMusic(input.job.id, workDir);
        await runPython(pythonExecutable, [
          scriptPath,
          "--input-dir", inputDir,
          "--manifest", manifestPath,
          "--output", outputPath,
          "--cover", coverPath,
          "--audio", music.filePath,
          "--seconds-per-scene", String(secondsPerScene),
          "--fade-seconds", String(fadeSeconds),
          "--audio-volume", String(audioVolume),
          "--audio-fade-seconds", String(audioFadeSeconds),
          "--fps", String(reelFps)
        ]);

        const [coverBytes, videoBytes] = await Promise.all([
          readFile(coverPath),
          readFile(outputPath)
        ]);
        if (coverBytes.length === 0) throw new Error("invalid_reel_cover_empty");
        if (videoBytes.length === 0) throw new Error("invalid_reel_output_empty");

        const probeResult = await probe(ffprobeExecutable, [
          "-v", "error", "-show_streams", "-show_format", "-of", "json", outputPath
        ]);
        validateProbe(probeResult, input.scenes.length);
        return {
          cover: { bytes: coverBytes, mimeType: "image/png", width: 1080, height: 1920 },
          video: {
            bytes: videoBytes,
            mimeType: "video/mp4",
            width: 1080,
            height: 1920,
            videoCodec: "h264",
            audioCodec: "aac",
            fps: reelFps
          }
        };
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    }
  };
}
