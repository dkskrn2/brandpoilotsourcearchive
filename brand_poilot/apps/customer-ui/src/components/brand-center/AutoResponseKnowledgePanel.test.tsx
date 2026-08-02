import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutoResponseKnowledgePanel } from "./AutoResponseKnowledgePanel";

afterEach(cleanup);

describe("AutoResponseKnowledgePanel", () => {
  it("shows local-only sources and an explicit LLM information build action", async () => {
    const user = userEvent.setup();
    const gateway = { listWikiItems: vi.fn(async () => []) };
    render(
      <MemoryRouter>
        <AutoResponseKnowledgePanel brandId="brand-1" core={null} gateway={gateway} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "LLM 답변 정보" })).toBeVisible();
    expect(screen.getByLabelText("참고 URL")).toBeVisible();
    expect(screen.getByRole("button", { name: "문서 추가" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "LLM 답변 정보 생성" }));
    expect(screen.getByText("화면 미리보기입니다. 실제 정보 생성은 실행되지 않습니다.")).toBeVisible();
    expect(gateway.listWikiItems).toHaveBeenCalledWith("brand-1");
  });
});
