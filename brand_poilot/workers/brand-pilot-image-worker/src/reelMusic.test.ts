import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REEL_MUSIC_TRACKS,
  fetchReelMusic,
  selectReelMusicTrack
} from "./reelMusic.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

async function workDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "reel-music-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function validMp3() {
  const bytes = Buffer.alloc(2_048, 0x11);
  bytes.write("ID3", 0, "ascii");
  return bytes;
}

describe("Reel music", () => {
  it("uses the fixed Mixkit Free Stock Music library", () => {
    expect(REEL_MUSIC_TRACKS).toEqual([
      {
        id: "mixkit-relaxation-05",
        title: "Relaxation 05",
        url: "https://assets.mixkit.co/music/749/749.mp3"
      },
      {
        id: "mixkit-romantic-05",
        title: "Romantic 05",
        url: "https://assets.mixkit.co/music/759/759.mp3"
      },
      {
        id: "mixkit-curiosity",
        title: "Curiosity",
        url: "https://assets.mixkit.co/music/480/480.mp3"
      }
    ]);
  });

  it("selects one of all three tracks deterministically from the job id", () => {
    const firstPass = Array.from({ length: 100 }, (_, index) => (
      selectReelMusicTrack(`job-${index}`).id
    ));
    const secondPass = Array.from({ length: 100 }, (_, index) => (
      selectReelMusicTrack(`job-${index}`).id
    ));

    expect(secondPass).toEqual(firstPass);
    expect(new Set(firstPass)).toEqual(new Set(REEL_MUSIC_TRACKS.map(({ id }) => id)));
  });

  it("downloads the selected MP3 into the job work directory", async () => {
    const directory = await workDirectory();
    const bytes = validMp3();
    const fetchImpl = vi.fn(async () => new Response(bytes, {
      status: 200,
      headers: { "content-type": "audio/mpeg" }
    }));

    const result = await fetchReelMusic("job-download", directory, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(selectReelMusicTrack("job-download").url);
    expect(path.dirname(result.filePath)).toBe(directory);
    expect(path.extname(result.filePath)).toBe(".mp3");
    await expect(readFile(result.filePath)).resolves.toEqual(bytes);
  });

  it.each([
    ["HTTP error", new Response("missing", { status: 404 }), "reel_music_download_failed"],
    ["wrong content type", new Response(validMp3(), { status: 200, headers: { "content-type": "text/html" } }), "invalid_reel_music_content_type"],
    ["invalid MP3 bytes", new Response(Buffer.alloc(2_048), { status: 200, headers: { "content-type": "audio/mpeg" } }), "invalid_reel_music_file"]
  ])("fails on %s instead of returning silent audio", async (_name, response, error) => {
    const directory = await workDirectory();

    await expect(fetchReelMusic("job-invalid", directory, async () => response)).rejects.toThrow(error);
  });
});
