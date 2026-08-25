import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PublishItem } from "../../types";
import { dateKey } from "../../features/publishing/publishCalendar";
import { PublishCalendar } from "./PublishCalendar";
import { PublishDateDetail, type PresentedCalendarEntry } from "./PublishDateDetail";

function entry(overrides: Partial<PresentedCalendarEntry> = {}): PresentedCalendarEntry {
  return {
    id: "slot-1", calendarDate: "2099-08-24T02:30:00.000Z", scheduledFor: "2099-08-24T02:30:00.000Z",
    effectiveScheduledFor: "2099-08-24T02:30:00.000Z", publishedAt: null, title: "예약된 콘텐츠",
    status: "scheduled", mode: "manual", channels: ["instagram"], contentFormat: "card_news",
    operationalStatus: "upcoming", operationalReason: "future_reservation", ...overrides,
  };
}

function unreservedItem(index: number): PublishItem {
  return {
    itemKey: `output:${index}`, workspaceId: "workspace-1", brandId: "brand-1", title: `미예약 콘텐츠 ${index + 1}`,
    createdAt: "2099-08-20T00:00:00.000Z", contentFormat: "card_news", channels: [],
    source: { type: "topic_table", label: "주제표", detail: null, urls: [] }, targets: [], reviewTargets: [],
    contentStatus: "completed", publishStatus: "unreserved", status: "completed_unpublished",
    operationalStatus: "action_required", operationalReason: "review_required", groupStatus: null, publicationProgress: "none",
    scheduledFor: null, effectiveScheduledFor: null, publishedAt: null, calendarDate: null, calendarPlacement: "unreserved", assignmentMode: null,
    sourceRefs: { contentTopicId: null, proposalId: null, generationId: `generation-${index}`, generationOutputId: `output-${index}`, calendarSlotId: null, topicPublishGroupId: null, queueIds: [] },
    schedulable: true, scheduleBlockedReason: null, lastError: null,
  };
}

describe("PublishDateDetail", () => {
  it("shows only the selected date schedule, slot details, and the content trigger", async () => {
    const onSelectEntry = vi.fn();
    const props = { dateKey: "2099-08-24", entries: [entry()], selectedId: null as string | null, slotsLoading: false, slotsError: null, assignableContents: [], onSelectEntry, onAssign: vi.fn(async () => true), onCancel: vi.fn(), onRescheduleItem: vi.fn(), onOpenContentPicker: vi.fn() };
    const { rerender } = render(<PublishDateDetail {...props} />);

    expect(screen.getByRole("button", { name: "콘텐츠 추가" })).toBeVisible();
    expect(screen.getByRole("button", { name: "예약된 콘텐츠 게시 예정 일정 선택" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "미예약 콘텐츠 보관함" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "예약된 콘텐츠 게시 예정 일정 선택" }));
    expect(onSelectEntry).toHaveBeenCalledWith("slot-1");

    rerender(<PublishDateDetail {...props} selectedId="slot-1" />);
    expect(screen.getByLabelText("예약된 콘텐츠 슬롯 상세")).toBeVisible();
    expect(screen.getByText("게시 예정 시각")).toBeVisible();
    expect(screen.getByText("카드뉴스")).toBeVisible();
    expect(screen.getByText("게시 예정", { selector: ".badge" })).toBeVisible();
  });

  it("does not render a 220-item content library until the dialog opens and restores focus on Escape", async () => {
    const selectedDate = dateKey(new Date());
    const onLoadManualOptions = vi.fn();
    render(<PublishCalendar
      monthKey={selectedDate.slice(0, 7)} entries={[]} connectedChannels={["instagram"]} settings={null} settingsError={null}
      slotsError={null} slotsLoading={false} unreservedItems={Array.from({ length: 220 }, (_, index) => unreservedItem(index))}
      assignableContents={[]} manualOptions={null} manualOptionsError={null} manualOptionsLoading={false}
      onMonthChange={vi.fn()} onStartNew={vi.fn()} initialBulkDraft={null} onStartBulk={vi.fn()} onContinueBulk={vi.fn()}
      onProvisionBatch={vi.fn(async () => true)} onAssign={vi.fn(async () => true)} onCancel={vi.fn()} onScheduleItem={vi.fn()}
      onRescheduleItem={vi.fn()} onLoadManualOptions={onLoadManualOptions} onSaveSettings={vi.fn(async () => ({ ok: true }))}
    />);

    expect(screen.queryByText("미예약 콘텐츠 1")).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "콘텐츠 추가" });
    await userEvent.click(trigger);

    expect(onLoadManualOptions).toHaveBeenCalledTimes(1);
    const dialog = screen.getByRole("dialog", { name: "콘텐츠 추가" });
    expect(within(dialog).getByText("미예약 콘텐츠 1")).toBeVisible();
    expect(within(dialog).queryByText("미예약 콘텐츠 220")).not.toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole("heading", { name: "콘텐츠 추가" })).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "콘텐츠 추가" })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
