import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelConnection, ChannelType } from "../types";

const apiChannels: ChannelConnection[] = [
  {
    type: "instagram",
    label: "Instagram",
    enabled: true,
    oauthState: "connected",
    status: "connected",
    accountLabel: "Meta OAuth",
    lastHealthyAt: "2026-07-07T07:03:56.682Z",
    lastPublishedAt: "-"
  },
  {
    type: "threads",
    label: "Threads",
    enabled: true,
    oauthState: "not_connected",
    status: "not_connected",
    accountLabel: "연결 전",
    lastHealthyAt: "-",
    lastPublishedAt: "-"
  },
  {
    type: "linkedin",
    label: "LinkedIn",
    enabled: false,
    oauthState: "not_connected",
    status: "not_connected",
    accountLabel: "연결 전",
    lastHealthyAt: "-",
    lastPublishedAt: "-"
  },
  {
    type: "tiktok",
    label: "TikTok",
    enabled: false,
    oauthState: "not_connected",
    status: "not_connected",
    accountLabel: "연결 전",
    lastHealthyAt: "-",
    lastPublishedAt: "-"
  },
  {
    type: "youtube",
    label: "YouTube",
    enabled: false,
    oauthState: "not_connected",
    status: "not_connected",
    accountLabel: "연결 전",
    lastHealthyAt: "-",
    lastPublishedAt: "-"
  },
  {
    type: "x",
    label: "X",
    enabled: false,
    oauthState: "not_connected",
    status: "not_connected",
    accountLabel: "연결 전",
    lastHealthyAt: "-",
    lastPublishedAt: "-"
  }
];

beforeEach(() => {
  vi.stubEnv("VITE_API_BASE_URL", "http://localhost:4000");
  vi.stubEnv("VITE_META_OAUTH_START_URL", "http://localhost:4000/auth/meta/start");
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

async function renderChannelsPage(apiOverrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  const api = {
    listChannels: vi.fn(async () => apiChannels),
    getInstagramDmSettings: vi.fn(async () => ({
      brandId: "brand-1",
      enabled: false,
      fallbackMessage: "담당자가 확인하겠습니다.",
      errorMessage: "잠시 후 다시 문의해 주세요.",
      wikiReady: true,
      messagePermissionReady: true,
      webhookStatus: "connected",
      workerStatus: "online"
    })),
    getChannelConnectionRequest: vi.fn(),
    updateChannelConnectionRequest: vi.fn(),
    checkChannel: vi.fn(async (_brandId: string, type: ChannelType) => apiChannels.find((channel) => channel.type === type)),
    updateChannelEnabled: vi.fn(async (_brandId: string, type: ChannelType, enabled: boolean) => ({
      ...apiChannels.find((channel) => channel.type === type)!,
      enabled
    })),
    ...apiOverrides
  };
  vi.doMock("../lib/apiClient", () => ({
    DEMO_BRAND_ID: "brand-1",
    api
  }));
  const { ChannelsPage } = await import("../pages/ChannelsPage");
  render(<ChannelsPage />);
  return api;
}

describe("ChannelsPage", () => {
  it("shows a page skeleton while channel connections are pending", async () => {
    await renderChannelsPage({ listChannels: vi.fn(() => new Promise(() => {})) });

    expect(screen.getByRole("status", { name: "채널 연결 상태를 불러오는 중입니다." })).toHaveClass("skeleton-page");
    expect(screen.queryByText("연결 상태를 불러올 수 없습니다")).not.toBeInTheDocument();
  });

  it("shows channel connection status from the API without the request tab", async () => {
    const api = await renderChannelsPage();

    expect(screen.getByRole("heading", { name: "채널 연결" })).toBeInTheDocument();
    expect(await screen.findByText("Meta OAuth")).toBeVisible();
    expect(screen.getByRole("heading", { name: "TikTok" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "YouTube" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "X" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "LinkedIn" })).toBeVisible();
    expect(screen.getAllByText("연결 전")).toHaveLength(5);
    expect(screen.getByText("5개 미연결")).toBeVisible();
    expect(screen.queryByRole("tab", { name: "연결 요청" })).not.toBeInTheDocument();
    expect(api.getChannelConnectionRequest).not.toHaveBeenCalled();
  });

  it("keeps credential and manual request fields out of the customer channel page", async () => {
    await renderChannelsPage();
    await screen.findByText("Meta OAuth");

    expect(screen.queryByLabelText("Instagram Access Token")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Instagram Business Account ID")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Webflow API Token")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Instagram 계정 핸들")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("담당자 이메일")).not.toBeInTheDocument();
  });

  it("shows the Meta OAuth start link on the customer channel page", async () => {
    await renderChannelsPage();

    const link = await screen.findByRole("link", { name: /Meta/ });
    expect(link).toHaveAttribute(
      "href",
      "http://localhost:4000/auth/meta/start"
    );
    expect(screen.queryByRole("button", { name: "연결 확인" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "전체 연결 확인" })).not.toBeInTheDocument();
  });

  it("opens a detailed connection guide for every supported channel", async () => {
    await renderChannelsPage();
    await screen.findByText("Meta OAuth");

    expect(screen.getAllByRole("button", { name: /연결 가이드/ })).toHaveLength(6);

    await userEvent.click(screen.getByRole("button", { name: "Instagram 연결 가이드" }));
    expect(screen.getByRole("dialog", { name: "Instagram 연결 가이드" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "비즈니스 계정으로 전환" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "트렌드 탐색을 사용할 때만 Page 연결" })).toBeVisible();
    expect(screen.getByText(/게시와 DM 연결에는 Facebook Page가 필수가 아닙니다/)).toBeVisible();
    expect(screen.getByText("instagram_business_content_publish")).toBeVisible();
    expect(screen.getByText(/아이디와 비밀번호를 모종에 입력하지 않습니다/)).toBeVisible();
    expect(screen.getByRole("heading", { name: "공식 문서" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "연결 가이드 닫기" }));

    await userEvent.click(screen.getByRole("button", { name: "YouTube 연결 가이드" }));
    expect(screen.getByRole("dialog", { name: "YouTube 연결 가이드" })).toBeVisible();
    expect(screen.getByText(/YouTube 채널을 먼저 생성/)).toBeVisible();
  });

  it("closes the channel guide with Escape", async () => {
    await renderChannelsPage();
    await screen.findByText("Meta OAuth");

    await userEvent.click(screen.getByRole("button", { name: "Threads 연결 가이드" }));
    expect(screen.getByRole("dialog", { name: "Threads 연결 가이드" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Threads 연결 가이드" })).not.toBeInTheDocument();
  });

  it("allows activation only after the channel is authenticated", async () => {
    const api = await renderChannelsPage();

    const instagramToggle = await screen.findByRole("switch", { name: "Instagram 채널 활성화" });
    expect(instagramToggle).toBeChecked();
    expect(screen.getByRole("link", { name: "Meta 다시 연결" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: "연결 준비 중" })).toHaveLength(5);

    const linkedinToggle = screen.getByRole("switch", { name: "LinkedIn 채널 활성화" });
    expect(screen.getByRole("switch", { name: "Threads 채널 활성화" })).not.toBeChecked();
    expect(linkedinToggle).toBeDisabled();
    await userEvent.click(linkedinToggle);

    expect(api.updateChannelEnabled).not.toHaveBeenCalled();
    expect(linkedinToggle).not.toBeChecked();
    expect(screen.getAllByText("인증 후 활성화할 수 있습니다.")).toHaveLength(5);
  });

  it("shows an empty state when channels cannot be loaded", async () => {
    await renderChannelsPage({
      listChannels: vi.fn(async () => {
        throw new Error("api_down");
      })
    });

    expect(await screen.findByText("연결 상태를 불러올 수 없습니다")).toBeVisible();
    expect(screen.getByText(/API 서버가 응답하지 않아/)).toBeVisible();
  });
});
