import { describe, expect, expectTypeOf, it } from "vitest";
import {
  chooseNextInstagramFormat,
  deliveryFormatToPromptVersion,
  deliveryFormatToRenderJobType,
  instagramFormats,
  instagramPromptVersions,
  renderJobTypeToDeliveryFormat,
  type DeliveryFormat,
  type InstagramDeliveryFormat,
  type InstagramRenderJobType
} from "./instagramFormats.js";
import type {
  BrandContentFormatDto,
  ImageRenderJobPayload,
  InstagramFormatSettingsDto,
  InstagramFormatSettingsInput,
  TopicPublishGroupDto,
  TopicPublishGroupOutputDto
} from "./types.js";

describe("instagram format mappings", () => {
  it("keeps the fixed Instagram delivery order", () => {
    expect(instagramFormats).toEqual([
      "instagram_feed_carousel",
      "instagram_story",
      "instagram_reel"
    ]);
  });

  it.each([
    ["instagram_feed_carousel", "instagram_feed_render"],
    ["instagram_story", "instagram_story_render"],
    ["instagram_reel", "instagram_reel_render"]
  ] as const)("maps %s to %s in both directions", (deliveryFormat, jobType) => {
    expect(deliveryFormatToRenderJobType(deliveryFormat)).toBe(jobType);
    expect(renderJobTypeToDeliveryFormat(jobType)).toBe(deliveryFormat);
  });

  it.each([
    ["instagram_feed_carousel", "worker-card.v4"],
    ["instagram_story", "worker-story.v1"],
    ["instagram_reel", "worker-reel.v1"]
  ] as const)("maps %s to prompt version %s", (deliveryFormat, promptVersion) => {
    expect(instagramPromptVersions[deliveryFormat]).toBe(promptVersion);
    expect(deliveryFormatToPromptVersion(deliveryFormat)).toBe(promptVersion);
  });
});

describe("chooseNextInstagramFormat", () => {
  it("uses fixed global order regardless of caller order", () => {
    const enabled = ["instagram_reel", "instagram_feed_carousel", "instagram_story"] as const;

    expect(chooseNextInstagramFormat(enabled, null)).toBe("instagram_feed_carousel");
    expect(chooseNextInstagramFormat(enabled, "instagram_feed_carousel")).toBe("instagram_story");
  });

  it("returns the first enabled format when there is no previous selection", () => {
    expect(chooseNextInstagramFormat(["instagram_reel", "instagram_story"], null)).toBe("instagram_story");
  });

  it("selects the next enabled format and skips disabled formats", () => {
    const enabled = ["instagram_feed_carousel", "instagram_reel"] as const;

    expect(chooseNextInstagramFormat(enabled, "instagram_feed_carousel")).toBe("instagram_reel");
  });

  it("wraps after the final enabled format", () => {
    const enabled = ["instagram_feed_carousel", "instagram_reel"] as const;

    expect(chooseNextInstagramFormat(enabled, "instagram_reel")).toBe("instagram_feed_carousel");
  });

  it.each([
    [["instagram_feed_carousel", "instagram_reel"], "instagram_story", "instagram_reel"],
    [["instagram_story", "instagram_reel"], "instagram_feed_carousel", "instagram_story"],
    [["instagram_feed_carousel", "instagram_story"], "instagram_reel", "instagram_feed_carousel"]
  ] as const)(
    "resumes after disabled cursor %s according to global position",
    (enabled, lastSelected, expected) => {
      expect(chooseNextInstagramFormat(enabled, lastSelected)).toBe(expected);
    }
  );

  it("returns null when no Instagram format is enabled", () => {
    expect(chooseNextInstagramFormat([], null)).toBeNull();
  });

  it("deduplicates enabled formats without adding rotation positions", () => {
    const enabled = [
      "instagram_reel",
      "instagram_feed_carousel",
      "instagram_reel",
      "instagram_feed_carousel"
    ] as const;

    expect(chooseNextInstagramFormat(enabled, "instagram_feed_carousel")).toBe("instagram_reel");
    expect(chooseNextInstagramFormat(enabled, "instagram_reel")).toBe("instagram_feed_carousel");
  });

  it("does not mutate the enabled input", () => {
    const enabled: InstagramDeliveryFormat[] = ["instagram_reel", "instagram_feed_carousel"];
    const before = [...enabled];

    chooseNextInstagramFormat(enabled, "instagram_feed_carousel");

    expect(enabled).toEqual(before);
  });
});

describe("shared delivery type contracts", () => {
  it("is exactly the seven DB-supported delivery formats", () => {
    const formats = [
      "instagram_feed_carousel",
      "instagram_story",
      "instagram_reel",
      "threads_text",
      "tiktok_video",
      "youtube_video",
      "x_post"
    ] as const satisfies readonly DeliveryFormat[];

    expect(formats).toHaveLength(7);
    expectTypeOf<DeliveryFormat>().toEqualTypeOf<
      | "instagram_feed_carousel"
      | "instagram_story"
      | "instagram_reel"
      | "threads_text"
      | "tiktok_video"
      | "youtube_video"
      | "x_post"
    >();
    expectTypeOf<InstagramDeliveryFormat>().toEqualTypeOf<(typeof instagramFormats)[number]>();
    expectTypeOf<InstagramRenderJobType>().toEqualTypeOf<
      "instagram_feed_render" | "instagram_story_render" | "instagram_reel_render"
    >();
  });

  it("defines the exact brand content format DTO", () => {
    type ExpectedBrandContentFormatDto = {
      format: InstagramDeliveryFormat;
      enabled: boolean;
      rotationOrder: number;
      capabilityStatus: "available" | "unavailable" | "unchecked" | "needs_attention";
      capabilityCheckedAt: string | null;
      capabilityMetadata: Record<string, unknown>;
      lastError: string | null;
    };

    expectTypeOf<BrandContentFormatDto>().toEqualTypeOf<ExpectedBrandContentFormatDto>();
    expectTypeOf<keyof BrandContentFormatDto>().toEqualTypeOf<keyof ExpectedBrandContentFormatDto>();
  });

  it("defines the exact Instagram format settings DTO", () => {
    type ExpectedInstagramFormatSettingsDto = {
      brandId: string;
      brandColor: string | null;
      formats: BrandContentFormatDto[];
    };

    expectTypeOf<InstagramFormatSettingsDto>().toEqualTypeOf<ExpectedInstagramFormatSettingsDto>();
    expectTypeOf<keyof InstagramFormatSettingsDto>().toEqualTypeOf<
      keyof ExpectedInstagramFormatSettingsDto
    >();
  });

  it("keeps settings input entries limited to format and enabled", () => {
    const input = {
      brandColor: "blue",
      formats: [{ format: "instagram_story", enabled: true }]
    } satisfies InstagramFormatSettingsInput;

    expect(Object.keys(input)).toEqual(["brandColor", "formats"]);
    expectTypeOf<NonNullable<InstagramFormatSettingsInput["formats"]>[number]>().toEqualTypeOf<{
      format: InstagramDeliveryFormat;
      enabled: boolean;
    }>();
    expectTypeOf<
      keyof NonNullable<InstagramFormatSettingsInput["formats"]>[number]
    >().toEqualTypeOf<"format" | "enabled">();
  });

  it("rejects user-provided rotation order in settings input entries", () => {
    const invalidInput: InstagramFormatSettingsInput = {
      formats: [{
        format: "instagram_story",
        enabled: true,
        // @ts-expect-error Rotation order is fixed globally and is not accepted from users.
        rotationOrder: 2
      }]
    };

    expectTypeOf(invalidInput).toEqualTypeOf<InstagramFormatSettingsInput>();
  });

  it("accepts every valid topic group channel and delivery format pair", () => {
    type OutputPair<T extends TopicPublishGroupOutputDto = TopicPublishGroupOutputDto> =
      T extends TopicPublishGroupOutputDto ? Pick<T, "channel" | "deliveryFormat"> : never;
    const validPairs = [
      { channel: "instagram", deliveryFormat: "instagram_feed_carousel" },
      { channel: "instagram", deliveryFormat: "instagram_story" },
      { channel: "instagram", deliveryFormat: "instagram_reel" },
      { channel: "threads", deliveryFormat: "threads_text" },
      { channel: "tiktok", deliveryFormat: "tiktok_video" },
      { channel: "youtube", deliveryFormat: "youtube_video" },
      { channel: "x", deliveryFormat: "x_post" }
    ] as const satisfies readonly OutputPair[];

    expect(validPairs).toHaveLength(7);
    expectTypeOf<TopicPublishGroupOutputDto["deliveryFormat"]>().toEqualTypeOf<DeliveryFormat>();
  });

  it("rejects mismatched topic group channels and delivery formats", () => {
    type OutputPair<T extends TopicPublishGroupOutputDto = TopicPublishGroupOutputDto> =
      T extends TopicPublishGroupOutputDto ? Pick<T, "channel" | "deliveryFormat"> : never;
    const invalidPairs = [
      // @ts-expect-error TikTok outputs must use tiktok_video.
      { channel: "tiktok", deliveryFormat: "instagram_story" },
      // @ts-expect-error Instagram outputs must use an Instagram delivery format.
      { channel: "instagram", deliveryFormat: "threads_text" },
      // @ts-expect-error Threads outputs must use threads_text.
      { channel: "threads", deliveryFormat: "x_post" }
    ] as const satisfies readonly OutputPair[];

    expect(invalidPairs).toHaveLength(3);
  });

  it("defines exact topic publish group output and group DTOs", () => {
    type ExpectedOutputBase = {
      id: string;
      queueId: string | null;
      status: string;
      title: string;
      artifactPublicUrl: string | null;
      externalUrl: string | null;
      lastError: string | null;
    };
    type ExpectedOutput =
      | (ExpectedOutputBase & {
          channel: "instagram";
          deliveryFormat: InstagramDeliveryFormat;
        })
      | (ExpectedOutputBase & { channel: "threads"; deliveryFormat: "threads_text" })
      | (ExpectedOutputBase & { channel: "tiktok"; deliveryFormat: "tiktok_video" })
      | (ExpectedOutputBase & { channel: "youtube"; deliveryFormat: "youtube_video" })
      | (ExpectedOutputBase & { channel: "x"; deliveryFormat: "x_post" });
    type ExpectedGroup = {
      id: string;
      brandId: string;
      contentTopicId: string;
      topicTitle: string;
      status: string;
      slotDate: string | null;
      slotNumber: number | null;
      scheduledFor: string | null;
      outputs: TopicPublishGroupOutputDto[];
    };

    expectTypeOf<TopicPublishGroupOutputDto>().toEqualTypeOf<ExpectedOutput>();
    expectTypeOf<TopicPublishGroupDto>().toEqualTypeOf<ExpectedGroup>();
    expectTypeOf<keyof TopicPublishGroupDto>().toEqualTypeOf<keyof ExpectedGroup>();
  });

  it("defines the exact shared render payload context", () => {
    type ExpectedSharedPayload = {
      topic: {
        title: string;
        angle: string;
        targetCustomer: string | null;
        region: string | null;
        season: string | null;
        notes: string | null;
      };
      brand: {
        name: string;
        industry: string | null;
        primaryCustomer: string | null;
        description: string | null;
        tone: string | null;
        brandColor: string | null;
      };
      representativeUrl: string | null;
      maxImages: 5;
    };
    type SharedPayload = Pick<
      ImageRenderJobPayload,
      "topic" | "brand" | "representativeUrl" | "maxImages"
    >;

    expectTypeOf<SharedPayload>().toEqualTypeOf<ExpectedSharedPayload>();
    expectTypeOf<keyof SharedPayload>().toEqualTypeOf<keyof ExpectedSharedPayload>();
  });

  it("discriminates exact prompt versions by delivery format", () => {
    type FeedPayload = Extract<ImageRenderJobPayload, { deliveryFormat: "instagram_feed_carousel" }>;
    type StoryPayload = Extract<ImageRenderJobPayload, { deliveryFormat: "instagram_story" }>;
    type ReelPayload = Extract<ImageRenderJobPayload, { deliveryFormat: "instagram_reel" }>;

    expectTypeOf<FeedPayload["deliveryFormat"]>().toEqualTypeOf<"instagram_feed_carousel">();
    expectTypeOf<FeedPayload["promptVersion"]>().toEqualTypeOf<"worker-card.v4">();
    expectTypeOf<StoryPayload["deliveryFormat"]>().toEqualTypeOf<"instagram_story">();
    expectTypeOf<StoryPayload["promptVersion"]>().toEqualTypeOf<"worker-story.v1">();
    expectTypeOf<ReelPayload["deliveryFormat"]>().toEqualTypeOf<"instagram_reel">();
    expectTypeOf<ReelPayload["promptVersion"]>().toEqualTypeOf<"worker-reel.v1">();
    expectTypeOf<ImageRenderJobPayload["maxImages"]>().toEqualTypeOf<5>();
  });
});
