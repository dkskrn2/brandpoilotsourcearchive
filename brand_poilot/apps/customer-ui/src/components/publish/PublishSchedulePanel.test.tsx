import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PublishCalendarManualOptions, PublishCalendarManualSlotInput, PublishItem } from "../../types";
import { PublishSchedulePanel, publishScheduleSource, scheduleErrorMessage } from "./PublishSchedulePanel";

const options: PublishCalendarManualOptions = {
  purposes: [], subjectModes: [], products: [], suggestions: [], references: [],
  channels: [{ value: "instagram", label: "Instagram", formats: [{ value: "card_news", label: "카드뉴스" }, { value: "reel", label: "릴스" }] }],
  usage: {
    startsAt: "2099-08-20T00:00:00.000Z", endsAt: "2099-08-27T00:00:00.000Z",
    generation: { limit: 10, succeeded: 2, reserved: 0, remaining: 8, additionalAvailable: 8 },
    publishing: { limit: 7, succeeded: 1, reserved: 2, remaining: 6, additionalAvailable: 4 },
  },
};

function item(overrides: Partial<PublishItem> = {}): PublishItem {
  return {
    itemKey: "output:output-1", workspaceId: "workspace-1", brandId: "brand-1", title: "사장님 SNS 마케팅",
    createdAt: "2099-08-20T00:00:00.000Z", contentFormat: "card_news", channels: [],
    source: { type: "topic_table", label: "주제표", detail: null, urls: [] }, targets: [], reviewTargets: [],
    contentStatus: "completed", publishStatus: "unreserved", status: "completed_unpublished", operationalStatus: "action_required", operationalReason: "review_required", groupStatus: null, publicationProgress: "none",
    scheduledFor: null, effectiveScheduledFor: null, publishedAt: null, calendarDate: null, calendarPlacement: "unreserved", assignmentMode: null,
    sourceRefs: { contentTopicId: "topic-1", proposalId: null, generationId: "generation-1", generationOutputId: "output-1", calendarSlotId: null, topicPublishGroupId: null, queueIds: [] },
    schedulable: true, scheduleBlockedReason: null, lastError: null,
    ...overrides,
  };
}

describe("PublishSchedulePanel", () => {
  it("locks the selected item and submits the output source without a content selector", async () => {
    const onSubmit = vi.fn(async (_input: PublishCalendarManualSlotInput) => ({ ok: true as const, refreshFailed: false }));
    const onClose = vi.fn();
    render(<PublishSchedulePanel item={item()} options={options} optionsError={null} optionsLoading={false} initialDateKey="2099-08-23" onSubmit={onSubmit} onSaved={vi.fn()} onOpenExistingReservation={vi.fn()} onRetryOptions={vi.fn()} onClose={onClose} />);

    expect(screen.getByRole("dialog", { name: "사장님 SNS 마케팅 게시 설정" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "사장님 SNS 마케팅" })).toBeVisible();
    expect(screen.getByText("생성 완료 콘텐츠")).toBeVisible();
    expect(screen.getByText("카드뉴스")).toBeVisible();
    expect(screen.getByText("Instagram 연결됨")).toBeVisible();
    expect(screen.getByText("이번 주 추가 예약 가능 4건 · 게시 한도 7건")).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "게시할 콘텐츠" })).not.toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("게시 날짜"));
    await userEvent.type(screen.getByLabelText("게시 날짜"), "2099-08-24");
    await userEvent.clear(screen.getByLabelText("게시 시간"));
    await userEvent.type(screen.getByLabelText("게시 시간"), "09:15");
    await userEvent.click(screen.getByRole("button", { name: "게시 예약" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      scheduledFor: "2099-08-24T00:15:00.000Z", channel: "instagram", contentFormat: "card_news",
      source: { kind: "existing_output", generationOutputId: "output-1" },
    });
    expect(onSubmit.mock.calls[0][0].idempotencyKey).toEqual(expect.any(String));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("submits only one reservation while the first request is pending", async () => {
    let resolveSubmit!: (result: { ok: true; refreshFailed: false }) => void;
    const onSubmit = vi.fn(() => new Promise<{ ok: true; refreshFailed: false }>((resolve) => {
      resolveSubmit = resolve;
    }));
    const onClose = vi.fn();
    render(<PublishSchedulePanel item={item()} options={options} optionsError={null} optionsLoading={false} initialDateKey="2099-08-23" onSubmit={onSubmit} onSaved={vi.fn()} onOpenExistingReservation={vi.fn()} onRetryOptions={vi.fn()} onClose={onClose} />);

    const submit = screen.getByRole("button", { name: "게시 예약" });
    await userEvent.dblClick(submit);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "예약 중" })).toBeDisabled();

    resolveSubmit({ ok: true, refreshFailed: false });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("edits the existing Seoul reservation time without requiring create options", async () => {
    const onSubmit = vi.fn(async (_input: { scheduledFor: string }) => ({ ok: true as const, refreshFailed: false }));
    const reserved = item({
      status: "scheduled",
      publishStatus: "scheduled",
      calendarPlacement: "dated",
      scheduledFor: "2099-08-23T02:30:00.000Z",
      effectiveScheduledFor: "2099-08-23T02:30:00.000Z",
      calendarDate: "2099-08-23T02:30:00.000Z",
      sourceRefs: { ...item().sourceRefs, calendarSlotId: "slot-1" },
      schedulable: false,
    });
    render(<PublishSchedulePanel mode="edit" item={reserved} options={null} optionsError={null} optionsLoading={false} initialDateKey="2099-08-23" onSubmit={onSubmit} onSaved={vi.fn()} onOpenExistingReservation={vi.fn()} onRetryOptions={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "사장님 SNS 마케팅 예약 변경" })).toBeVisible();
    expect(screen.getByLabelText("게시 날짜")).toHaveValue("2099-08-23");
    expect(screen.getByLabelText("게시 시간")).toHaveValue("11:30");
    expect(screen.queryByText(/추가 예약 가능/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "예약 변경" })).toBeEnabled();

    await userEvent.clear(screen.getByLabelText("게시 시간"));
    await userEvent.type(screen.getByLabelText("게시 시간"), "15:45");
    await userEvent.click(screen.getByRole("button", { name: "예약 변경" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ scheduledFor: "2099-08-23T06:45:00.000Z" }));
  });

  it("derives fixed sources in output, generation, content-topic order", () => {
    expect(publishScheduleSource(item())).toEqual({ kind: "existing_output", generationOutputId: "output-1" });
    expect(publishScheduleSource(item({ sourceRefs: { ...item().sourceRefs, generationOutputId: null } }))).toEqual({ kind: "existing_generation", generationId: "generation-1" });
    expect(publishScheduleSource(item({ sourceRefs: { ...item().sourceRefs, generationOutputId: null, generationId: null } }))).toEqual({ kind: "existing_content_topic", contentTopicId: "topic-1" });
  });

  it("blocks disconnected, exhausted and format-mismatched submissions before mutation", async () => {
    const onSubmit = vi.fn();
    const disconnected = { ...options, channels: [] };
    const { rerender } = render(<PublishSchedulePanel item={item()} options={disconnected} optionsError={null} optionsLoading={false} initialDateKey="2099-08-23" onSubmit={onSubmit} onSaved={vi.fn()} onOpenExistingReservation={vi.fn()} onRetryOptions={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("Instagram 연결이 필요합니다.")).toBeVisible();
    expect(screen.getByRole("button", { name: "게시 예약" })).toBeDisabled();

    rerender(<PublishSchedulePanel item={item()} options={{ ...options, usage: { ...options.usage, publishing: { ...options.usage.publishing, additionalAvailable: 0 } } }} optionsError={null} optionsLoading={false} initialDateKey="2099-08-23" onSubmit={onSubmit} onSaved={vi.fn()} onOpenExistingReservation={vi.fn()} onRetryOptions={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/남은 예약 한도가 없습니다/)).toBeVisible();
    expect(screen.getByRole("button", { name: "게시 예약" })).toBeDisabled();

    rerender(<PublishSchedulePanel item={item({ contentFormat: "reel" })} options={{ ...options, channels: [{ ...options.channels[0]!, formats: [{ value: "card_news", label: "카드뉴스" }] }] }} optionsError={null} optionsLoading={false} initialDateKey="2099-08-23" onSubmit={onSubmit} onSaved={vi.fn()} onOpenExistingReservation={vi.fn()} onRetryOptions={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("이 콘텐츠 형식은 현재 Instagram 게시 설정과 일치하지 않습니다.")).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not report Instagram as disconnected when subscription options are unavailable", () => {
    render(<PublishSchedulePanel item={item()} options={null} optionsError="게시 예약을 사용하려면 구독 플랜을 확인해 주세요." optionsLoading={false} initialDateKey="2099-08-23" onSubmit={vi.fn()} onSaved={vi.fn()} onOpenExistingReservation={vi.fn()} onRetryOptions={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText("Instagram")).toBeVisible();
    expect(screen.getByText("게시 예약을 사용하려면 구독 플랜을 확인해 주세요.")).toBeVisible();
    expect(screen.queryByText("Instagram 연결 필요")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "게시 예약" })).toBeDisabled();
  });

  it("maps fixed server errors and opens an existing reservation", async () => {
    expect(scheduleErrorMessage("publish_calendar_subscription_inactive", options)).toMatch(/구독 플랜/);
    expect(scheduleErrorMessage("publish_weekly_quota_exceeded", options)).toMatch(/남은 예약 한도/);
    expect(scheduleErrorMessage("publish_calendar_time_past", options)).toMatch(/미래 시각/);
    expect(scheduleErrorMessage("publish_calendar_channel_not_connected", options)).toMatch(/Instagram 연결/);
    expect(scheduleErrorMessage("publish_calendar_content_format_mismatch", options)).toMatch(/형식/);
    expect(scheduleErrorMessage("tenant_scope_rejected", options)).toBe("이 콘텐츠는 현재 브랜드에서 예약할 수 없습니다.");
    expect(scheduleErrorMessage("internal_error", options)).toBe("게시 예약을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");

    const onOpenExistingReservation = vi.fn();
    render(<PublishSchedulePanel item={item()} options={options} optionsError={null} optionsLoading={false} initialDateKey="2099-08-23" onSubmit={vi.fn(async () => ({ ok: false as const, errorCode: "publish_calendar_content_already_scheduled" }))} onSaved={vi.fn()} onOpenExistingReservation={onOpenExistingReservation} onRetryOptions={vi.fn()} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "게시 예약" }));
    expect(await screen.findByText("이미 예약된 콘텐츠입니다. 기존 예약 상세를 엽니다.")).toBeVisible();
    expect(onOpenExistingReservation).toHaveBeenCalledWith("output:output-1", null);
  });
});
