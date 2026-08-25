import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PublishCalendarManualOptions, PublishItem } from "../../types";
import { PublishContentPickerDialog } from "./PublishContentPickerDialog";

const options: PublishCalendarManualOptions = {
  purposes: [{ value: "informational", label: "정보성" }, { value: "marketing", label: "마케팅" }],
  subjectModes: [{ value: "topic_text", label: "직접 입력", requiredField: "topicText" }, { value: "suggestion", label: "추천 선택", requiredField: "contentSuggestionId" }],
  channels: [{ value: "instagram", label: "Instagram", formats: [{ value: "card_news", label: "카드뉴스" }, { value: "reel", label: "릴스" }] }],
  products: [{ value: "product-1", label: "마케팅 패키지" }],
  suggestions: [{ value: "suggestion-1", label: "추천 주제", intent: "informational" }],
  references: [],
  usage: {
    startsAt: "2099-08-20T00:00:00.000Z", endsAt: "2099-08-27T00:00:00.000Z",
    generation: { limit: 10, succeeded: 0, reserved: 0, remaining: 10, additionalAvailable: 10 },
    publishing: { limit: 7, succeeded: 0, reserved: 0, remaining: 7, additionalAvailable: 7 },
  },
};

function item(overrides: Partial<PublishItem> = {}): PublishItem {
  return {
    itemKey: "output:1", workspaceId: "workspace-1", brandId: "brand-1", title: "기존 카드뉴스",
    createdAt: "2099-08-20T00:00:00.000Z", contentFormat: "card_news", channels: [],
    source: { type: "topic_table", label: "주제표", detail: null, urls: [] }, targets: [], reviewTargets: [],
    contentStatus: "completed", publishStatus: "unreserved", status: "completed_unpublished", operationalStatus: "action_required", operationalReason: "review_required", groupStatus: null, publicationProgress: "none",
    scheduledFor: null, effectiveScheduledFor: null, publishedAt: null, calendarDate: null, calendarPlacement: "unreserved", assignmentMode: null,
    sourceRefs: { contentTopicId: null, proposalId: null, generationId: "generation-1", generationOutputId: "output-1", calendarSlotId: null, topicPublishGroupId: null, queueIds: [] },
    schedulable: true, scheduleBlockedReason: null, lastError: null, ...overrides,
  };
}

function renderDialog() {
  const onScheduleItem = vi.fn();
  const onStartNew = vi.fn();
  const onStartBulk = vi.fn();
  render(<PublishContentPickerDialog
    dateKey="2099-08-24"
    unreservedItems={[item(), item({ itemKey: "generation:2", title: "생성 중 릴스", contentFormat: "reel", contentStatus: "generating", sourceRefs: { ...item().sourceRefs, generationId: "generation-2", generationOutputId: null } })]}
    generatedPreviews={new Map()} connected options={options} optionsError={null} optionsLoading={false} initialBulkDraft={null}
    onScheduleItem={onScheduleItem} onStartNew={onStartNew} onStartBulk={onStartBulk} onContinueBulk={vi.fn()}
    onProvisionBatch={vi.fn(async () => true)} onClose={vi.fn()}
  />);
  return { onScheduleItem, onStartNew, onStartBulk };
}

describe("PublishContentPickerDialog", () => {
  it("moves and selects tabs with wrapped arrows, Home, and End", async () => {
    renderDialog();
    const existing = screen.getByRole("tab", { name: "기존 콘텐츠" });
    existing.focus();

    await userEvent.keyboard("{ArrowRight}");
    const create = screen.getByRole("tab", { name: "새 콘텐츠", selected: true });
    expect(create).toHaveFocus();

    await userEvent.keyboard("{ArrowRight}");
    const bulk = screen.getByRole("tab", { name: "일괄 등록", selected: true });
    expect(bulk).toHaveFocus();

    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "기존 콘텐츠", selected: true })).toHaveFocus();

    await userEvent.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "일괄 등록", selected: true })).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "기존 콘텐츠", selected: true })).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "일괄 등록", selected: true })).toHaveFocus();
  });

  it("keeps existing-content search, status filtering, selection, and status presentation", async () => {
    const { onScheduleItem } = renderDialog();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["기존 콘텐츠", "새 콘텐츠", "일괄 등록"]);
    expect(screen.getByRole("tab", { name: "기존 콘텐츠", selected: true })).toHaveClass("is-active");
    const panel = screen.getByRole("tabpanel", { name: "기존 콘텐츠" });
    expect(within(panel).getByText("기존 카드뉴스")).toBeVisible();
    expect(within(panel).getByText("생성 중 릴스")).toBeVisible();
    expect(within(within(panel).getByRole("article", { name: "기존 카드뉴스" })).getByText("생성 완료")).toBeVisible();

    await userEvent.selectOptions(within(panel).getByRole("combobox", { name: "미예약 콘텐츠 상태" }), "generating");
    expect(within(panel).queryByText("기존 카드뉴스")).not.toBeInTheDocument();
    expect(within(panel).getByText("생성 중 릴스")).toBeVisible();
    await userEvent.selectOptions(within(panel).getByRole("combobox", { name: "미예약 콘텐츠 상태" }), "all");
    await userEvent.type(within(panel).getByRole("searchbox", { name: "미예약 콘텐츠 검색" }), "카드뉴스");
    const card = within(panel).getByRole("article", { name: "기존 카드뉴스" });
    await userEvent.click(within(card).getByRole("button", { name: "게시 설정" }));
    expect(onScheduleItem).toHaveBeenCalledWith(expect.objectContaining({ itemKey: "output:1" }), "2099-08-24", expect.any(HTMLButtonElement));
  });

  it("preserves DB-backed Step 1 selects and the existing new-content callback", async () => {
    const { onStartNew } = renderDialog();
    await userEvent.click(screen.getByRole("tab", { name: "새 콘텐츠" }));
    const panel = screen.getByRole("tabpanel", { name: "새 콘텐츠" });
    expect(within(panel).getByRole("combobox", { name: "콘텐츠 목적" })).toHaveTextContent("정보성");
    expect(within(panel).getByRole("combobox", { name: "콘텐츠 목적" })).toHaveTextContent("마케팅");
    expect(within(panel).getByRole("combobox", { name: "주제 방식" })).toHaveTextContent("추천 선택");
    expect(within(panel).getByRole("combobox", { name: "콘텐츠 형식" })).toHaveTextContent("릴스");
    await userEvent.type(within(panel).getByRole("textbox", { name: "주제" }), "사장님 콘텐츠 운영");
    await userEvent.click(within(panel).getByRole("button", { name: "생성 1단계에서 계속" }));
    expect(onStartNew).toHaveBeenCalledWith(expect.objectContaining({ scheduledFor: "2099-08-24T02:30:00.000Z", contentFormat: "card_news", setup: expect.objectContaining({ topicText: "사장님 콘텐츠 운영" }) }));
  });

  it("keeps multiple Step 1 bulk rows and actions wired to the batch callback", async () => {
    const { onStartBulk } = renderDialog();
    await userEvent.click(screen.getByRole("tab", { name: "일괄 등록" }));
    const panel = screen.getByRole("tabpanel", { name: "일괄 등록" });
    const table = within(panel).getByRole("table", { name: "일괄 주제 설정" });
    const topics = within(table).getAllByRole("textbox", { name: "주제" });
    await userEvent.type(topics[0], "첫 번째 주제");
    await userEvent.type(topics[1], "두 번째 주제");
    await userEvent.click(within(panel).getByRole("button", { name: "행 추가" }));
    await userEvent.type(within(panel).getAllByRole("textbox", { name: "주제" })[2], "세 번째 주제");
    await userEvent.click(within(panel).getByRole("button", { name: "일괄 설정 시작" }));
    expect(onStartBulk).toHaveBeenCalledTimes(1);
    expect(onStartBulk.mock.calls[0][0]).toHaveLength(3);
    expect(onStartBulk.mock.calls[0][0].map((row: { setup: { topicText?: string } }) => row.setup.topicText)).toEqual(["첫 번째 주제", "두 번째 주제", "세 번째 주제"]);
  });
});
