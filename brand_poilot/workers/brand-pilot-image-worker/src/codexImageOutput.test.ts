import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findGeneratedImages, outputImageName, parseCodexFinalMessage, parseCodexThreadId, resolveCodexGeneratedImagesDirectory } from "./codexImageOutput.mjs";

describe("findGeneratedImages", () => {
  it("uses CODEX_HOME generated_images instead of a project-local assumption", () => {
    expect(resolveCodexGeneratedImagesDirectory({ codexHome: "C:\\codex-home", homeDir: "C:\\Users\\worker" }))
      .toBe(path.join("C:\\codex-home", "generated_images"));
    expect(resolveCodexGeneratedImagesDirectory({ homeDir: "C:\\Users\\worker" }))
      .toBe(path.join("C:\\Users\\worker", ".codex", "generated_images"));
  });

  it("returns every PNG written by the current Codex imagegen run in creation order", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "codex-imagegen-"));
    const sessionDirectory = path.join(directory, "session-1");
    await mkdir(sessionDirectory);
    const startedAt = Date.now();
    const first = path.join(sessionDirectory, "first.png");
    const second = path.join(sessionDirectory, "second.png");
    await writeFile(first, "png-1");
    await writeFile(second, "png-2");
    await utimes(first, new Date(startedAt), new Date(startedAt));
    await utimes(second, new Date(startedAt + 100), new Date(startedAt + 100));

    await expect(findGeneratedImages({ directory, threadId: "session-1", maxImages: 5, selectedAssetCount: 2 })).resolves.toEqual([first, second]);
  });

  it("finds generated PNG files in Codex-created subdirectories", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "codex-imagegen-"));
    const nestedDirectory = path.join(directory, "session-1", "nested");
    await mkdir(nestedDirectory, { recursive: true });
    const image = path.join(nestedDirectory, "card.png");
    await writeFile(image, "png");

    await expect(findGeneratedImages({ directory, threadId: "session-1", maxImages: 5, selectedAssetCount: 1 })).resolves.toEqual([image]);
  });

  it("extracts the image session from Codex JSONL output", () => {
    expect(parseCodexThreadId('{"type":"thread.started","thread_id":"session-1"}')).toBe("session-1");
    expect(parseCodexThreadId('{"type":"item.completed"}')).toBeNull();
  });

  it("extracts the final agent message from Codex JSONL output", () => {
    expect(parseCodexFinalMessage('{"type":"item.completed","item":{"type":"agent_message","text":"{\\"title\\":\\"카드뉴스\\"}"}}'))
      .toBe('{"title":"카드뉴스"}');
    expect(parseCodexFinalMessage('{"type":"turn.completed"}')).toBeNull();
  });

  it("only returns PNG files from the claimed Codex session", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "codex-imagegen-"));
    const ownSession = path.join(directory, "session-1");
    const otherSession = path.join(directory, "session-2");
    await mkdir(ownSession);
    await mkdir(otherSession);
    const ownImage = path.join(ownSession, "card.png");
    await writeFile(ownImage, "own");
    await writeFile(path.join(otherSession, "card.png"), "other");

    await expect(findGeneratedImages({ directory, threadId: "session-1", maxImages: 5, selectedAssetCount: 1 })).resolves.toEqual([ownImage]);
  });

  it("ignores pre-existing files and rejects missing output", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "codex-imagegen-"));
    const sessionDirectory = path.join(directory, "session-1");
    await mkdir(sessionDirectory);
    const oldImage = path.join(sessionDirectory, "old.png");
    await writeFile(oldImage, "old");

    await expect(findGeneratedImages({
      directory,
      threadId: "session-2",
      maxImages: 5,
      selectedAssetCount: 1
    })).rejects.toThrow("codex_image_output_missing");
  });

  it("rejects more images than the job allows", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "codex-imagegen-"));
    const sessionDirectory = path.join(directory, "session-1");
    await mkdir(sessionDirectory);
    await Promise.all(Array.from({ length: 6 }, (_, index) => writeFile(path.join(sessionDirectory, `${index}.png`), "png")));

    await expect(findGeneratedImages({ directory, threadId: "session-1", maxImages: 5, selectedAssetCount: 5 })).rejects.toThrow("codex_image_output_count_invalid");
  });

  it("requires the generated PNG count to equal the manifest-selected count", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "codex-imagegen-"));
    const sessionDirectory = path.join(directory, "session-1");
    await mkdir(sessionDirectory);
    await writeFile(path.join(sessionDirectory, "one.png"), "png");

    await expect(findGeneratedImages({
      directory,
      threadId: "session-1",
      maxImages: 5,
      selectedAssetCount: 2
    })).rejects.toThrow("codex_image_output_count_mismatch");
  });

  it("uses deterministic format-specific output names", () => {
    expect(outputImageName("instagram_feed_carousel", 1)).toBe("card-01.png");
    expect(outputImageName("instagram_feed_carousel", 5)).toBe("card-05.png");
    expect(outputImageName("instagram_story", 1)).toBe("story.png");
    expect(outputImageName("instagram_reel", 1)).toBe("scene-01.png");
    expect(outputImageName("instagram_reel", 5)).toBe("scene-05.png");
    expect(() => outputImageName("instagram_story", 2)).toThrow("codex_image_output_index_invalid");
  });
});
