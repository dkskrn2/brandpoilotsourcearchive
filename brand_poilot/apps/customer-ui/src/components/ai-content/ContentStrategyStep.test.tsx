import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ChannelCapability } from "../../types";
import { ContentStrategyStep } from "./ContentStrategyStep";

const capabilities: ChannelCapability[] = [
  {
    channel: "instagram",
    catalogStatus: "available",
    enabled: true,
    connectionStatus: "connected",
    canGenerate: true,
    generationFormats: ["card_news", "reel"],
    exportModes: ["image"],
    publishModes: ["instagram_feed_carousel", "instagram_reel"],
    readiness: "ready",
    reasonCode: null,
  },
  {
    channel: "threads",
    catalogStatus: "available",
    enabled: false,
    connectionStatus: "connected",
    canGenerate: true,
    generationFormats: ["card_news"],
    exportModes: ["text"],
    publishModes: [],
    readiness: "ready",
    reasonCode: null,
  },
  {
    channel: "x",
    catalogStatus: "planned",
    enabled: true,
    connectionStatus: "connected",
    canGenerate: true,
    generationFormats: ["card_news"],
    exportModes: ["text"],
    publishModes: [],
    readiness: "ready",
    reasonCode: null,
  },
];

const readyState = {
  status: "ready" as const,
  capabilities,
  policy: { retryAllowed: false, existingDraftMayBeSaved: true, generationStartAllowed: true },
};

describe("ContentStrategyStep", () => {
  it("shows an accessible proposal loading state", () => {
    render(<ContentStrategyStep
      outputFormat="card_news"
      channelTarget="instagram"
      loading
      capabilityState={readyState}
      onFormatChange={vi.fn()}
      onChannelChange={vi.fn()}
      onSubmit={vi.fn()}
    />);

    const submit = screen.getByRole("button", { name: /구성안을 만드는 중/ });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("img", { name: "구성안 생성 중" })).toBeVisible();
  });

  it("shows the three canonical formats and only exact eligible remote channel logos", () => {
    render(<ContentStrategyStep
      outputFormat="card_news"
      channelTarget={null}
      loading={false}
      capabilityState={readyState}
      onFormatChange={vi.fn()}
      onChannelChange={vi.fn()}
      onSubmit={vi.fn()}
    />);

    expect(screen.getByRole("radio", { name: "카드뉴스" })).toBeVisible();
    expect(screen.getByRole("radio", { name: "블로그" })).toBeVisible();
    expect(screen.getByRole("radio", { name: "릴스" })).toBeVisible();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Instagram" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Threads" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "X" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Instagram" }).querySelector("img")).toHaveAttribute("aria-hidden", "true");
  });

  it("uses one pressed target and clears it when a format becomes incompatible", async () => {
    const user = userEvent.setup();
    const onFormatChange = vi.fn();
    const onChannelChange = vi.fn();
    render(<ContentStrategyStep
      outputFormat="card_news"
      channelTarget="instagram"
      loading={false}
      capabilityState={readyState}
      onFormatChange={onFormatChange}
      onChannelChange={onChannelChange}
      onSubmit={vi.fn()}
    />);

    expect(screen.getByRole("button", { name: "Instagram" })).toBePressed();
    await user.click(screen.getByRole("radio", { name: "블로그" }));
    expect(onFormatChange).toHaveBeenCalledWith("blog");
    expect(onChannelChange).toHaveBeenCalledWith(null);
  });

  it("offers blog_export as a local file target and blocks generation with guidance when no target exists", () => {
    const { rerender } = render(<ContentStrategyStep
      outputFormat="blog"
      channelTarget={null}
      loading={false}
      capabilityState={readyState}
      onFormatChange={vi.fn()}
      onChannelChange={vi.fn()}
      onSubmit={vi.fn()}
    />);

    expect(screen.getByRole("button", { name: "블로그 파일 내보내기" })).toBeVisible();
    expect(screen.getByRole("button", { name: "AI 구성안 만들기" })).toBeDisabled();

    rerender(<ContentStrategyStep
      outputFormat="card_news"
      channelTarget={null}
      loading={false}
      capabilityState={{ ...readyState, capabilities: [] }}
      onFormatChange={vi.fn()}
      onChannelChange={vi.fn()}
      onSubmit={vi.fn()}
    />);
    expect(screen.getByText(/채널을 연결하고 활성화/)).toBeVisible();
    expect(screen.getByRole("button", { name: "AI 구성안 만들기" })).toBeDisabled();
  });

  it("clears a selected target when refreshed capabilities no longer support it", async () => {
    const onChannelChange = vi.fn();
    const { rerender } = render(<ContentStrategyStep
      outputFormat="card_news"
      channelTarget="instagram"
      loading={false}
      capabilityState={readyState}
      onFormatChange={vi.fn()}
      onChannelChange={onChannelChange}
      onSubmit={vi.fn()}
    />);

    rerender(<ContentStrategyStep
      outputFormat="card_news"
      channelTarget="instagram"
      loading={false}
      capabilityState={{
        status: "failure",
        capabilities: [],
        error: new Error("capability failed"),
        policy: { retryAllowed: true, existingDraftMayBeSaved: true, generationStartAllowed: false },
      }}
      onFormatChange={vi.fn()}
      onChannelChange={onChannelChange}
      onSubmit={vi.fn()}
    />);

    await waitFor(() => expect(onChannelChange).toHaveBeenCalledWith(null));
    expect(screen.getByRole("button", { name: "AI 구성안 만들기" })).toBeDisabled();
  });

  it("keeps a local blog target available while remote capabilities load or fail", () => {
    const { rerender } = render(<ContentStrategyStep
      outputFormat="blog"
      channelTarget="blog_export"
      loading={false}
      capabilityState={{
        status: "loading",
        capabilities: [],
        policy: { retryAllowed: false, existingDraftMayBeSaved: true, generationStartAllowed: false },
      }}
      onFormatChange={vi.fn()}
      onChannelChange={vi.fn()}
      onSubmit={vi.fn()}
    />);

    expect(screen.getByRole("button", { name: "AI 구성안 만들기" })).toBeEnabled();

    rerender(<ContentStrategyStep
      outputFormat="blog"
      channelTarget="blog_export"
      loading={false}
      capabilityState={{
        status: "failure",
        capabilities: [],
        error: new Error("remote capability failed"),
        policy: { retryAllowed: true, existingDraftMayBeSaved: true, generationStartAllowed: false },
      }}
      onFormatChange={vi.fn()}
      onChannelChange={vi.fn()}
      onSubmit={vi.fn()}
    />);

    expect(screen.getByRole("button", { name: "블로그 파일 내보내기" })).toBePressed();
    expect(screen.getByRole("button", { name: "AI 구성안 만들기" })).toBeEnabled();
  });
});
