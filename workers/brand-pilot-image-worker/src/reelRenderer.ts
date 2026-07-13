import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ReelRenderer, RenderedReelMedia } from "./worker.js";

const secondsPerScene = 3;
const fadeSeconds = 0.25;
const reelFps = 30;
const durationTolerance = 0.20;

export interface ReelProbe {
  width: number;
  height: number;
  videoCodec: string | null;
  audioCodec: string | null;
  fps: number;
  duration: number;
}

type RunPython = (executable: string, args: readonly string[]) => Promise<void>;
type Probe = (executable: string, args: readonly string[]) => Promise<ReelProbe>;

interface ProcessOutput {
  stdout: string;
  stderr: string;
}

function runProcess(executable: string, args: readonly string[]): Promise<ProcessOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${executable}_failed:${code ?? "unknown"}:${stderr.trim()}`));
    });
  });
}

const defaultRunPython: RunPython = async (executable, args) => {
  await runProcess(executable, args);
};

function frameRate(value: unknown) {
  if (typeof value !== "string") return Number.NaN;
  const [numerator, denominator = "1"] = value.split("/");
  return Number(numerator) / Number(denominator);
}

const defaultProbe: Probe = async (executable, args) => {
  let raw: unknown;
  try {
    raw = JSON.parse((await runProcess(executable, args)).stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ffprobe_failed:${message}`);
  }
  const record = raw as {
    streams?: Array<Record<string, unknown>>;
    format?: Record<string, unknown>;
  };
  const video = record.streams?.find((stream) => stream.codec_type === "video");
  const audio = record.streams?.find((stream) => stream.codec_type === "audio");
  if (!video || !audio) throw new Error("ffprobe_failed:missing_stream");
  return {
    width: Number(video.width),
    height: Number(video.height),
    videoCodec: typeof video.codec_name === "string" ? video.codec_name : null,
    audioCodec: typeof audio.codec_name === "string" ? audio.codec_name : null,
    fps: frameRate(video.avg_frame_rate ?? video.r_frame_rate),
    duration: Number(record.format?.duration ?? video.duration)
  };
};

function validateScenes(input: Parameters<ReelRenderer["render"]>[0]) {
  if (input.scenes.length < 1 || input.scenes.length > 5) {
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
  probe = defaultProbe
}: {
  pythonExecutable?: string;
  ffprobeExecutable?: string;
  scriptPath?: string;
  runPython?: RunPython;
  probe?: Probe;
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
        await runPython(pythonExecutable, [
          scriptPath,
          "--input-dir", inputDir,
          "--manifest", manifestPath,
          "--output", outputPath,
          "--cover", coverPath,
          "--seconds-per-scene", String(secondsPerScene),
          "--fade-seconds", String(fadeSeconds),
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
