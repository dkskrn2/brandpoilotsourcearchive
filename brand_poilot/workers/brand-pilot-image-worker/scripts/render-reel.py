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
    parser.add_argument("--contract-version", choices=("worker-reel.v3", "ai-content.v2"), default="worker-reel.v3")
    parser.add_argument("--audio", type=Path)
    parser.add_argument("--seconds-per-scene", type=positive_number, required=True)
    parser.add_argument("--fade-seconds", type=positive_number, required=True)
    parser.add_argument("--audio-volume", type=positive_number)
    parser.add_argument("--audio-fade-seconds", type=positive_number)
    parser.add_argument("--fps", type=positive_integer, required=True)
    parser.add_argument("--width", type=positive_integer)
    parser.add_argument("--height", type=positive_integer)
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
    is_v3 = args.contract_version == "ai-content.v2"
    if not isinstance(scenes, list) or (not is_v3 and len(scenes) != 1) or (is_v3 and not 1 <= len(scenes) <= 5):
        expected = "1 to 5 scenes" if is_v3 else "exactly 1 scene"
        fail(f"Invalid Reel manifest: expected {expected}.")
    if is_v3:
        if args.seconds_per_scene != 4 or args.fade_seconds != 0.25 or args.fps != 30:
            fail("Invalid ai-content.v2 Reel timing settings.")
        if args.width is None or args.height is None or args.width * 16 != args.height * 9:
            fail("Invalid ai-content.v2 Reel aspect ratio.")
    elif args.audio is None or args.audio_volume is None or args.audio_fade_seconds is None or not args.audio.is_file() or args.audio.stat().st_size == 0:
        fail(f"Missing Reel audio: {args.audio}")

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

    duration = args.seconds_per_scene * len(scene_paths) if is_v3 else args.seconds_per_scene * len(scene_paths) - args.fade_seconds * (len(scene_paths) - 1)
    command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y"]
    for index, scene_path in enumerate(scene_paths):
        input_duration = args.seconds_per_scene
        if is_v3 and index < len(scene_paths) - 1:
            input_duration += args.fade_seconds
        command.extend(["-loop", "1", "-t", str(input_duration), "-i", str(scene_path)])
    if not is_v3:
        command.extend(["-stream_loop", "-1", "-i", str(args.audio)])

    target_width = args.width if is_v3 else 1080
    target_height = args.height if is_v3 else 1920
    filters = []
    for index in range(len(scene_paths)):
        filters.append(
            f"[{index}:v]scale={target_width}:{target_height}:force_original_aspect_ratio=decrease,"
            f"pad={target_width}:{target_height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={args.fps},"
            f"format=yuv420p,setpts=PTS-STARTPTS[v{index}]"
        )
    video_label = "v0"
    for index in range(1, len(scene_paths)):
        output_label = f"x{index}"
        offset = index * args.seconds_per_scene if is_v3 else index * (args.seconds_per_scene - args.fade_seconds)
        filters.append(
            f"[{video_label}][v{index}]xfade=transition=fade:"
            f"duration={args.fade_seconds}:offset={offset}[{output_label}]"
        )
        video_label = output_label

    if is_v3:
        filters.append(f"[{video_label}]trim=duration={duration},setpts=PTS-STARTPTS[vout]")
        video_label = "vout"
    else:
        audio_index = len(scene_paths)
        audio_fade_out_start = max(0, duration - args.audio_fade_seconds)
        filters.append(
            f"[{audio_index}:a]volume={args.audio_volume},atrim=duration={duration},"
            f"asetpts=PTS-STARTPTS,afade=t=in:st=0:d={args.audio_fade_seconds},"
            f"afade=t=out:st={audio_fade_out_start}:d={args.audio_fade_seconds}[aout]"
        )

    command.extend([
        "-filter_complex", ";".join(filters),
        "-map", f"[{video_label}]",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-r", str(args.fps),
    ])
    if is_v3:
        command.extend(["-an"])
    else:
        command.extend(["-map", "[aout]", "-c:a", "aac", "-ar", "48000", "-ac", "2"])
    command.extend(["-movflags", "+faststart", "-t", str(duration), str(args.output)])
    try:
        subprocess.run(command, check=True)
    except subprocess.CalledProcessError as error:
        fail(f"FFmpeg Reel render failed with exit code {error.returncode}.")


if __name__ == "__main__":
    main()
