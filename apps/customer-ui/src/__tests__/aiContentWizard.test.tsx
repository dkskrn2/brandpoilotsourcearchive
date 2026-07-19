import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
  await user.type(screen.getByLabelText("제품·서비스 URL"), "https://example.com/product");
  await user.click(screen.getByRole("button", { name: "분석 시작" }));
  expect(await screen.findByText("고객·시장 분석을 완료했습니다.")).toBeVisible();
}

describe("AiContentWizardPage", () => {
  it("does not analyze when the page is opened", async () => {
    const gateway = createMockAiContentGateway();
    const request = vi.spyOn(gateway, "requestSubjectAnalysis");
    renderWizard("/ai-content/new?type=card_news", gateway);
    expect(screen.getByText("1 / 5")).toBeVisible();
    expect(request).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "다음" }));
    expect(request).not.toHaveBeenCalled();
  });

  it("analyzes explicitly, shows the cached result, and supports target and one appeal", async () => {
    const user = userEvent.setup();
    const gateway = createMockAiContentGateway();
    renderWizard("/ai-content/new?type=card_news", gateway);
    await completeAnalysis(user);
    await user.click(screen.getByRole("button", { name: "다음" }));
    expect(screen.getAllByRole("radio").filter((item) => item.getAttribute("name") === "subject-target")).toHaveLength(3);
    await user.click(screen.getByRole("radio", { name: /시간이 부족한/ }));
    await user.click(screen.getByRole("radio", { name: /1-1 타깃에 맞는 소구점/ }));
    expect(screen.getByText("1개만 선택")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "다음" }));
    expect(screen.getByText("참고할 콘텐츠를 선택하세요")).toBeVisible();
  });

  it("finishes generation from step five and keeps image roles selectable", async () => {
    const user = userEvent.setup();
    renderWizard("/ai-content/new?type=marketing");
    await completeAnalysis(user);
    await user.click(screen.getByRole("button", { name: "다음" }));
    await user.click(screen.getByRole("radio", { name: /시간이 부족한/ }));
    await user.click(screen.getByRole("radio", { name: /1-1 타깃에 맞는 소구점/ }));
    await user.click(screen.getByRole("button", { name: "다음" }));
    await user.click(screen.getByRole("button", { name: "다음" }));
    expect(screen.getByText("5 / 5")).toBeVisible();
    await user.selectOptions(screen.getByLabelText("콘텐츠 목적"), "sales");
    await user.selectOptions(screen.getByLabelText("생성 결과 수"), "3");
    expect(screen.getAllByRole("textbox", { name: /결과 \d 지시/ })).toHaveLength(3);
    const image = new File(["image"], "product.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("제품 이미지"), image);
    expect(screen.getByText("product.png")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "생성 시작" }));
    await waitFor(() => expect(screen.getByText("생성 상세 화면")).toBeVisible());
  });
});
