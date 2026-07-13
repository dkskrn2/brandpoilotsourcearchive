import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  createConfiguredRenderer,
  loadRenderedPackage,
  normalizeRenderedPng
} from "./renderer.js";
import type { ClaimedImageJob } from "./worker.js";

const temporaryDirectories: string[] = [];
const hashtags = ["#one", "#two", "#three", "#four", "#five"];

function jobFor(
  deliveryFormat: "instagram_feed_carousel" | "instagram_story" | "instagram_reel"
): ClaimedImageJob {
  const promptVersion = deliveryFormat === "instagram_feed_carousel"
    ? "worker-card.v4"
    : deliveryFormat === "instagram_story"
      ? "worker-story.v1"
      : "worker-reel.v3";
  return {
    id: "job-1",
    leaseToken: "lease-1",
    brandId: "brand-1",
    channelOutputId: "output-1",
    payload: { deliveryFormat, promptVersion, maxImages: 5 }
  };
}

function asset(index: number, height: 1080 | 1920) {
  return {
    index,
    role: `role-${index}`,
    embeddedText: `message-${index}`,
    width: 1080,
    height
  };
}

async function outputDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "brand-pilot-renderer-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function png(width: number, height: number) {
  return sharp({
    create: { width, height, channels: 4, background: "#ffffff" }
  }).png().toBuffer();
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("configured image renderer", () => {
  it("rejects the fixture renderer outside automated tests", () => {
    expect(() => createConfiguredRenderer({ provider: "fixture", nodeEnv: "development" })).toThrow("fixture_renderer_test_only");
  });

  it("keeps the feed fixture compatible in the test environment", async () => {
    const renderer = createConfiguredRenderer({ provider: "fixture", nodeEnv: "test" });

    const rendered = await renderer.renderJob(jobFor("instagram_feed_carousel"));

    expect(rendered.manifest.deliveryFormat).toBe("instagram_feed_carousel");
    expect(rendered.manifest.hashtags).toHaveLength(5);
    expect(rendered.images).toEqual([
      expect.objectContaining({ index: 1, mimeType: "image/png", width: 1080, height: 1080 })
    ]);
  });

  it.each([
    ["instagram_feed_carousel", 1080] as const,
    ["instagram_story", 1920] as const,
    ["instagram_reel", 1920] as const
  ])("normalizes %s PNGs to 1080 by %i", async (deliveryFormat, height) => {
    const source = await png(deliveryFormat === "instagram_feed_carousel" ? 1254 : 1125, deliveryFormat === "instagram_feed_carousel" ? 1254 : 2000);

    const normalized = await normalizeRenderedPng(source, { width: 1080, height });
    const metadata = await sharp(normalized).metadata();

    expect(metadata).toMatchObject({ format: "png", width: 1080, height });
  });

  it("rejects a feed card with a non-square source instead of cropping text", async () => {
    const source = await png(1200, 900);

    await expect(normalizeRenderedPng(source, { width: 1080, height: 1080 }))
      .rejects.toThrow("image_render_output_aspect_ratio_invalid");
  });

  it("loads the actual Story asset count and deterministic story.png name from the validated manifest", async () => {
    const directory = await outputDirectory();
    await writeFile(path.join(directory, "story.png"), await png(1024, 1536));
    await writeFile(path.join(directory, "content.json"), JSON.stringify({
      deliveryFormat: "instagram_story",
      promptVersion: "worker-story.v1",
      selectedAssetCount: 1,
      story: [asset(1, 1920)]
    }));

    const rendered = await loadRenderedPackage(jobFor("instagram_story"), directory);

    expect(rendered.manifest).toMatchObject({
      deliveryFormat: "instagram_story",
      selectedAssetCount: 1,
      validation: { passed: true }
    });
    expect(rendered.images).toEqual([
      expect.objectContaining({ index: 1, width: 1024, height: 1536 })
    ]);
  });

  it("loads one to five Reel scenes by scene-NN.png while maxImages remains only an upper bound", async () => {
    const directory = await outputDirectory();
    await Promise.all([
      writeFile(path.join(directory, "scene-01.png"), await png(1024, 1536)),
      writeFile(path.join(directory, "content.json"), JSON.stringify({
        deliveryFormat: "instagram_reel",
        promptVersion: "worker-reel.v3",
        selectedAssetCount: 1,
        caption: "first paragraph\n\nsecond paragraph",
        hashtags,
        scenes: [asset(1, 1920)]
      }))
    ]);

    const rendered = await loadRenderedPackage(jobFor("instagram_reel"), directory);

    expect(rendered.manifest.selectedAssetCount).toBe(1);
    expect(rendered.images).toHaveLength(1);
    expect(rendered.images.every((image) => image.width === 1024 && image.height === 1536)).toBe(true);
  });

  it("rejects generated file counts that disagree with the validated manifest", async () => {
    const directory = await outputDirectory();
    await Promise.all([
      writeFile(path.join(directory, "card-01.png"), await png(1080, 1080)),
      writeFile(path.join(directory, "card-02.png"), await png(1080, 1080)),
      writeFile(path.join(directory, "content.json"), JSON.stringify({
        deliveryFormat: "instagram_feed_carousel",
        promptVersion: "worker-card.v4",
        selectedAssetCount: 1,
        caption: "first paragraph\n\nsecond paragraph",
        hashtags,
        cards: [asset(1, 1080)]
      }))
    ]);

    await expect(loadRenderedPackage(jobFor("instagram_feed_carousel"), directory))
      .rejects.toThrow("image_render_output_count_mismatch");
  });
});
