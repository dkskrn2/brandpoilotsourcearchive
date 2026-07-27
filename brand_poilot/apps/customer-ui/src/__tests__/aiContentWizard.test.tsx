import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiContentWizardPage } from "../pages/AiContentWizardPage";
import { createMockAiContentGateway } from "../features/ai-content/mockAiContentGateway";
import type { AiContentGateway } from "../features/ai-content/types";
import { ApiRequestError } from "../lib/apiClient";

afterEach(cleanup);

function ReturnLocation() {
  const location = useLocation();
  return <p>제품 보관함 복귀 {location.search}</p>;
}

function renderWizard(path = "/ai-content/new?type=card_news", gateway: AiContentGateway = createMockAiContentGateway()) {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/ai-content/new" element={<AiContentWizardPage gateway={gateway} brandId="brand-demo" />} /><Route path="/ai-content/:generationId" element={<p>생성 상세 화면</p>} /><Route path="/brand-center" element={<ReturnLocation />} /></Routes></MemoryRouter>);
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
    expect(vi.mocked(gateway.createAnalysis).mock.calls[0][1].draft.subjectAttachments).toEqual([]);
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
    expect(screen.getAllByRole("heading", { name: "참고할 콘텐츠를 선택하세요" })).toHaveLength(1);
  });

  it("awaits server removal when revisiting a confirmed subject attachment", async () => {
    const user = userEvent.setup();
    const gateway = createMockAiContentGateway();
    let finishRemoval: (() => void) | undefined;
    const removeAttachment = vi.spyOn(gateway, "removeAttachment").mockImplementation(async () => new Promise<void>((resolve) => {
      finishRemoval = resolve;
    }));
    renderWizard("/ai-content/new?type=card_news", gateway);
    await user.click(screen.getByRole("button", { name: "다음" }));
    await user.click(screen.getByRole("radio", { name: "제품" }));
    await user.upload(screen.getByLabelText("제품 이미지"), new File(["image"], "product.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: "분석하고 소구점 만들기" }));
    expect(await screen.findByText("3 / 5")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "이전" }));

    await user.click(screen.getByRole("button", { name: "product.png 삭제" }));
    expect(removeAttachment).toHaveBeenCalledWith("brand-demo", expect.any(String), expect.any(String));
    expect(screen.getByText("product.png")).toBeVisible();

    finishRemoval?.();
    await waitFor(() => expect(screen.queryByText("product.png")).not.toBeInTheDocument());
  });

  it("preserves a confirmed subject attachment when revisited server removal fails", async () => {
    const user = userEvent.setup();
    const gateway = createMockAiContentGateway();
    const removeAttachment = vi.spyOn(gateway, "removeAttachment").mockRejectedValueOnce(new Error("network_failed"));
    renderWizard("/ai-content/new?type=card_news", gateway);
    await user.click(screen.getByRole("button", { name: "다음" }));
    await user.click(screen.getByRole("radio", { name: "제품" }));
    await user.upload(screen.getByLabelText("제품 이미지"), new File(["image"], "product.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: "분석하고 소구점 만들기" }));
    expect(await screen.findByText("3 / 5")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "이전" }));

    await user.click(screen.getByRole("button", { name: "product.png 삭제" }));

    expect(removeAttachment).toHaveBeenCalledWith("brand-demo", expect.any(String), expect.any(String));
    expect(await screen.findByRole("alert")).toHaveTextContent("product.png 파일을 삭제하지 못했습니다. 다시 시도해 주세요.");
    expect(screen.getByText("product.png")).toBeVisible();
  });

  it("returns a completed real analysis to the product library without exposing its ID to the user", async () => {
    const user = userEvent.setup();
    renderWizard("/ai-content/new?type=card_news&returnTo=product-library");

    await user.click(screen.getByRole("button", { name: "다음" }));
    await user.click(screen.getByRole("radio", { name: "제품" }));
    await user.type(screen.getByLabelText("제품·서비스 URL (선택)"), "https://example.com/product");
    await user.click(screen.getByRole("button", { name: "분석하고 소구점 만들기" }));

    expect(await screen.findByText(/제품 보관함 복귀/)).toHaveTextContent(
      "?tab=products&analysis=00000000-0000-4000-8000-000000000401",
    );
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

  it("locks prompt attachment controls while generation preparation is pending and restores them after failure", async () => {
    const user = userEvent.setup();
    const gateway = createMockAiContentGateway();
    let rejectGetGeneration: ((reason?: unknown) => void) | undefined;
    vi.spyOn(gateway, "getGeneration").mockImplementation(async () => new Promise<never>((_resolve, reject) => {
      rejectGetGeneration = reject;
    }));
    const uploadAttachment = vi.spyOn(gateway, "uploadAttachment");
    const removeAttachment = vi.spyOn(gateway, "removeAttachment");
    renderWizard("/ai-content/new?type=marketing", gateway);
    await completeAnalysis(user);
    await user.click(screen.getByRole("radio", { name: /시간이 부족한/ }));
    await user.click(screen.getByRole("radio", { name: /1-1 타깃에 맞는 소구점/ }));
    await user.click(screen.getByRole("button", { name: "다음" }));
    await user.click(screen.getByRole("button", { name: "다음" }));
    await user.selectOptions(screen.getByLabelText("콘텐츠 목적"), "sales");
    await user.upload(screen.getByLabelText("인물 이미지"), new File(["person"], "person.png", { type: "image/png" }));
    await waitFor(() => expect(screen.getByText(/업로드 완료/)).toBeVisible());

    await user.click(screen.getByRole("button", { name: "생성 시작" }));
    expect(screen.getByLabelText("인물 이미지")).toBeDisabled();
    expect(screen.getByRole("button", { name: "person.png 삭제" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("인물 이미지"), {
      target: { files: [new File(["new"], "new-person.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "person.png 삭제" }));
    expect(uploadAttachment).toHaveBeenCalledTimes(1);
    expect(removeAttachment).not.toHaveBeenCalled();

    rejectGetGeneration?.(new Error("get_generation_failed"));
    expect(await screen.findByRole("alert")).toHaveTextContent("콘텐츠 생성을 시작하지 못했습니다.");
    expect(screen.getByLabelText("인물 이미지")).toBeEnabled();
    expect(screen.getByRole("button", { name: "person.png 삭제" })).toBeEnabled();
  });

  it("keeps additional generation attachments at a total of five", async () => {
    const user = userEvent.setup();
    const gateway = createMockAiContentGateway();
    const uploadAttachment = vi.spyOn(gateway, "uploadAttachment");
    renderWizard("/ai-content/new?type=marketing", gateway);
    await completeAnalysis(user);
    await user.click(screen.getByRole("radio", { name: /시간이 부족한/ }));
    await user.click(screen.getByRole("radio", { name: /1-1 타깃에 맞는 소구점/ }));
    await user.click(screen.getByRole("button", { name: "다음" }));
    await user.click(screen.getByRole("button", { name: "다음" }));

    const personInput = screen.getByLabelText("인물 이미지");
    for (let index = 1; index <= 6; index += 1) {
      await user.upload(personInput, new File([`person-${index}`], `person-${index}.png`, { type: "image/png" }));
    }

    expect(await screen.findByRole("alert")).toHaveTextContent("첨부 파일은 최대 5개입니다.");
    expect(uploadAttachment).toHaveBeenCalledTimes(5);
    expect(screen.getAllByText(/^person-\d\.png$/)).toHaveLength(5);
  });

  it("keeps subject attachments at a total of five across product and document roles", async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.click(screen.getByRole("button", { name: "다음" }));
    await user.click(screen.getByRole("radio", { name: "제품" }));

    const productInput = screen.getByLabelText("제품 이미지");
    const documentInput = screen.getByLabelText("문서");
    for (let index = 1; index <= 3; index += 1) {
      await user.upload(productInput, new File([`product-${index}`], `product-${index}.png`, { type: "image/png" }));
      await user.upload(documentInput, new File([`document-${index}`], `document-${index}.md`, { type: "text/markdown" }));
    }

    expect(await screen.findByRole("alert")).toHaveTextContent("첨부 파일은 최대 5개입니다.");
    expect(screen.getAllByText(/^(product|document)-\d\.(png|md)$/)).toHaveLength(5);
  });

  it("shares the five-attachment budget between subject and generation attachments", async () => {
    const user = userEvent.setup();
    const gateway = createMockAiContentGateway();
    const uploadAttachment = vi.spyOn(gateway, "uploadAttachment");
    renderWizard("/ai-content/new?type=marketing", gateway);
    await user.click(screen.getByRole("button", { name: "다음" }));
    await user.click(screen.getByRole("radio", { name: "제품" }));
    await user.upload(screen.getByLabelText("제품 이미지"), new File(["product"], "product.png", { type: "image/png" }));
    await user.upload(screen.getByLabelText("문서"), new File(["document"], "document.md", { type: "text/markdown" }));
    await user.click(screen.getByRole("button", { name: "분석하고 소구점 만들기" }));
    expect(await screen.findByText("3 / 5")).toBeVisible();
    await user.click(screen.getByRole("radio", { name: /시간이 부족한/ }));
    await user.click(screen.getByRole("radio", { name: /1-1 타깃에 맞는 소구점/ }));
    await user.click(screen.getByRole("button", { name: "다음" }));
    await user.click(screen.getByRole("button", { name: "다음" }));

    const personInput = screen.getByLabelText("인물 이미지");
    for (let index = 1; index <= 4; index += 1) {
      await user.upload(personInput, new File([`person-${index}`], `person-${index}.png`, { type: "image/png" }));
    }

    expect(await screen.findByRole("alert")).toHaveTextContent("첨부 파일은 최대 5개입니다.");
    expect(uploadAttachment).toHaveBeenCalledTimes(5);
  });

  it("keeps a failed final-step file local and disables generation until retry succeeds", async () => {
    const user = userEvent.setup();
    const gateway = createMockAiContentGateway();
    vi.spyOn(gateway, "uploadAttachment").mockRejectedValue(
      new ApiRequestError({ status: 503, errorCode: "ai_content_attachment_storage_unavailable" }),
    );
    renderWizard("/ai-content/new?type=marketing", gateway);
    await completeAnalysis(user);
    await user.click(screen.getByRole("radio", { name: /시간이 부족한/ }));
    await user.click(screen.getByRole("radio", { name: /1-1 타깃에 맞는 소구점/ }));
    await user.click(screen.getByRole("button", { name: "다음" }));
    await user.click(screen.getByRole("button", { name: "다음" }));
    await user.selectOptions(screen.getByLabelText("콘텐츠 목적"), "sales");

    await user.upload(
      screen.getByLabelText("인물 이미지"),
      new File(["person"], "failed-person.png", { type: "image/png" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("현재 파일은 유지됩니다. 다시 시도해 주세요.");
    expect(screen.getByRole("button", { name: "failed-person.png 다시 업로드" })).toBeVisible();
    expect(screen.getByRole("button", { name: "생성 시작" })).toBeDisabled();
  });

  it("marks a failed subject upload for an explicit fresh-session retry before analysis", async () => {
    const user = userEvent.setup();
    const gateway = createMockAiContentGateway();
    const uploadAttachment = vi.spyOn(gateway, "uploadAttachment")
      .mockRejectedValueOnce(new ApiRequestError({ status: 503, errorCode: "ai_content_attachment_storage_unavailable" }))
      .mockImplementationOnce(async (_brandId, _generationId, attachment) => ({
        ...attachment,
        id: "server-product",
        file: undefined,
        storageUrl: "https://blob.example/product.png",
        storagePath: "fresh-session/product.png",
        uploadStatus: "confirmed",
      }));
    const requestAnalysis = vi.spyOn(gateway, "requestSubjectAnalysis");
    renderWizard("/ai-content/new?type=card_news", gateway);
    await user.click(screen.getByRole("button", { name: "다음" }));
    await user.click(screen.getByRole("radio", { name: "제품" }));
    await user.upload(screen.getByLabelText("제품 이미지"), new File(["image"], "product.png", { type: "image/png" }));

    await user.click(screen.getByRole("button", { name: "분석하고 소구점 만들기" }));

    expect(await screen.findByRole("button", { name: "product.png 다시 업로드" })).toBeVisible();
    expect(screen.getByRole("button", { name: "분석하고 소구점 만들기" })).toBeDisabled();
    expect(requestAnalysis).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "product.png 다시 업로드" }));
    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "분석하고 소구점 만들기" })).toBeEnabled();
  });
});
