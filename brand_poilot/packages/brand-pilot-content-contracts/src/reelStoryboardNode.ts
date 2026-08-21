import { createHash } from "node:crypto";
import { parseReelStoryboardV1, type ReelStoryboardV1, type ReelStoryboardV2 } from "./reelStoryboard.js";

function canonicalJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.entries(item as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, normalize(child)]));
  };
  return JSON.stringify(normalize(value));
}

export function reelStoryboardSha256(storyboard: ReelStoryboardV1): string {
  return createHash("sha256").update(canonicalJson(parseReelStoryboardV1(storyboard)), "utf8").digest("hex");
}

export function reelStoryboardV2Sha256(storyboard: ReelStoryboardV2): string {
  return createHash("sha256").update(canonicalJson(storyboard), "utf8").digest("hex");
}
