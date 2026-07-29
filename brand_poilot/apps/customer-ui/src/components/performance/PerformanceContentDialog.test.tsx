import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PerformanceInsights, PublishArtifact } from "../../types";
import { PerformanceContentDialog } from "./PerformanceContentDialog";

type Content = PerformanceInsights["topContents"][number];

const content: Content = {
  publishQueueId: "queue-1",
  title: "좋았던 콘텐츠",
  channel: "instagram",
  deliveryFormat: "instagram_feed_carousel",
  exposureCount: 600,
  snapshotId: "snapshot-1",
  externalUrl: "https://www.instagram.com/p/example/",
};

const artifact: PublishArtifact = {
  queueId: "queue-1",
  kind: "text",
  deliveryFormat: "instagram_feed_carousel",
  assets: [],
  posterUrl: null,
  html: null,
  text: "실제 콘텐츠",
};

describe("PerformanceContentDialog", () => {
  it("keeps focus inside, closes on Escape, and exposes the original content URL", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <PerformanceContentDialog
        content={content}
        loadArtifact={vi.fn(async () => artifact)}
        onClose={onClose}
      />,
    );

    expect(container.firstElementChild).toHaveClass("modal-backdrop");
    const close = screen.getByRole("button", { name: "닫기" });
    await waitFor(() => expect(close).toHaveFocus());
    const original = await screen.findByRole("link", { name: "원문 열기" });
    expect(original).toHaveAttribute("href", content.externalUrl);
    expect(original).toHaveAttribute("target", "_blank");

    original.focus();
    fireEvent.keyDown(original, { key: "Tab" });
    expect(close).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("offers a retry after loading fails and omits an unavailable original URL", async () => {
    const loadArtifact = vi.fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(artifact);
    render(
      <PerformanceContentDialog
        content={{ ...content, externalUrl: null }}
        loadArtifact={loadArtifact}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("콘텐츠를 불러오지 못했습니다.");
    expect(screen.queryByRole("link", { name: "원문 열기" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(await screen.findByText("실제 콘텐츠")).toBeVisible();
    expect(loadArtifact).toHaveBeenCalledTimes(2);
    expect(loadArtifact).toHaveBeenLastCalledWith("queue-1");
  });

  it("keeps a tall preview scrolling inside the constrained dialog body", async () => {
    const css = await readFile(
      resolve(process.cwd(), "src/styles/performance.css"),
      "utf8",
    );

    expect(css).toMatch(
      /\.performance-dialog\s*\{[^}]*display:\s*grid[^}]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/s,
    );
    expect(css).toMatch(
      /\.performance-dialog__body\s*\{[^}]*min-height:\s*0[^}]*overflow:\s*auto/s,
    );
  });
});
