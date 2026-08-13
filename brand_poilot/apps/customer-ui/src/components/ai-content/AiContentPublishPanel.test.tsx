import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ChannelConnection } from "../../types";
import { AiContentPublishPanel } from "./AiContentPublishPanel";

const channels: ChannelConnection[] = [{
  type: "instagram",
  label: "Instagram",
  enabled: true,
  oauthState: "connected",
  status: "connected",
  accountLabel: "@growthline352",
  lastHealthyAt: "2026-07-20T00:00:00.000Z",
  lastPublishedAt: "2026-07-20T00:00:00.000Z",
}];

describe("AiContentPublishPanel", () => {
  it("submits selected feed and static Story without exposing Reel generation", async () => {
    const user = userEvent.setup();
    const onPublish = vi.fn(async () => undefined);
    render(<AiContentPublishPanel manifestVersion="ai-content.v3" outputFormat="card_news" assetCount={3} channels={channels} publishing={false} results={[]} onPublish={onPublish} />);

    expect(screen.getByText("Instagram")).toBeVisible();
    expect(screen.getByText("Threads OAuth 게시 계정 미연결")).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: "게시물" }));
    await user.click(screen.getByRole("checkbox", { name: "스토리" }));
    expect(screen.queryByRole("checkbox", { name: "릴스" })).not.toBeInTheDocument();
    expect(screen.queryByText(/세로형 영상으로 변환/)).not.toBeInTheDocument();
    const publishButton = screen.getByRole("button", { name: "선택한 2개 유형 게시" });
    await user.click(publishButton);

    expect(onPublish).toHaveBeenCalledOnce();
    expect(onPublish).toHaveBeenCalledWith([
      { channel: "instagram", deliveryFormat: "instagram_feed_carousel" },
      { channel: "instagram", deliveryFormat: "instagram_story" },
    ]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the card-news carousel contract even when one asset is visible", async () => {
    const user = userEvent.setup();
    const onPublish = vi.fn(async () => undefined);
    render(<AiContentPublishPanel manifestVersion="ai-content.v3" outputFormat="card_news" assetCount={1} channels={channels} publishing={false} results={[]} onPublish={onPublish} />);

    const feed = screen.getByRole("checkbox", { name: "게시물" });
    expect(feed).toBeEnabled();
    await user.click(feed);
    await user.click(screen.getByRole("button", { name: "선택한 1개 유형 게시" }));

    expect(onPublish).toHaveBeenCalledWith([
      { channel: "instagram", deliveryFormat: "instagram_feed_carousel" },
    ]);
  });

  it("offers a retry only for the failed target", async () => {
    const user = userEvent.setup();
    const onPublish = vi.fn(async () => undefined);
    render(<AiContentPublishPanel
      manifestVersion="ai-content.v3"
      outputFormat="card_news"
      assetCount={1}
      channels={channels}
      publishing={false}
      results={[{
        channel: "instagram",
        deliveryFormat: "instagram_feed_carousel",
        channelOutputId: "output-1",
        queueId: "queue-1",
        status: "failed",
        publishedUrl: null,
        errorCode: "publish_failed",
      }]}
      onPublish={onPublish}
    />);

    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(onPublish).toHaveBeenCalledWith([{ channel: "instagram", deliveryFormat: "instagram_feed_carousel" }]);
  });

  it.each([
    ["channel_oauth_not_connected", "Instagram 연결이 필요합니다."],
    ["instagram_story_publish_failed", "Instagram 스토리 게시에 실패했습니다."],
    ["instagram_rendered_story_required", "스토리에 사용할 이미지 주소를 확인할 수 없습니다."],
    ["instagram_access_token_required", "Instagram 인증이 만료되었거나 권한이 없습니다."],
    ["meta_token_invalid", "Instagram 인증이 만료되었거나 권한이 없습니다."],
    ["instagram_manifest_fetch_failed", "게시 이미지 준비가 지연되었습니다. 잠시 후 다시 시도해 주세요."],
    ["instagram_public_url_required", "Instagram에서 결과물 이미지에 접근하지 못했습니다. 공개 이미지 주소를 확인해 주세요."],
    ["ai_content_publish_reel_video_invalid", "게시할 릴스 영상을 확인할 수 없습니다."],
    ["reel_video_required", "게시 큐에서 릴스 영상 주소를 확인하지 못했습니다."],
  ])("shows an actionable message for %s", (errorCode, message) => {
    render(<AiContentPublishPanel
      manifestVersion="ai-content.v3"
      outputFormat="card_news"
      assetCount={1}
      channels={channels}
      publishing={false}
      results={[{
        channel: "instagram",
        deliveryFormat: "instagram_story",
        channelOutputId: "output-story",
        queueId: "queue-story",
        status: "failed",
        publishedUrl: null,
        errorCode,
      }]}
      onPublish={vi.fn()}
    />);

    expect(screen.getByText(message)).toBeVisible();
  });

  it("shows pending connection feedback for channels without OAuth routes", async () => {
    const user = userEvent.setup();
    render(<AiContentPublishPanel manifestVersion="ai-content.v3" outputFormat="card_news" assetCount={1} channels={[]} publishing={false} results={[]} onPublish={vi.fn()} />);
    const rows = screen.getAllByText("연결하기");
    await user.click(rows[1]);
    expect(screen.getByText("연결 준비 중")).toBeVisible();
  });

  it("submits the completed Reel video without exposing card-news formats", async () => {
    const user = userEvent.setup();
    const onPublish = vi.fn(async () => undefined);
    render(<AiContentPublishPanel manifestVersion="ai-content.v3" outputFormat="reel" assetCount={2} channels={channels} publishing={false} results={[]} onPublish={onPublish} />);

    const reel = screen.getByRole("checkbox", { name: "릴스" });
    expect(screen.queryByRole("checkbox", { name: "게시물" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "스토리" })).not.toBeInTheDocument();
    await user.click(reel);
    await user.click(screen.getByRole("button", { name: "선택한 1개 유형 게시" }));
    expect(onPublish).toHaveBeenCalledWith([{ channel: "instagram", deliveryFormat: "instagram_reel" }]);
  });

  it("does not expose remote publish actions for V3 blog results", () => {
    render(<AiContentPublishPanel manifestVersion="ai-content.v3" outputFormat="blog" assetCount={2} channels={channels} publishing={false} results={[]} onPublish={vi.fn()} />);

    expect(screen.queryByRole("region", { name: "SNS에 바로 게시" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /게시/ })).not.toBeInTheDocument();
  });
});
