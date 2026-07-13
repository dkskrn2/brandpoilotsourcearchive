#!/usr/bin/env python3
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path


def positive_number(value: str) -> float:
    number = float(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return number


def positive_integer(value: str) -> int:
    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return number


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render Brand Pilot Reel scenes")
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cover", type=Path, required=True)
    parser.add_argument("--seconds-per-scene", type=positive_number, required=True)
    parser.add_argument("--fade-seconds", type=positive_number, required=True)
    parser.add_argument("--fps", type=positive_integer, required=True)
    return parser.parse_args()


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(2)


def main() -> None:
    args = parse_args()
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        fail("Missing prerequisite: ffmpeg is not available on PATH.")

    try:
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
        scenes = manifest["scenes"]
    except (OSError, json.JSONDecodeError, KeyError, TypeError) as error:
        fail(f"Invalid Reel manifest: {error}")
    if not isinstance(scenes, list) or not 1 <= len(scenes) <= 5:
        fail("Invalid Reel manifest: expected 1-5 scenes.")

    scene_paths = []
    for offset, scene in enumerate(scenes, start=1):
        if not isinstance(scene, dict) or scene.get("index") != offset:
            fail("Invalid Reel manifest: scene indexes must be ordered from 1.")
        scene_path = args.input_dir / f"scene-{offset:02d}.png"
        if not scene_path.is_file() or scene_path.stat().st_size == 0:
            fail(f"Missing Reel scene: {scene_path}")
        scene_paths.append(scene_path)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.cover.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(scene_paths[0], args.cover)

    duration = args.seconds_per_scene * len(scene_paths) - args.fade_seconds * (len(scene_paths) - 1)
    command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y"]
    for scene_path in scene_paths:
        command.extend(["-loop", "1", "-t", str(args.seconds_per_scene), "-i", str(scene_path)])
    command.extend([
        "-f", "lavfi", "-t", str(duration), "-i",
        "anullsrc=channel_layout=stereo:sample_rate=48000"
    ])

    filters = []
    for index in range(len(scene_paths)):
        filters.append(
            f"[{index}:v]scale=1080:1920:force_original_aspect_ratio=decrease,"
            f"pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={args.fps},"
            f"format=yuv420p,setpts=PTS-STARTPTS[v{index}]"
        )
    video_label = "v0"
    for index in range(1, len(scene_paths)):
        output_label = f"x{index}"
        offset = index * (args.seconds_per_scene - args.fade_seconds)
        filters.append(
            f"[{video_label}][v{index}]xfade=transition=fade:"
            f"duration={args.fade_seconds}:offset={offset}[{output_label}]"
        )
        video_label = output_label

    command.extend([
        "-filter_complex", ";".join(filters),
        "-map", f"[{video_label}]",
        "-map", f"{len(scene_paths)}:a:0",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-r", str(args.fps),
        "-c:a", "aac",
        "-ar", "48000",
        "-ac", "2",
        "-movflags", "+faststart",
        "-t", str(duration),
        str(args.output)
    ])
    try:
        subprocess.run(command, check=True)
    except subprocess.CalledProcessError as error:
        fail(f"FFmpeg Reel render failed with exit code {error.returncode}.")


if __name__ == "__main__":
    main()
