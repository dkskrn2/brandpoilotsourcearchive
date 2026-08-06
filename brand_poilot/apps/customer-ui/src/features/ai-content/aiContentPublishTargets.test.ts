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
  it("keeps static Story publishing but excludes user-facing Reel generation", () => {
    const options = buildAiContentPublishOptions({ outputFormat: "card_news", assetCount: 3, channels: [connectedInstagram] });

    expect(options).toHaveLength(6);
    expect(options).toEqual(expect.arrayContaining([
      expect.objectContaining({
        channel: "instagram",
        connected: true,
        accountLabel: "@growthline352",
        formats: [
          expect.objectContaining({ deliveryFormat: "instagram_feed_carousel", enabled: true }),
          expect.objectContaining({ deliveryFormat: "instagram_story", enabled: true }),
        ],
      }),
      expect.objectContaining({ channel: "threads", connected: false, statusLabel: "OAuth 게시 계정 미연결", formats: [] }),
    ]));
    expect(options[0].formats.map((format) => format.deliveryFormat)).not.toContain("instagram_reel");
  });

  it("never downgrades card news to a single-feed request when the client sees one asset", () => {
    const instagram = buildAiContentPublishOptions({ outputFormat: "card_news", assetCount: 1, channels: [connectedInstagram] })[0];

    expect(instagram.formats[0]).toMatchObject({
      deliveryFormat: "instagram_feed_carousel",
      enabled: true,
    });
  });

  it("does not expose direct publishing formats for blog HTML", () => {
    const instagram = buildAiContentPublishOptions({ outputFormat: "blog", assetCount: 2, channels: [connectedInstagram] })[0];
    expect(instagram.formats).toEqual([]);
  });

  it("does not expose direct publishing formats for reel video", () => {
    const instagram = buildAiContentPublishOptions({ outputFormat: "reel", assetCount: 2, channels: [connectedInstagram] })[0];
    expect(instagram.formats).toEqual([]);
  });
});
