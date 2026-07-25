import { writeFile } from "node:fs/promises";
import path from "node:path";

export interface ReelMusicTrack {
  id: string;
  title: string;
  url: string;
}

export interface PreparedReelMusic {
  track: ReelMusicTrack;
  filePath: string;
}

export const REEL_MUSIC_TRACKS: readonly ReelMusicTrack[] = [
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
] as const;

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function hashJobId(jobId: string) {
  let hash = 0x811c9dc5;
  for (const character of jobId) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function isMp3(bytes: Buffer) {
  const hasId3Header = bytes.length >= 3 && bytes.subarray(0, 3).toString("ascii") === "ID3";
  const hasMpegFrame = bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  return bytes.length >= 1_024 && (hasId3Header || hasMpegFrame);
}

export function selectReelMusicTrack(jobId: string) {
  return REEL_MUSIC_TRACKS[hashJobId(jobId) % REEL_MUSIC_TRACKS.length];
}

export async function fetchReelMusic(
  jobId: string,
  workDir: string,
  fetchImpl: Fetch = fetch
): Promise<PreparedReelMusic> {
  const track = selectReelMusicTrack(jobId);
  let response: Response;
  try {
    response = await fetchImpl(track.url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`reel_music_download_failed:${message}`);
  }
  if (!response.ok) {
    throw new Error(`reel_music_download_failed:${response.status}`);
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "audio/mpeg" && contentType !== "audio/mp3") {
    throw new Error("invalid_reel_music_content_type");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!isMp3(bytes)) {
    throw new Error("invalid_reel_music_file");
  }
  const filePath = path.join(workDir, `${track.id}.mp3`);
  await writeFile(filePath, bytes);
  return { track, filePath };
}
