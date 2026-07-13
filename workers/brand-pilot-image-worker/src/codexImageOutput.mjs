import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/** @param {{ codexHome?: string, homeDir: string }} input */
export function resolveCodexGeneratedImagesDirectory({ codexHome, homeDir }) {
  return path.join(codexHome || path.join(homeDir, ".codex"), "generated_images");
}

export function parseCodexThreadId(line) {
  try {
    const event = JSON.parse(line);
    return event?.type === "thread.started" && typeof event.thread_id === "string" ? event.thread_id : null;
  } catch {
    return null;
  }
}

export function parseCodexFinalMessage(line) {
  try {
    const event = JSON.parse(line);
    const item = event?.type === "item.completed" && event.item?.type === "agent_message" ? event.item : null;
    return typeof item?.text === "string" && item.text.trim() ? item.text.trim() : null;
  } catch {
    return null;
  }
}

export function outputImageName(deliveryFormat, index) {
  if (!Number.isInteger(index) || index < 1 || index > 5) {
    throw new Error("codex_image_output_index_invalid");
  }
  switch (deliveryFormat) {
    case "instagram_feed_carousel":
      return `card-${String(index).padStart(2, "0")}.png`;
    case "instagram_story":
      if (index !== 1) throw new Error("codex_image_output_index_invalid");
      return "story.png";
    case "instagram_reel":
      return `scene-${String(index).padStart(2, "0")}.png`;
    default:
      throw new Error("codex_image_delivery_format_invalid");
  }
}

async function listPngFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listPngFiles(entryPath);
    return entry.isFile() && entry.name.toLowerCase().endsWith(".png") ? [entryPath] : [];
  }));
  return nested.flat();
}

export async function findGeneratedImages({ directory, threadId, maxImages, selectedAssetCount }) {
  if (typeof threadId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(threadId)) {
    throw new Error("codex_image_session_invalid");
  }
  if (!Number.isInteger(maxImages) || maxImages < 1 || maxImages > 5) {
    throw new Error("codex_image_output_count_invalid");
  }
  if (!Number.isInteger(selectedAssetCount) || selectedAssetCount < 1 || selectedAssetCount > maxImages) {
    throw new Error("codex_image_selected_asset_count_invalid");
  }
  const sessionDirectory = path.join(directory, threadId);
  let files;
  try {
    files = await listPngFiles(sessionDirectory);
  } catch {
    throw new Error("codex_image_output_missing");
  }
  const candidates = await Promise.all(files.map(async (filePath) => ({
    filePath,
    modifiedAt: (await stat(filePath)).mtimeMs
  })));
  const generated = candidates
    .sort((left, right) => left.modifiedAt - right.modifiedAt || left.filePath.localeCompare(right.filePath));
  if (generated.length === 0) throw new Error("codex_image_output_missing");
  if (generated.length > maxImages) {
    throw new Error("codex_image_output_count_invalid");
  }
  if (generated.length !== selectedAssetCount) throw new Error("codex_image_output_count_mismatch");
  return generated.map(({ filePath }) => filePath);
}
