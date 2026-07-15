import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelConnection, ChannelType } from "../types";

const apiChannels: ChannelConnection[] = [
  {
    type: "instagram",
    label: "Instagram",
    status: "connected",
    accountLabel: "Meta OAuth",
    lastHealthyAt: "2026-07-07T07:03:56.682Z",
    lastPublishedAt: "-"
  },
  {
    type: "threads",
    label: "Threads",
    status: "not_connected",
    accountLabel: "연결 전",
    lastHealthyAt: "-",
    lastPublishedAt: "-"
  },
  {
    type: "tiktok",
    label: "TikTok",
    status: "not_connected",
    accountLabel: "연결 전",
    lastHealthyAt: "-",
    lastPublishedAt: "-"
  },
  {
    type: "youtube",
    label: "YouTube",
    status: "not_connected",
    accountLabel: "연결 전",
    lastHealthyAt: "-",
    lastPublishedAt: "-"
  },
  {
    type: "x",
    label: "X",
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
  it("shows channel connection status from the API without the request tab", async () => {
    const api = await renderChannelsPage();

    expect(screen.getByRole("heading", { name: "채널 연결" })).toBeInTheDocument();
    expect(await screen.findByText("Meta OAuth")).toBeVisible();
    expect(screen.getByRole("heading", { name: "TikTok" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "YouTube" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "X" })).toBeVisible();
    expect(screen.getAllByText("연결 전")).toHaveLength(4);
    expect(screen.getByText("4개 미연결")).toBeVisible();
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
