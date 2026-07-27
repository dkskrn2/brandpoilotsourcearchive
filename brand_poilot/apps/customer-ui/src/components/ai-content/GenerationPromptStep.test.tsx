import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GenerationPromptStep } from "./GenerationPromptStep";
import { createMockAiContentGateway } from "../../features/ai-content/mockAiContentGateway";
import { createInitialAiContentDraft } from "../../features/ai-content/useAiContentDraft";
import { ApiRequestError } from "../../lib/apiClient";

afterEach(cleanup);

describe("GenerationPromptStep", () => {
  it("preserves current prompt and upload state when a delayed brand color arrives", async () => {
    let resolveBrandContext: ((value: Awaited<ReturnType<ReturnType<typeof createMockAiContentGateway>["getBrandContext"]>>) => void) | undefined;
    let resolveUpload: ((value: Parameters<ReturnType<typeof createMockAiContentGateway>["uploadAttachment"]>[2]) => void) | undefined;
    const gateway = createMockAiContentGateway();
    vi.spyOn(gateway, "getBrandContext").mockImplementation(async () => new Promise((resolve) => {
      resolveBrandContext = resolve;
    }));
    vi.spyOn(gateway, "uploadAttachment").mockImplementation(async (_brandId, _generationId, attachment) => new Promise((resolve) => {
      resolveUpload = resolve;
    }));
    function Harness() {
      const [draft, setDraft] = useState(createInitialAiContentDraft("marketing"));
      return <GenerationPromptStep
        brandId="brand-demo"
        gateway={gateway}
        draft={draft}
        onBrief={(update) => setDraft((current) => ({
          ...current,
          brief: typeof update === "function" ? update(current.brief!) : update,
        }))}
        generationId="generation-1"
      />;
    }
    render(<Harness />);

    await userEvent.type(screen.getByLabelText("전체 프롬프트"), "최신 프롬프트");
    await userEvent.upload(screen.getByLabelText("제품 이미지"), new File(["image"], "current.png", { type: "image/png" }));
    await waitFor(() => expect(gateway.uploadAttachment).toHaveBeenCalledOnce());

    await act(async () => {
      resolveBrandContext?.({
        ready: true, brandName: "브랜드", ownedUrl: null, sourceStatus: null, lastCrawledAt: null,
        wikiVersionId: null, wikiUpdatedAt: null, summary: null, pageCount: 0, brandColor: "#123456",
      });
      resolveUpload?.({
        id: "server-current", role: "product", fileName: "current.png", mimeType: "image/png",
        size: 5, storagePath: "stored/current.png", storageUrl: "https://blob/current.png",
      });
    });

    expect(screen.getByLabelText("전체 프롬프트")).toHaveValue("최신 프롬프트");
    expect(screen.getByLabelText("브랜드 대표 색상")).toHaveValue("#123456");
    expect(await screen.findByText("current.png")).toBeVisible();
    expect(screen.getByText(/업로드 완료/)).toBeVisible();
  });

  it("uses the brand color by default and applies the first prompt to every output", async () => {
    const user = userEvent.setup();
    const onBrief = vi.fn();
    const gateway = createMockAiContentGateway();
    function Harness() {
      const [draft, setDraft] = useState(createInitialAiContentDraft("marketing"));
      return <GenerationPromptStep
        brandId="brand-demo"
        gateway={gateway}
        draft={draft}
        onBrief={(update) => setDraft((current) => {
          const brief = typeof update === "function" ? update(current.brief!) : update;
          onBrief(brief);
          return { ...current, brief };
        })}
        generationId={null}
      />;
    }
    render(<Harness />);
    await user.selectOptions(screen.getByLabelText("생성 결과 수"), "3");
    const directions = screen.getAllByRole("textbox", { name: /결과 \d 지시/ });
    await user.type(directions[0], "문제 상황을 먼저 보여 주세요");
    await user.click(screen.getByRole("button", { name: "첫 지시 전체 적용" }));
    expect(onBrief).toHaveBeenLastCalledWith(expect.objectContaining({ outputDirections: ["문제 상황을 먼저 보여 주세요", "문제 상황을 먼저 보여 주세요", "문제 상황을 먼저 보여 주세요"] }));
    expect(screen.getByLabelText("브랜드 대표 색상")).toHaveValue("#0057b8");
    expect(screen.getByRole("option", { name: "16:9" })).toBeInTheDocument();
    expect(screen.queryByText("문서")).not.toBeInTheDocument();
  });

  it("renders locked guidance and retains a failed prompt attachment for retry", async () => {
    const gateway = createMockAiContentGateway();
    vi.spyOn(gateway, "uploadAttachment").mockRejectedValue(
      new ApiRequestError({ status: 409, errorCode: "ai_content_attachments_locked" }),
    );
    function Harness() {
      const [draft, setDraft] = useState(createInitialAiContentDraft("marketing"));
      return <GenerationPromptStep
        brandId="brand-demo"
        gateway={gateway}
        draft={draft}
        onBrief={(update) => setDraft((current) => ({
          ...current,
          brief: typeof update === "function" ? update(current.brief!) : update,
        }))}
        generationId="generation-1"
      />;
    }
    render(<Harness />);

    await userEvent.upload(
      screen.getByLabelText("제품 이미지"),
      new File(["image"], "locked.png", { type: "image/png" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("첨부가 잠겼습니다. 새 콘텐츠 생성을 시작해 주세요.");
    expect(screen.getByText("locked.png")).toBeVisible();
    expect(screen.queryByRole("button", { name: "locked.png 다시 업로드" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "새 콘텐츠 생성" })).toHaveAttribute("href", "/ai-content/new");
  });
});
