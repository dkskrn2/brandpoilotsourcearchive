import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiContentWizardPage } from "../pages/AiContentWizardPage";
import { createMockAiContentGateway } from "../features/ai-content/mockAiContentGateway";
import type { AiContentGateway } from "../features/ai-content/types";

afterEach(cleanup);

function renderWizard(path = "/ai-content/new?type=card_news", gateway: AiContentGateway = createMockAiContentGateway()) {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/ai-content/new" element={<AiContentWizardPage gateway={gateway} brandId="brand-demo" />} /><Route path="/ai-content/:generationId" element={<p>생성 상세 화면</p>} /></Routes></MemoryRouter>);
}

async function completeAnalysis(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "다음" }));
  await user.click(screen.getByRole("radio", { name: "제품" }));
  await user.type(screen.getByLabelText("제품·서비스 URL (선택)"), "https://example.com/product");
  await user.click(screen.getByRole("button", { name: "분석하고 소구점 만들기" }));
  expect(await screen.findByText("3 / 5")).toBeVisible();
}

describe("AiContentWizardPage", () => {
  it("orders target and appeal, references, then prompt and generation", () => {
    renderWizard();

    const steps = within(screen.getByRole("list", { name: "생성 단계" })).getAllByRole("listitem");
    expect(steps.slice(2).map((step) => step.textContent)).toEqual([
      "3타깃·소구점",
      "4레퍼런스",
      "5프롬프트·생성",
    ]);
  });

  it("does not analyze when the page is opened", async () => {
    const gateway = createMockAiContentGateway();
    const request = vi.spyOn(gateway, "requestSubjectAnalysis");
    renderWizard("/ai-content/new?type=card_news", gateway);
    expect(screen.getByText("1 / 5")).toBeVisible();
    expect(request).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "다음" }));
    expect(request).not.toHaveBeenCalled();
  });

  it("creates, uploads, patches, requests v2, polls, and automatically opens target selection", async () => {
    const user = userEvent.setup();
    const gateway = createMockAiContentGateway();
    const calls: string[] = [];
    vi.spyOn(gateway, "createAnalysis").mockImplementation(async (...args) => {
      calls.push("create");
      return createMockAiContentGateway().createAnalysis(...args);
    });
    vi.spyOn(gateway, "uploadAttachment").mockImplementation(async (_brandId, _generationId, attachment) => {
      calls.push(`upload:${attachment.role}`);
      return { ...attachment, id: `server-${attachment.role}`, file: undefined, storageUrl: `https://blob.example/${attachment.fileName}`, storagePath: attachment.fileName };
    });
    const update = vi.spyOn(gateway, "updateGeneration").mockImplementation(async (...args) => {
      calls.push("patch");
      return createMockAiContentGateway().createAnalysis("brand-demo", { type: "card_news", title: "patched", draft: args[2].draft, idempotencyKey: "patched" });
    });
    const request = vi.spyOn(gateway, "requestSubjectAnalysis").mockImplementation(async (...args) => {
      calls.push("request");
      return createMockAiContentGateway().requestSubjectAnalysis(...args);
    });
    renderWizard("/ai-content/new?type=card_news", gateway);
    await user.click(screen.getByRole("button", { name: "다음" }));
    expect(screen.queryByRole("button", { name: "다음" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "제품" }));
    await user.type(screen.getByLabelText("제품·서비스 URL (선택)"), "https://example.com/product");
    await user.upload(screen.getByLabelText("제품 이미지"), new File(["image"], "product.png", { type: "image/png" }));
    await user.upload(screen.getByLabelText("문서"), new File(["doc"], "brief.md", { type: "text/markdown" }));
    await user.click(screen.getByRole("button", { name: "분석하고 소구점 만들기" }));

    expect(await screen.findByText("3 / 5")).toBeVisible();
    expect(calls).toEqual(["create", "upload:product", "upload:document", "patch", "request"]);
    expect(update).toHaveBeenCalledWith("brand-demo", expect.any(String), expect.objectContaining({
      draft: expect.objectContaining({ subjectAttachments: [expect.objectContaining({ id: "server-product" }), expect.objectContaining({ id: "server-document" })] }),
    }));
    expect(request).toHaveBeenCalledWith("brand-demo", expect.objectContaining({
      generationId: expect.any(String),
      attachmentIds: ["server-product", "server-document"],
      manualInput: { name: "", promotionOrTerms: "", description: "" },
    }));
    expect(screen.getAllByRole("radio").filter((item) => item.getAttribute("name") === "subject-target")).toHaveLength(3);
    await user.click(screen.getByRole("radio", { name: /시간이 부족한/ }));
    await user.click(screen.getByRole("radio", { name: /1-1 타깃에 맞는 소구점/ }));
    expect(screen.getByText("1개만 선택")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "다음" }));
    expect(screen.getByText("참고할 콘텐츠를 선택하세요")).toBeVisible();
  });

  it("passes two ordered references, one appeal, color, attachments, and two outputs to generation", async () => {
    const user = userEvent.setup();
    const gateway = createMockAiContentGateway();
    const createAnalysis = vi.spyOn(gateway, "createAnalysis");
    const updateGeneration = vi.spyOn(gateway, "updateGeneration");
    const startGeneration = vi.spyOn(gateway, "startGeneration");
    renderWizard("/ai-content/new?type=marketing", gateway);
    await completeAnalysis(user);
    await user.click(screen.getByRole("radio", { name: /시간이 부족한/ }));
    await user.click(screen.getByRole("radio", { name: /1-1 타깃에 맞는 소구점/ }));
    await user.click(screen.getByRole("button", { name: "다음" }));
    await user.click(screen.getByRole("button", { name: "레퍼런스 선택: 고객이 저장한 체크리스트 카드뉴스" }));
    await user.click(screen.getByRole("button", { name: "레퍼런스 선택: 콘텐츠 운영 자동화 실무 가이드" }));
    const moveBackButtons = screen.getAllByRole("button", { name: "앞으로 이동" });
    await user.click(moveBackButtons[1]);
    await user.click(screen.getByRole("button", { name: "다음" }));
    expect(screen.getByText("5 / 5")).toBeVisible();
    await user.selectOptions(screen.getByLabelText("콘텐츠 목적"), "sales");
    await user.selectOptions(screen.getByLabelText("생성 결과 수"), "2");
    expect(screen.getAllByRole("textbox", { name: /결과 \d 지시/ })).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("브랜드 대표 색상"), { target: { value: "#123456" } });
    const person = new File(["person"], "person.png", { type: "image/png" });
    const scale = new File(["scale"], "scale.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("인물 이미지"), person);
    await user.upload(screen.getByLabelText("크기·비율 참고 이미지"), scale);
    expect(screen.getByText("person.png")).toBeVisible();
    expect(screen.getByText("scale.png")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "생성 시작" }));
    await waitFor(() => expect(screen.getByText("생성 상세 화면")).toBeVisible());
    expect(updateGeneration).toHaveBeenCalledWith("brand-demo", expect.any(String), expect.objectContaining({
      referenceIds: ["reference-owned-blog", "reference-owned-card"],
      draft: expect.objectContaining({
        selectedAppeal: expect.objectContaining({ id: "target-1-appeal-1" }),
        brief: expect.objectContaining({ selectedColor: "#123456", outputCount: 2 }),
      }),
    }));
    expect(startGeneration).toHaveBeenCalledWith("brand-demo", expect.any(String), expect.objectContaining({ outputCount: 2 }));
    expect(createAnalysis).toHaveBeenCalledTimes(1);
  });
});
