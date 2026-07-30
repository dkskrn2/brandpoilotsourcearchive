import { describe, expect, it } from "vitest";
import type { ChannelConnection } from "../../types";
import { buildAiContentPublishOptions } from "./aiContentPublishTargets";

const connectedInstagram: ChannelConnection = {
  type: "instagram",
  label: "Instagram",
  enabled: true,
  oauthState: "connected",
  status: "connected",
  accountLabel: "@growthline352",
  lastHealthyAt: "2026-07-20T00:00:00.000Z",
  lastPublishedAt: "2026-07-20T00:00:00.000Z",
};

describe("buildAiContentPublishOptions", () => {
  it("always returns six channels and compatible Instagram card-news formats", () => {
    const options = buildAiContentPublishOptions({ type: "card_news", assetCount: 3, channels: [connectedInstagram] });

    expect(options).toHaveLength(6);
    expect(options).toEqual(expect.arrayContaining([
      expect.objectContaining({
        channel: "instagram",
        connected: true,
        accountLabel: "@growthline352",
        formats: [
          expect.objectContaining({ deliveryFormat: "instagram_feed_carousel", enabled: true }),
          expect.objectContaining({ deliveryFormat: "instagram_story", enabled: true }),
          expect.objectContaining({
            deliveryFormat: "instagram_reel",
            enabled: true,
            reason: "세로형 영상으로 변환 후 게시",
          }),
        ],
      }),
      expect.objectContaining({ channel: "threads", connected: false, statusLabel: "OAuth 게시 계정 미연결", formats: [] }),
    ]));
  });

  it("uses a single-feed format for one marketing image", () => {
    const instagram = buildAiContentPublishOptions({ type: "marketing", assetCount: 1, channels: [connectedInstagram] })[0];
    expect(instagram.formats[0]).toMatchObject({ deliveryFormat: "instagram_feed_single", enabled: true });
    expect(instagram.formats[1]).toMatchObject({ deliveryFormat: "instagram_story", enabled: true });
  });

  it("never downgrades card news to a single-feed request when the client sees one asset", () => {
    const instagram = buildAiContentPublishOptions({ type: "card_news", assetCount: 1, channels: [connectedInstagram] })[0];

    expect(instagram.formats[0]).toMatchObject({
      deliveryFormat: "instagram_feed_carousel",
      enabled: true,
    });
  });

  it("does not expose direct publishing formats for blog HTML", () => {
    const instagram = buildAiContentPublishOptions({ type: "blog", assetCount: 2, channels: [connectedInstagram] })[0];
    expect(instagram.formats).toEqual([]);
  });
});
