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
  await user.type(
    screen.getByRole("textbox", { name: "브랜드 웹사이트 URL" }),
    "https://brand.example",
  );
  await user.click(screen.getByRole("button", { name: "AI 분석 시작" }));
  await screen.findByRole("button", { name: "자주 묻는 질문" });
  return user;
}

describe("Brand Center three-status preview", () => {
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

  it("shows phased analysis feedback and one-open-at-a-time knowledge accordions", async () => {
    let finishAnalysis!: () => void;
    const adapter = createAdapter(() => new Promise<"succeeded">((resolve) => {
      finishAnalysis = () => resolve("succeeded");
    }));
    const user = userEvent.setup();
    render(<BrandCenterPreviewPage adapter={adapter} />);
    await user.type(
      screen.getByRole("textbox", { name: "브랜드 웹사이트 URL" }),
      "https://brand.example",
    );
    await user.click(screen.getByRole("button", { name: "AI 분석 시작" }));
    expect(screen.getByText("자료를 읽는 중")).toBeInTheDocument();

    finishAnalysis();
    const faq = await screen.findByRole("button", { name: "자주 묻는 질문" });
    const usage = screen.getByRole("button", { name: "이용 방법" });
    expect(faq).toHaveAttribute("aria-expanded", "true");
    expect(usage).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "가이드" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "제품·서비스" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "정책" })).not.toBeInTheDocument();

    await user.click(usage);
    expect(usage).toHaveAttribute("aria-expanded", "true");
    expect(faq).toHaveAttribute("aria-expanded", "false");
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
