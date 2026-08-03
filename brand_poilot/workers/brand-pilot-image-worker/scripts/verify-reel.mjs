import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

function requireCommand(command, versionArgs = ["-version"]) {
  const result = spawnSync(command, versionArgs, { shell: false, encoding: "utf8", windowsHide: true });
  if (result.error?.code === "ENOENT") throw new Error(`Missing prerequisite: ${command} is not available on PATH.`);
  if (result.error || result.status !== 0) throw new Error(`Prerequisite check failed for ${command}: ${result.error?.message ?? result.stderr.trim()}`);
}

function run(command, args) {
  const result = spawnSync(command, args, { shell: false, encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? "unknown"}): ${result.stderr.trim()}`);
  return result.stdout;
}

const python = process.env.PYTHON ?? "python";
const scriptPath = fileURLToPath(new URL("./render-reel.py", import.meta.url));

async function verifyScenario(root, sceneCount) {
  const workDir = path.join(root, `${sceneCount}-scenes`);
  const inputDir = path.join(workDir, "scenes");
  const manifestPath = path.join(workDir, "content.json");
  const outputPath = path.join(workDir, "reel.mp4");
  const coverPath = path.join(workDir, "cover.png");
  await mkdir(inputDir, { recursive: true });
  const colors = ["red", "blue", "green", "yellow", "magenta"].slice(0, sceneCount);
  for (let index = 0; index < colors.length; index += 1) {
    run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=${colors[index]}:s=1080x1920`, "-frames:v", "1", path.join(inputDir, `scene-${String(index + 1).padStart(2, "0")}.png`)]);
  }
  await writeFile(manifestPath, JSON.stringify({ contractVersion: "ai-content.v2", scenes: colors.map((color, index) => ({ index: index + 1, role: color })) }, null, 2));
  run(python, [scriptPath, "--contract-version", "ai-content.v2", "--input-dir", inputDir, "--manifest", manifestPath, "--output", outputPath, "--cover", coverPath, "--seconds-per-scene", "4", "--fade-seconds", "0.25", "--fps", "30", "--width", "1080", "--height", "1920"]);

  assert.deepEqual(await readFile(coverPath), await readFile(path.join(inputDir, "scene-01.png")), "First scene must be reused as cover");
  const probe = JSON.parse(run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", outputPath]));
  const videos = probe.streams.filter((stream) => stream.codec_type === "video");
  const audios = probe.streams.filter((stream) => stream.codec_type === "audio");
  assert.equal(videos.length, 1);
  assert.equal(audios.length, 0);
  const video = videos[0];
  const [fpsNumerator, fpsDenominator] = video.avg_frame_rate.split("/").map(Number);
  const duration = Number(probe.format.duration);
  assert.equal(video.width, 1080);
  assert.equal(video.height, 1920);
  assert.equal(video.codec_name, "h264");
  assert.equal(fpsNumerator / fpsDenominator, 30);
  assert.ok(Math.abs(duration - sceneCount * 4) <= 1 / 30, `${sceneCount}-scene duration ${duration} exceeded one frame tolerance`);
  return duration;
}

async function main() {
  requireCommand(python, ["--version"]);
  requireCommand("ffmpeg");
  requireCommand("ffprobe");
  const workDir = await mkdtemp(path.join(os.tmpdir(), "brand-pilot-verify-reel-"));
  try {
    const one = await verifyScenario(workDir, 1);
    const five = await verifyScenario(workDir, 5);
    process.stdout.write(`V3 reel verification passed:\n- 1 scene: ${one.toFixed(3)}s, h264, 1080x1920, 30fps, no audio\n- 5 scenes: ${five.toFixed(3)}s, h264, 1080x1920, 30fps, no audio\n`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
