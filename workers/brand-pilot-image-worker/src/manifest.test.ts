import { describe, expect, it } from "vitest";
import { parseWorkerManifest } from "./manifest.js";

const hashtags = ["#제주여행", "#가족여행", "#제주숙소", "#여행동선", "#여행준비"];

function asset(index: number, width: number, height: number) {
  return {
    index,
    role: `role-${index}`,
    embeddedText: `고유한 메시지 ${index}`,
    width,
    height,
    checksum: `checksum-${index}`
  };
}

function feed(count: number) {
  return {
    deliveryFormat: "instagram_feed_carousel",
    promptVersion: "worker-card.v4",
    selectedAssetCount: count,
    caption: "첫 번째 문단입니다.\n\n두 번째 문단입니다.",
    hashtags,
    cards: Array.from({ length: count }, (_, index) => asset(index + 1, 1080, 1080)),
    validation: { passed: false }
  };
}

function story(count = 1) {
  return {
    deliveryFormat: "instagram_story",
    promptVersion: "worker-story.v1",
    selectedAssetCount: count,
    story: Array.from({ length: count }, (_, index) => asset(index + 1, 1080, 1920)),
    validation: { passed: false }
  };
}

function reel(count: number) {
  return {
    deliveryFormat: "instagram_reel",
    promptVersion: "worker-reel.v3",
    selectedAssetCount: count,
    caption: "릴 첫 문단입니다.\n\n릴 두 번째 문단입니다.",
    hashtags,
    scenes: Array.from({ length: count }, (_, index) => asset(index + 1, 1080, 1920)),
    validation: { passed: false }
  };
}

describe("parseWorkerManifest", () => {
  it.each([1, 3])("accepts a %i-card feed", (count) => {
    const result = parseWorkerManifest(feed(count));

    expect(result.deliveryFormat).toBe("instagram_feed_carousel");
    expect(result.selectedAssetCount).toBe(count);
    expect(result.assets).toHaveLength(count);
    expect(result.validation).toEqual({ passed: true });
  });

  it("accepts exactly one story", () => {
    const result = parseWorkerManifest(story());

    expect(result.deliveryFormat).toBe("instagram_story");
    expect(result.selectedAssetCount).toBe(1);
    expect(result.assets).toHaveLength(1);
    expect(result.validation).toEqual({ passed: true });
  });

  it("accepts exactly one Reel image", () => {
    const result = parseWorkerManifest(reel(1));

    expect(result.deliveryFormat).toBe("instagram_reel");
    expect(result.selectedAssetCount).toBe(1);
    expect(result.assets).toHaveLength(1);
    expect(result.validation).toEqual({ passed: true });
  });

  it.each([
    [feed(6), "asset_count_out_of_range"],
    [reel(2), "reel_asset_count_invalid"],
    [story(2), "story_asset_count_invalid"]
  ])("rejects an invalid per-format count", (manifest, error) => {
    expect(() => parseWorkerManifest(manifest)).toThrow(error);
  });

  it("treats maxImages as an upper bound", () => {
    expect(() => parseWorkerManifest(feed(3), { maxImages: 2 })).toThrow("asset_count_out_of_range");
    expect(parseWorkerManifest(feed(1), { maxImages: 5 }).selectedAssetCount).toBe(1);
  });

  it("requires selectedAssetCount to equal the generated asset plan", () => {
    const manifest = { ...feed(3), selectedAssetCount: 2 };

    expect(() => parseWorkerManifest(manifest)).toThrow("selected_asset_count_mismatch");
  });

  it("rejects empty and case-insensitively duplicate roles", () => {
    const emptyRole = feed(1);
    emptyRole.cards[0].role = "   ";
    expect(() => parseWorkerManifest(emptyRole)).toThrow("asset_role_invalid");

    const duplicateRoles = feed(3);
    duplicateRoles.cards[1].role = " HOOK ";
    duplicateRoles.cards[2].role = "hook";
    expect(() => parseWorkerManifest(duplicateRoles)).toThrow("asset_role_duplicate");
  });

  it("rejects duplicate normalized embedded text", () => {
    const manifest = feed(3);
    manifest.cards[0].embeddedText = "한 번만 쓸 메시지";
    manifest.cards[1].embeddedText = "  한 번만   쓸 메시지  ";

    expect(() => parseWorkerManifest(manifest)).toThrow("asset_text_duplicate");
  });

  it("rejects duplicate checksums when present", () => {
    const manifest = feed(3);
    manifest.cards[1].checksum = "ABC123";
    manifest.cards[2].checksum = " abc123 ";

    expect(() => parseWorkerManifest(manifest)).toThrow("asset_checksum_duplicate");
  });

  it("rejects a CTA-only filler asset in any position by role or text", () => {
    const byRole = feed(3);
    byRole.cards[0].role = "CTA";
    byRole.cards[0].embeddedText = "브랜드 사이트";
    expect(() => parseWorkerManifest(byRole)).toThrow("asset_final_cta_only");

    const byText = reel(1);
    byText.scenes[0].embeddedText = "자세히 확인하기";
    expect(() => parseWorkerManifest(byText)).toThrow("asset_final_cta_only");
  });

  it("accepts CLI-reported vertical dimensions for Story and Reel while keeping Feed square", () => {
    const verticalStory = story();
    Reflect.deleteProperty(verticalStory.story[0], "width");
    Reflect.deleteProperty(verticalStory.story[0], "height");
    const parsedStory = parseWorkerManifest(verticalStory);
    if (parsedStory.deliveryFormat !== "instagram_story") throw new Error("expected_story_manifest");
    expect(parsedStory.story).toMatchObject({ width: 1080, height: 1920 });

    const verticalReel = reel(1);
    Reflect.deleteProperty(verticalReel.scenes[0], "width");
    Reflect.deleteProperty(verticalReel.scenes[0], "height");
    const parsedReel = parseWorkerManifest(verticalReel);
    if (parsedReel.deliveryFormat !== "instagram_reel") throw new Error("expected_reel_manifest");
    expect(parsedReel.scenes[0]).toMatchObject({ width: 1080, height: 1920 });

    const verticalFeed = feed(1);
    verticalFeed.cards[0].height = 1920;
    expect(() => parseWorkerManifest(verticalFeed)).toThrow("image_asset_dimensions_invalid");
  });

  it("requires nonempty captions and exactly five unique valid hashtags for feed and reel", () => {
    expect(() => parseWorkerManifest({ ...feed(1), caption: " " })).toThrow("image_manifest_caption_required");
    expect(() => parseWorkerManifest({ ...reel(1), hashtags: hashtags.slice(0, 4) })).toThrow("image_manifest_hashtags_invalid");
    expect(() => parseWorkerManifest({ ...feed(1), hashtags: ["#One", "#one", "#three", "#four", "#five"] }))
      .toThrow("image_manifest_hashtags_invalid");
    expect(() => parseWorkerManifest({ ...reel(1), hashtags: ["#one", "not-a-tag", "#three", "#four", "#five"] }))
      .toThrow("image_manifest_hashtags_invalid");
  });

  it("allows story manifests to omit caption and hashtags", () => {
    const result = parseWorkerManifest(story());

    expect(result.caption).toBeUndefined();
    expect(result.hashtags).toBeUndefined();
  });

  it("does not trust an incoming passed validation flag", () => {
    const invalid = feed(3);
    invalid.validation.passed = true;
    invalid.cards[2].role = "CTA";

    expect(() => parseWorkerManifest(invalid)).toThrow("asset_final_cta_only");
  });
});
