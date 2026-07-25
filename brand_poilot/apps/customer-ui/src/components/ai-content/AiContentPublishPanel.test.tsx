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
  it("submits selected feed, story, and reel without a confirmation dialog", async () => {
    const user = userEvent.setup();
    const onPublish = vi.fn(async () => undefined);
    render(<AiContentPublishPanel type="card_news" assetCount={3} channels={channels} publishing={false} results={[]} onPublish={onPublish} />);

    expect(screen.getByText("Instagram")).toBeVisible();
    expect(screen.getByText("Threads OAuth 게시 계정 미연결")).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: "게시물" }));
    await user.click(screen.getByRole("checkbox", { name: "스토리" }));
    await user.click(screen.getByRole("checkbox", { name: "릴스" }));
    const publishButton = screen.getByRole("button", { name: "선택한 3개 유형 게시" });
    await user.click(publishButton);

    expect(onPublish).toHaveBeenCalledOnce();
    expect(onPublish).toHaveBeenCalledWith([
      { channel: "instagram", deliveryFormat: "instagram_feed_carousel" },
      { channel: "instagram", deliveryFormat: "instagram_story" },
      { channel: "instagram", deliveryFormat: "instagram_reel" },
    ]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers a retry only for the failed target", async () => {
    const user = userEvent.setup();
    const onPublish = vi.fn(async () => undefined);
    render(<AiContentPublishPanel
      type="marketing"
      assetCount={1}
      channels={channels}
      publishing={false}
      results={[{
        channel: "instagram",
        deliveryFormat: "instagram_feed_single",
        channelOutputId: "output-1",
        queueId: "queue-1",
        status: "failed",
        publishedUrl: null,
        errorCode: "publish_failed",
      }]}
      onPublish={onPublish}
    />);

    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(onPublish).toHaveBeenCalledWith([{ channel: "instagram", deliveryFormat: "instagram_feed_single" }]);
  });

  it.each([
    ["channel_oauth_not_connected", "Instagram 연결이 필요합니다."],
    ["instagram_story_publish_failed", "Instagram 스토리 게시에 실패했습니다."],
    ["instagram_rendered_story_required", "스토리에 사용할 이미지 주소를 확인할 수 없습니다."],
    ["instagram_access_token_required", "Instagram 인증이 만료되었거나 권한이 없습니다."],
    ["meta_token_invalid", "Instagram 인증이 만료되었거나 권한이 없습니다."],
    ["instagram_manifest_fetch_failed", "게시 이미지 준비가 지연되었습니다. 잠시 후 다시 시도해 주세요."],
    ["instagram_public_url_required", "Instagram에서 결과물 이미지에 접근하지 못했습니다. 공개 이미지 주소를 확인해 주세요."],
  ])("shows an actionable message for %s", (errorCode, message) => {
    render(<AiContentPublishPanel
      type="marketing"
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
    render(<AiContentPublishPanel type="marketing" assetCount={1} channels={[]} publishing={false} results={[]} onPublish={vi.fn()} />);
    const rows = screen.getAllByText("연결하기");
    await user.click(rows[1]);
    expect(screen.getByText("연결 준비 중")).toBeVisible();
  });
});
