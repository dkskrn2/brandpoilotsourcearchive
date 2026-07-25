import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

function requireCommand(command, versionArgs = ["-version"]) {
  const result = spawnSync(command, versionArgs, { shell: false, encoding: "utf8", windowsHide: true });
  if (result.error?.code === "ENOENT") {
    throw new Error(`Missing prerequisite: ${command} is not available on PATH.`);
  }
  if (result.error || result.status !== 0) {
    throw new Error(`Prerequisite check failed for ${command}: ${result.error?.message ?? result.stderr.trim()}`);
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { shell: false, encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status ?? "unknown"}): ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function runWithOutput(command, args) {
  const result = spawnSync(command, args, { shell: false, encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status ?? "unknown"}): ${result.stderr.trim()}`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

const python = process.env.PYTHON ?? "python";
const scriptPath = fileURLToPath(new URL("./render-reel.py", import.meta.url));

async function main() {
  requireCommand(python, ["--version"]);
  requireCommand("ffmpeg");
  requireCommand("ffprobe");

  const workDir = await mkdtemp(path.join(os.tmpdir(), "brand-pilot-verify-reel-"));
  const inputDir = path.join(workDir, "scenes");
  const manifestPath = path.join(workDir, "content.json");
  const outputPath = path.join(workDir, "reel.mp4");
  const coverPath = path.join(workDir, "cover.png");
  const audioPath = path.join(workDir, "mixkit-relaxation-05.mp3");
  try {
    await mkdir(inputDir);
    const colors = ["red"];
    for (let index = 0; index < colors.length; index += 1) {
      run("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", `color=c=${colors[index]}:s=1080x1920`,
        "-frames:v", "1",
        path.join(inputDir, `scene-${String(index + 1).padStart(2, "0")}.png`)
      ]);
    }
    await writeFile(manifestPath, JSON.stringify({
      deliveryFormat: "instagram_reel",
      selectedAssetCount: 1,
      scenes: colors.map((color, index) => ({ index: index + 1, role: color }))
    }, null, 2));

    const audioResponse = await fetch("https://assets.mixkit.co/music/749/749.mp3");
    assert.equal(audioResponse.ok, true, `Mixkit download failed with ${audioResponse.status}`);
    assert.match(audioResponse.headers.get("content-type") ?? "", /^audio\/(mpeg|mp3)(?:;|$)/i);
    const audioBytes = Buffer.from(await audioResponse.arrayBuffer());
    assert.ok(audioBytes.length >= 1_024, "Downloaded Mixkit track is unexpectedly small");
    await writeFile(audioPath, audioBytes);

    run(python, [
      scriptPath,
      "--input-dir", inputDir,
      "--manifest", manifestPath,
      "--output", outputPath,
      "--cover", coverPath,
      "--audio", audioPath,
      "--seconds-per-scene", "7",
      "--fade-seconds", "0.25",
      "--audio-volume", "0.12",
      "--audio-fade-seconds", "0.5",
      "--fps", "30"
    ]);

    const probe = JSON.parse(run("ffprobe", [
      "-v", "error", "-show_streams", "-show_format", "-of", "json", outputPath
    ]));
    const video = probe.streams.find((stream) => stream.codec_type === "video");
    const audio = probe.streams.find((stream) => stream.codec_type === "audio");
    const [fpsNumerator, fpsDenominator] = video.avg_frame_rate.split("/").map(Number);
    assert.equal(video.width, 1080);
    assert.equal(video.height, 1920);
    assert.equal(video.codec_name, "h264");
    assert.equal(audio.codec_name, "aac");
    assert.equal(fpsNumerator / fpsDenominator, 30);
    assert.ok(Math.abs(Number(probe.format.duration) - 7) <= 0.20);

    const volumeProbe = runWithOutput("ffmpeg", [
      "-hide_banner", "-i", outputPath,
      "-map", "0:a:0", "-af", "volumedetect",
      "-f", "null", "-"
    ]);
    const maxVolume = /max_volume:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dB/i.exec(volumeProbe.stderr)?.[1];
    assert.ok(maxVolume && maxVolume.toLowerCase() !== "-inf", "Reel audio is silent");
    process.stdout.write("Reel verification passed: 1080x1920 h264/aac 30fps, 1 scene, real BGM.\n");
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
