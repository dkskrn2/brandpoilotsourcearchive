import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PreviewAdapter } from "../features/brand-center-preview/previewAdapter";
import { BrandCenterPreviewPage } from "../pages/BrandCenterPreviewPage";

function createAdapter(
  analyze: PreviewAdapter["analyze"] = vi.fn().mockResolvedValue("succeeded"),
  generateCardNews: PreviewAdapter["generateCardNews"] =
    vi.fn().mockResolvedValue("succeeded"),
): PreviewAdapter {
  return { analyze, generateCardNews };
}

async function enterAnalysis(adapter = createAdapter()) {
  const user = userEvent.setup();
  render(<BrandCenterPreviewPage adapter={adapter} />);
  await user.type(screen.getByRole("textbox", { name: "회사명" }), "테스트 회사");
  await user.type(
    screen.getByRole("textbox", { name: "브랜드 웹사이트 URL" }),
    "https://brand.example",
  );
  await user.click(screen.getByRole("button", { name: "AI 분석 시작" }));
  await screen.findByRole("textbox", { name: "한 줄 정의" });
  return user;
}

describe("Brand Center three-status preview", () => {
  it("uses the production onboarding heading without preview branding", () => {
    render(<BrandCenterPreviewPage adapter={createAdapter()} />);

    expect(screen.getByRole("heading", {
      name: "URL 입력하면 AI가 내 서비스를 분석해줘요",
    })).toBeInTheDocument();
    expect(screen.queryByText("BRAND CENTER")).not.toBeInTheDocument();
    expect(screen.queryByText("브랜드 자료를 등록하면 AI가 핵심 정보를 정리합니다."))
      .not.toBeInTheDocument();
  });

  it("shows exactly three statuses and keeps completion locked before analysis", () => {
    render(<BrandCenterPreviewPage adapter={createAdapter()} />);

    const progress = screen.getByRole("navigation", {
      name: "브랜드 센터 진행 상태",
    });
    expect(within(progress).getAllByRole("button").map((button) => button.textContent))
      .toEqual(["자료 등록", "AI 분석·수정", "완료"]);
    expect(within(progress).queryByText("검토·승인")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "3. 완료" }))
      .toHaveAttribute("aria-disabled", "true");
  });

  it("accepts a dropped file with dragging feedback and still supports URL input", async () => {
    render(<BrandCenterPreviewPage adapter={createAdapter()} />);
    const dropzone = screen.getByRole("button", {
      name: "브랜드 자료 끌어다 놓기",
    });

    fireEvent.dragEnter(dropzone);
    expect(dropzone).toHaveAttribute("data-dragging", "true");
    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [new File(["brand"], "brand-guide.pdf", {
          type: "application/pdf",
        })],
      },
    });

    expect(dropzone).toHaveAttribute("data-dragging", "false");
    expect(screen.getByText("brand-guide.pdf")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "브랜드 웹사이트 URL" }))
      .toBeInTheDocument();
  });

  it("enforces the backend file contract before accepting documents", async () => {
    render(<BrandCenterPreviewPage adapter={createAdapter()} />);
    const input = screen.getByLabelText("브랜드 자료 파일 선택");
    const user = userEvent.setup({ applyAccept: false });

    await user.upload(input, new File(["bad"], "deck.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "TXT, MD, PDF, CSV, XLSX 파일만 첨부할 수 있습니다.",
    );

    await user.upload(input, Array.from({ length: 6 }, (_, index) =>
      new File(["ok"], `source-${index}.txt`, { type: "text/plain" })));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "문서는 최대 5개까지 첨부할 수 있습니다.",
    );

    await user.upload(input, new File(
      [new Uint8Array(10 * 1024 * 1024 + 1)],
      "oversized.pdf",
      { type: "application/pdf" },
    ));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "파일 하나의 크기는 10MB 이하여야 합니다.",
    );
  });

  it("shows phased analysis feedback and only editable Brand Core fields", async () => {
    let finishAnalysis!: () => void;
    const adapter = createAdapter(() => new Promise<"succeeded">((resolve) => {
      finishAnalysis = () => resolve("succeeded");
    }));
    const user = userEvent.setup();
    render(<BrandCenterPreviewPage adapter={adapter} />);
    await user.type(screen.getByRole("textbox", { name: "회사명" }), "테스트 회사");
    await user.type(
      screen.getByRole("textbox", { name: "브랜드 웹사이트 URL" }),
      "https://brand.example",
    );
    await user.click(screen.getByRole("button", { name: "AI 분석 시작" }));
    expect(screen.getByText("자료를 읽는 중")).toBeInTheDocument();
    expect(screen.getByText(
      "보통 수분~10분 정도 소요되며 자료에 따라 더 길어질 수 있습니다.",
    )).toBeInTheDocument();

    finishAnalysis();
    expect(await screen.findByRole("textbox", { name: "한 줄 정의" })).toBeInTheDocument();
    expect(screen.queryByText("AI 제안 정보")).not.toBeInTheDocument();
    expect(screen.queryByText(/Wiki/i)).not.toBeInTheDocument();
  });

  it("keeps the final loader phase visible while analysis remains unresolved", async () => {
    vi.useFakeTimers();
    const adapter = createAdapter(() => new Promise<"succeeded">(() => undefined));
    render(<BrandCenterPreviewPage adapter={adapter} />);
    fireEvent.change(screen.getByRole("textbox", { name: "회사명" }), {
      target: { value: "테스트 회사" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "브랜드 웹사이트 URL" }), {
      target: { value: "https://brand.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "AI 분석 시작" }));

    await vi.advanceTimersByTimeAsync(2_800);

    expect(screen.getByText("지식 초안을 만드는 중")).toBeInTheDocument();
    expect(screen.getByText("지식 초안을 만드는 중").closest("[aria-busy='true']"))
      .toBeInTheDocument();
    vi.useRealTimers();
  });

  it("starts saving and card generation automatically from the 완료 action", async () => {
    let finishGeneration!: () => void;
    const generateCardNews = vi.fn(() =>
      new Promise<"succeeded">((resolve) => {
        finishGeneration = () => resolve("succeeded");
      }));
    const user = await enterAnalysis(createAdapter(
      vi.fn().mockResolvedValue("succeeded"),
      generateCardNews,
    ));

    await user.click(screen.getByRole("button", { name: "완료" }));
    expect(generateCardNews).toHaveBeenCalledTimes(1);
    expect(screen.getByText("브랜드 정보를 저장하는 중")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "카드뉴스 생성" }))
      .not.toBeInTheDocument();

    finishGeneration();
    expect(await screen.findByRole("heading", {
      name: "브랜드 준비가 완료되었습니다",
    })).toBeInTheDocument();
    expect(screen.getAllByRole("article", { name: /카드 [1-4]/ })).toHaveLength(4);
  });

  it("retains edits after generation failure and supports retry", async () => {
    const generateCardNews = vi.fn()
      .mockRejectedValueOnce(new Error("failed"))
      .mockResolvedValueOnce("succeeded");
    const user = await enterAnalysis(createAdapter(
      vi.fn().mockResolvedValue("succeeded"),
      generateCardNews,
    ));
    const oneLine = screen.getByRole("textbox", { name: "한 줄 정의" });
    await user.clear(oneLine);
    await user.type(oneLine, "수정한 브랜드 정의");

    await user.click(screen.getByRole("button", { name: "완료" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "검토를 마친 Brand Core와 지식은 그대로 유지됩니다.",
    );
    await user.click(screen.getByRole("button", { name: "2. AI 분석·수정" }));
    expect(screen.getByRole("textbox", { name: "한 줄 정의" }))
      .toHaveValue("수정한 브랜드 정의");
    await user.click(screen.getByRole("button", { name: "완료" }));

    await waitFor(() => expect(generateCardNews).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("heading", {
      name: "브랜드 준비가 완료되었습니다",
    })).toBeInTheDocument();
  });
});
