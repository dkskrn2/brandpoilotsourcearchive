import { describe, expect, it } from "vitest";
import { parseAiContentPublishRequest, resolveAiContentPublishTarget } from "./aiContentPublishTargets.js";

describe("AI content publish target contracts", () => {
  it.each([
    ["card_news", 3, "instagram_feed_carousel", true],
    ["card_news", 1, "instagram_feed_single", true],
    ["card_news", 3, "instagram_story", true],
    ["card_news", 3, "instagram_reel", true],
    ["marketing", 1, "instagram_feed_single", true],
    ["marketing", 1, "instagram_story", true],
    ["blog", 0, "instagram_feed_single", false],
  ] as const)("resolves %s with %s assets for %s", (type, assetCount, deliveryFormat, supported) => {
    expect(resolveAiContentPublishTarget(
      { type, assetCount },
      { channel: "instagram", deliveryFormat },
    ).supported).toBe(supported);
  });

  it("rejects duplicate channel and format targets", () => {
    expect(() => parseAiContentPublishRequest({
      idempotencyKey: "b4b74082-8a44-46d6-91b6-3e3bd7e26be0",
      targets: [
        { channel: "instagram", deliveryFormat: "instagram_story" },
        { channel: "instagram", deliveryFormat: "instagram_story" },
      ],
    })).toThrow("duplicate_publish_target");
  });

  it("promotes a stale single-feed request to carousel for multi-asset card news", () => {
    expect(resolveAiContentPublishTarget(
      { type: "card_news", assetCount: 3 },
      { channel: "instagram", deliveryFormat: "instagram_feed_single" },
    )).toEqual({
      supported: true,
      target: { channel: "instagram", deliveryFormat: "instagram_feed_carousel" },
    });
  });

  it.each([
    [null, "ai_content_publish_request_invalid"],
    [{ idempotencyKey: "bad", targets: [{ channel: "instagram", deliveryFormat: "instagram_story" }] }, "ai_content_publish_idempotency_key_invalid"],
    [{ idempotencyKey: "b4b74082-8a44-46d6-91b6-3e3bd7e26be0", targets: [] }, "ai_content_publish_targets_invalid"],
    [{ idempotencyKey: "b4b74082-8a44-46d6-91b6-3e3bd7e26be0", targets: [{ channel: "instagram", deliveryFormat: "youtube_short" }] }, "ai_content_publish_target_invalid"],
  ] as const)("rejects an invalid publish request", (input, error) => {
    expect(() => parseAiContentPublishRequest(input)).toThrow(error);
  });

  it("parses a valid multi-target request", () => {
    expect(parseAiContentPublishRequest({
      idempotencyKey: "b4b74082-8a44-46d6-91b6-3e3bd7e26be0",
      targets: [
        { channel: "instagram", deliveryFormat: "instagram_feed_carousel" },
        { channel: "instagram", deliveryFormat: "instagram_story" },
      ],
    })).toEqual({
      idempotencyKey: "b4b74082-8a44-46d6-91b6-3e3bd7e26be0",
      targets: [
        { channel: "instagram", deliveryFormat: "instagram_feed_carousel" },
        { channel: "instagram", deliveryFormat: "instagram_story" },
      ],
    });
  });
});
